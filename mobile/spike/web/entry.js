// Reader-engine spike: runs inside the WebView. Bundled with foliate-js into one
// inline script by spike/build-reader-html.mjs. Talks to React Native through
// window.ReactNativeWebView.postMessage (out) and window.__lib.handle (in).

import { configure, ZipReader, BlobReader, TextWriter, BlobWriter } from '../vendor/foliate-js/vendor/zip.js'
import { EPUB } from '../vendor/foliate-js/epub.js'
import '../vendor/foliate-js/view.js'
import * as CFI from '../vendor/foliate-js/epubcfi.js'

const post = (type, data = {}) => {
  try { window.ReactNativeWebView.postMessage(JSON.stringify({ type, ...data })) } catch {}
}
const now = () => performance.now()
const enc = new TextEncoder()

// ---------------------------------------------------------------- encoding helpers
const b64uToBytes = (s) => b64ToBytes(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
function b64ToBytes(b64) {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(b64)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
const concat = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o }
const pemToDer = (pem) => b64ToBytes(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''))

/** Canonical JSON per the reader contract: keys sorted by UTF-16 code unit, no whitespace. */
function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`
}

// ---------------------------------------------------------------- capability probe
async function probe() {
  const r = {
    userAgent: navigator.userAgent,
    isSecureContext: window.isSecureContext,
    origin: location.origin,
    subtle: !!(window.crypto && crypto.subtle),
    fromBase64: typeof Uint8Array.fromBase64 === 'function',
    decompressionStream: typeof DecompressionStream === 'function',
  }
  const t = async (name, fn) => { try { r[name] = (await fn()) ?? true } catch (e) { r[name] = `FAIL: ${e?.name || ''} ${e?.message || e}` } }
  if (!r.subtle) return r
  await t('ecdhGenerateAndExportSpki', async () => {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', kp.publicKey))
    const prefixOk = hex(spki.slice(0, 27)) === '3059301306072a8648ce3d020106082a8648ce3d03010703420004'
    return `${spki.length} bytes, P-256 uncompressed SPKI prefix ${prefixOk ? 'OK' : 'MISMATCH'}`
  })
  await t('hkdf', async () => {
    const k = await crypto.subtle.importKey('raw', new Uint8Array(32), 'HKDF', false, ['deriveBits'])
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('s'), info: enc.encode('i') }, k, 256)
  })
  await t('aesGcm', async () => {
    const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode('a') }, k, enc.encode('hi'))
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode('a') }, k, c)
  })
  await t('ed25519', async () => {
    const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
    const sig = await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, enc.encode('x'))
    return (await crypto.subtle.verify({ name: 'Ed25519' }, kp.publicKey, sig, enc.encode('x'))) ? 'sign+verify OK' : 'verify returned false'
  })
  await t('sha256', async () => { await crypto.subtle.digest('SHA-256', enc.encode('x')) })
  return r
}

// ---------------------------------------------------------------- licence + decryption
async function verifyLicence(licence, signingKey) {
  const { signature, ...payload } = licence
  if (payload.kid !== signingKey.kid) throw new Error('unknown kid')
  const key = await crypto.subtle.importKey('spki', pemToDer(signingKey.publicKeyPem), { name: 'Ed25519' }, false, ['verify'])
  return crypto.subtle.verify({ name: 'Ed25519' }, key, b64uToBytes(signature), enc.encode(canonicalJson(payload)))
}

async function importDevicePrivateKey(device) {
  try {
    return { key: await crypto.subtle.importKey('pkcs8', b64uToBytes(device.privateKeyPkcs8), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']), via: 'pkcs8' }
  } catch (e) {
    return { key: await crypto.subtle.importKey('jwk', device.privateKeyJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']), via: `jwk (pkcs8 failed: ${e?.message})` }
  }
}

async function unwrapDek(licence, devicePrivateKey) {
  const w = licence.wrappedKey
  if (w.alg !== 'ECDH-ES+HKDF-SHA256+A256GCM') throw new Error(`unsupported alg ${w.alg}`)
  const epk = await crypto.subtle.importKey('spki', b64uToBytes(w.epk), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: epk }, devicePrivateKey, 256))
  const hk = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  shared.fill(0)
  const wrapKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(licence.licenceId), info: enc.encode('libraria-licence-v1') },
    hk, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
  const aad = enc.encode(`${licence.licenceId}|${licence.assetId}|${licence.deviceId}`)
  const dek = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64uToBytes(w.iv), additionalData: aad, tagLength: 128 },
    wrapKey, concat(b64uToBytes(w.ciphertext), b64uToBytes(w.tag))))
  if (dek.length !== 32) throw new Error(`DEK is ${dek.length} bytes`)
  return dek
}

async function decryptBook(ciphertext, licence, dek) {
  const c = licence.content
  const aad = enc.encode(`${c.aad.assetId}|${c.aad.version}|${c.aad.algorithm}|${c.aad.kmsKeyId}`)
  // Non-extractable key: the raw DEK bytes are zeroed right after import.
  const key = await crypto.subtle.importKey('raw', dek, { name: 'AES-GCM' }, false, ['decrypt'])
  dek.fill(0)
  const tag = b64uToBytes(c.authTag)
  const joined = new Uint8Array(ciphertext.length + tag.length)
  joined.set(ciphertext); joined.set(tag, ciphertext.length)
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64uToBytes(c.nonce), additionalData: aad, tagLength: 128 }, key, joined))
}

// ---------------------------------------------------------------- ZIP loader (ignores Unicode Path 0x7075)
const utf8 = new TextDecoder('utf-8', { fatal: false })
async function makeZipLoader(blob) {
  configure({ useWebWorkers: false })
  const reader = new ZipReader(new BlobReader(blob))
  const entries = await reader.getEntries()
  const map = new Map()
  let unicodePathEntries = 0
  for (const e of entries) {
    // Use ONLY the standard name from the central directory (reader contract).
    const name = e.rawFilename ? utf8.decode(e.rawFilename) : e.filename
    if (e.extraFieldUnicodePath) unicodePathEntries++
    if (!map.has(name)) map.set(name, e)
  }
  const load = (f) => (name, ...args) => (map.has(name) ? f(map.get(name), ...args) : null)
  return {
    entries,
    unicodePathEntries,
    loadText: load((e) => e.getData(new TextWriter())),
    loadBlob: load((e, type) => e.getData(new BlobWriter(type))),
    getSize: (name) => map.get(name)?.uncompressedSize ?? 0,
  }
}

// ---------------------------------------------------------------- content policy injected into every section
const SECTION_CSP = "default-src 'none'; script-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; img-src blob: data:; style-src 'unsafe-inline' blob:; font-src blob: data:; media-src blob:"
let sanitizeStats = { scripts: 0, handlers: 0, jsUrls: 0, metaRefresh: 0 }
function hardenSection(text, type, sanitize) {
  if (typeof text !== 'string') return text
  const isXml = /xhtml|xml|svg/.test(type)
  const doc = new DOMParser().parseFromString(text, isXml ? (type.includes('svg') ? 'image/svg+xml' : 'application/xhtml+xml') : 'text/html')
  if (doc.querySelector('parsererror')) return text
  const root = doc.documentElement
  const ns = root.namespaceURI || 'http://www.w3.org/1999/xhtml'
  let head = doc.querySelector('head')
  if (!head && root.localName === 'html') { head = doc.createElementNS(ns, 'head'); root.prepend(head) }
  if (sanitize) {
    for (const el of doc.querySelectorAll('script')) { el.remove(); sanitizeStats.scripts++ }
    for (const el of doc.querySelectorAll('meta[http-equiv]')) if (/refresh/i.test(el.getAttribute('http-equiv'))) { el.remove(); sanitizeStats.metaRefresh++ }
    for (const el of doc.querySelectorAll('*')) for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name)) { el.removeAttribute(a.name); sanitizeStats.handlers++ }
      else if (/^\s*javascript:/i.test(a.value)) { el.removeAttribute(a.name); sanitizeStats.jsUrls++ }
    }
  }
  if (head) {
    const meta = doc.createElementNS(ns, 'meta')
    meta.setAttribute('http-equiv', 'Content-Security-Policy')
    meta.setAttribute('content', SECTION_CSP)
    head.prepend(meta)
  }
  return isXml ? new XMLSerializer().serializeToString(doc) : '<!DOCTYPE html>' + doc.documentElement.outerHTML
}

// ---------------------------------------------------------------- reading
let view = null
let currentSanitize = true
let styleState = { fontSize: 100, dark: false }
const violations = []
document.addEventListener('securitypolicyviolation', (e) => violations.push({ where: 'top', directive: e.violatedDirective, blocked: e.blockedURI }))

const readerCss = ({ fontSize, dark }) => `
  @namespace epub "http://www.idpf.org/2007/ops";
  html { font-size: ${fontSize}% !important; color-scheme: ${dark ? 'dark' : 'light'}; }
  ${dark ? 'html, body { background: #121212 !important; color: #e8e2d6 !important; } a:link { color: #9cc8ff; }' : ''}
  p, li, blockquote, dd { -webkit-hyphens: auto; hyphens: auto; }
  pre { white-space: pre-wrap !important; overflow-wrap: anywhere; }
  /* Nothing may be wider than one page: in paginated columns it would bleed into the next page. */
  /* Tables are fitted by fitTables(): shrink text first, wrap only at word/hyphen boundaries. */
  td, th { overflow-wrap: normal; word-break: normal; }
  img, svg, video, canvas, iframe, object, figure, pre, math { max-width: 100% !important; box-sizing: border-box; }
  img, svg, video { height: auto; }
  aside[epub|type~="footnote"], aside[epub|type~="endnote"] { display: none; }
`

const MIN_TABLE_SCALE = 0.75
/** Fits every table in `doc` to one column: natural size if it fits, else smaller text, else word-wrapped. */
function fitTables(doc) {
  if (!doc?.documentElement || !doc.body) return [] // section unloaded meanwhile
  const col = parseFloat(getComputedStyle(doc.documentElement).columnWidth) || doc.documentElement.clientWidth
  const width = (t) => Math.max(0, ...Array.from(t.getClientRects(), (r) => r.width))
  const report = []
  for (const t of doc.querySelectorAll('table')) {
    for (const p of ['font-size', 'width', 'table-layout', 'max-width', 'display', 'overflow-x', 'box-shadow', '-webkit-overflow-scrolling']) t.style.removeProperty(p)
    for (const c of t.querySelectorAll('td, th')) for (const p of ['-webkit-hyphens', 'hyphens', 'overflow-wrap']) c.style.removeProperty(p)
    t.style.setProperty('width', 'max-content', 'important')
    t.style.setProperty('table-layout', 'auto', 'important')
    const natural = width(t)
    if (natural <= col) {
      t.style.removeProperty('width')
      t.style.setProperty('max-width', '100%', 'important')
      report.push({ natural: Math.round(natural), col: Math.round(col), scale: 1, mode: 'natural' })
      continue
    }
    // Shrink text toward the fit ratio (font size is not perfectly linear, so iterate a little).
    let scale = 1
    for (let i = 0; i < 4 && width(t) > col && scale > MIN_TABLE_SCALE; i++) {
      scale = Math.max(MIN_TABLE_SCALE, scale * (col / width(t)) * 0.98)
      t.style.setProperty('font-size', `${scale.toFixed(3)}em`, 'important')
    }
    let mode = 'scaled'
    if (width(t) > col) {
      // Still too wide at the minimum readable size: the table becomes its own horizontal
      // scroller (no DOM wrapper, so CFIs inside the table stay the same). Cells keep their
      // natural width, so words and numbers never break.
      t.style.setProperty('display', 'block', 'important')
      t.style.setProperty('width', 'auto', 'important')
      t.style.setProperty('max-width', '100%', 'important')
      t.style.setProperty('overflow-x', 'auto', 'important')
      t.style.setProperty('-webkit-overflow-scrolling', 'touch')
      t.style.setProperty('box-shadow', 'inset -12px 0 10px -10px rgba(0,0,0,.35)') // hint: more to the right
      if (!t.dataset.libTouch) {
        // Keep swipes inside the table from reaching foliate's page-turn handler on the document.
        for (const type of ['touchstart', 'touchmove', 'touchend']) t.addEventListener(type, (e) => e.stopPropagation(), { passive: true })
        t.dataset.libTouch = '1'
      }
      mode = 'scroll'
    }
    t.dataset.libFit = mode // a real reader would offer "tap to view the full table" here
    report.push({ natural: Math.round(natural), col: Math.round(col), scale: +scale.toFixed(2), mode, final: Math.round(width(t)) })
  }
  return report
}
const fitAllTables = () => (view?.renderer.getContents?.() ?? []).flatMap((c) => fitTables(c?.doc))

async function openBook(msg) {
  const T = {}
  let t0 = now()
  const mark = (k) => { const t = now(); T[k] = Math.round(t - t0); t0 = t }
  try {
    view?.close?.(); view?.remove?.(); view = null
    window.__libraria_pwned = undefined
    violations.length = 0
    sanitizeStats = { scripts: 0, handlers: 0, jsUrls: 0, metaRefresh: 0 }
    currentSanitize = msg.sanitize !== false

    const ciphertext = b64ToBytes(msg.ciphertextB64); mark('base64DecodeMs')
    const sha = hex(await crypto.subtle.digest('SHA-256', ciphertext)); mark('sha256Ms')
    if (sha !== msg.sha256) throw new Error(`ciphertext sha256 mismatch: ${sha}`)

    let signature = 'not checked'
    try { signature = (await verifyLicence(msg.licence, msg.signingKey)) ? 'valid' : 'INVALID' } catch (e) { signature = `unavailable: ${e?.message}` }
    mark('verifyMs')
    if (signature === 'INVALID') throw new Error('licence signature invalid')
    if (msg.licence.deviceId !== msg.device.deviceId) throw new Error('licence is for another device')
    if (Date.parse(msg.licence.expiresAt) < Date.now()) throw new Error('licence expired')

    const { key: devKey, via } = await importDevicePrivateKey(msg.device)
    const dek = await unwrapDek(msg.licence, devKey); mark('unwrapMs')
    const plain = await decryptBook(ciphertext, msg.licence, dek); mark('decryptMs')

    const loader = await makeZipLoader(new Blob([plain], { type: 'application/epub+zip' })); mark('zipIndexMs')
    const book = await new EPUB(loader).init(); mark('epubParseMs')
    book.transformTarget?.addEventListener('data', (e) => {
      const { type } = e.detail
      if (/html|xml|svg/.test(type)) e.detail.data = Promise.resolve(e.detail.data).then((d) => hardenSection(d, type, currentSanitize))
    })

    view = document.createElement('foliate-view')
    document.body.append(view)
    view.addEventListener('relocate', (e) => {
      const d = e.detail
      let snippet = ''
      try { snippet = d.range?.toString().replace(/\s+/g, ' ').trim().slice(0, 80) } catch {}
      post('relocate', { cfi: d.cfi, fraction: d.fraction, tocLabel: d.tocItem?.label, location: d.location, snippet })
    })
    view.addEventListener('load', ({ detail: { doc, index } }) => {
      doc.addEventListener('securitypolicyviolation', (e) => violations.push({ where: `section ${index}`, directive: e.violatedDirective, blocked: e.blockedURI }))
      if (doc.querySelector('table')) requestAnimationFrame(() => post('tables', { index, fit: fitTables(doc) }))
      if (!currentSanitize) setTimeout(() => reportSecurity(doc, index), 1500)
    })
    view.addEventListener('external-link', (e) => { e.preventDefault(); post('externalLink', { href: String(e.detail.href_ ?? e.detail.a?.href ?? '') }) })
    view.addEventListener('link', (e) => post('internalLink', { href: String(e.detail.href) }))

    await view.open(book)
    view.renderer.setAttribute('flow', 'paginated')
    view.renderer.setAttribute('margin', '32px')
    view.renderer.setAttribute('gap', '6%')
    view.renderer.setAttribute('max-column-count', '1')
    // Animate the snap after a swipe (and button page turns) instead of jumping on release.
    view.renderer.setAttribute('animated', '')
    view.renderer.setStyles?.(readerCss(styleState))
    await view.init({ lastLocation: msg.lastLocation || null, showTextStart: !msg.lastLocation })
    mark('firstRenderMs')

    const flat = []
    const walk = (items, depth) => { for (const it of items ?? []) { flat.push({ label: (it.label || '').trim(), href: it.href, depth }); walk(it.subitems, depth + 1) } }
    walk(book.toc, 0)
    post('opened', {
      title: book.metadata?.title, language: book.metadata?.language, sections: book.sections.length,
      toc: flat, timings: T, signature, deviceKeyImport: via, unicodePathEntries: loader.unicodePathEntries,
      plainBytes: plain.length, restoredFrom: msg.lastLocation || null,
    })
  } catch (e) {
    post('error', { stage: Object.keys(T).pop() ?? 'start', message: `${e?.name || ''}: ${e?.message || e}`, timings: T })
  }
}

function reportSecurity(doc, index) {
  const img = doc.getElementById('remote-img')
  post('security', {
    index,
    pwnedTop: window.__libraria_pwned ?? null,
    pwnedInner: doc.defaultView?.__pwned_inner ?? null,
    pageRed: getComputedStyle(doc.documentElement).backgroundColor,
    remoteImageLoaded: img ? img.complete && img.naturalWidth > 0 : 'n/a',
    // Only the script-inserted <h1> counts; the instructions paragraph quotes the same words.
    executedMarker: [...(doc.querySelectorAll('h1') ?? [])].some((h) => h.textContent.includes('SKRIPTI U EKZEKUTUA')),
    violations: violations.slice(0, 20),
    sanitizeStats,
  })
}

async function negativeTests(msg) {
  // Tampered licence and wrong AAD must both fail.
  const out = {}
  try {
    const bad = structuredClone(msg.licence); bad.expiresAt = '2099-01-01T00:00:00.000Z'
    out.tamperedLicenceSignature = (await verifyLicence(bad, msg.signingKey)) ? 'ACCEPTED (BAD)' : 'rejected (good)'
  } catch (e) { out.tamperedLicenceSignature = `error: ${e?.message}` }
  try {
    const { key } = await importDevicePrivateKey(msg.device)
    const bad = structuredClone(msg.licence); bad.deviceId = '00000000-0000-0000-0000-000000000000'
    await unwrapDek(bad, key); out.wrongDeviceAad = 'ACCEPTED (BAD)'
  } catch { out.wrongDeviceAad = 'rejected (good)' }
  try {
    const { key } = await importDevicePrivateKey(msg.device)
    const dek = await unwrapDek(msg.licence, key)
    const bad = structuredClone(msg.licence); bad.content.aad.version = 2
    await decryptBook(b64ToBytes(msg.ciphertextB64), bad, dek); out.wrongContentAad = 'ACCEPTED (BAD)'
  } catch { out.wrongContentAad = 'rejected (good)' }
  post('negative', out)
}

window.__lib = {
  async handle(msg) {
    switch (msg.cmd) {
      case 'open': return openBook(msg)
      case 'negative': return negativeTests(msg)
      case 'next': return view?.next()
      case 'prev': return view?.prev()
      case 'goTo': return view?.goTo(msg.href)
      case 'style': {
        styleState = { ...styleState, ...msg.style }
        document.body.style.background = styleState.dark ? '#121212' : '#fff'
        if (!view) return
        // Pin the START of the current page before re-layout, then return to it
        // once fonts and columns have settled (foliate's own anchor drifts on iOS).
        const cfi = view.lastLocation?.cfi
        const start = cfi ? CFI.collapse(cfi) : null
        view.renderer.setStyles?.(readerCss(styleState))
        await new Promise((r) => setTimeout(r, 350))
        const fit = fitAllTables()
        if (fit.length) post('tables', { afterStyle: true, fit })
        if (start) {
          await new Promise((r) => setTimeout(r, 100))
          await view.goTo(start)
          await new Promise((r) => setTimeout(r, 150))
          const now = view.lastLocation?.cfi
          const visible = now && CFI.compare(CFI.collapse(now), start) <= 0 && CFI.compare(start, CFI.collapse(now, true)) <= 0
          post('styleCheck', { fontSize: styleState.fontSize, startStillVisible: !!visible, savedStart: start, pageNow: now })
        }
        return
      }
      case 'overflowCheck': {
        // Any element wider than one column bleeds into the next page.
        const out = []
        for (const { doc, index } of view?.renderer.getContents?.() ?? []) {
          if (!doc?.body) continue
          const col = parseFloat(getComputedStyle(doc.documentElement).columnWidth) || doc.documentElement.clientWidth
          for (const el of doc.body.querySelectorAll('*')) {
            // Per-fragment: a block that continues on the next page has one rect per column.
            const w = Math.max(0, ...Array.from(el.getClientRects(), (r) => r.width))
            if (w > col + 1) out.push({ index, tag: el.localName, cls: el.className?.baseVal ?? el.className, width: Math.round(w), column: Math.round(col) })
          }
        }
        post('overflow', { fontSize: styleState.fontSize, overflowing: out.slice(0, 10), count: out.length })
        return
      }
      case 'close': view?.close?.(); view?.remove?.(); view = null; return
    }
  },
}

probe().then((caps) => post('caps', caps))
