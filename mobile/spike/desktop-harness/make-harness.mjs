// Builds harness.html: the exact WebView page + a test driver standing in for React Native.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const MOBILE = path.resolve(here, '../..') // <repo>/mobile
const genTs = readFileSync(`${MOBILE}/spike/readerHtml.generated.ts`, 'utf8')
const html = JSON.parse(genTs.slice(genTs.indexOf('= ') + 2, genTs.lastIndexOf(';')))
const nonce = html.match(/nonce="([^"]+)"/)[1]

const manifestSrc = readFileSync(`${MOBILE}/spike-fixtures/manifest.ts`, 'utf8').replace(/require\('\.\/([^']+)\.bin'\)/g, '"$1"')
const tmp = path.join(here, 'manifest.tmp.mjs')
writeFileSync(tmp, manifestSrc)
const { books, signingKey, testDevice } = await import(pathToFileURL(tmp).href)
const fixtures = books.map((b) => ({ ...b, ciphertextB64: readFileSync(`${MOBILE}/spike-fixtures/${b.id}.bin`).toString('base64') }))

const driver = `
const FIX = ${JSON.stringify(fixtures)};
const SIGN = ${JSON.stringify(signingKey)};
const DEV = ${JSON.stringify(testDevice)};
const out = { books: {} };
let waiters = [];
const msgs = [];
window.ReactNativeWebView = { postMessage(s) { const m = JSON.parse(s); msgs.push(m); waiters = waiters.filter(w => !w(m)); } };
const wait = (pred, ms) => new Promise((res) => { const t = setTimeout(() => res(null), ms); waiters.push((m) => { if (pred(m)) { clearTimeout(t); res(m); return true } return false }) });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let lastReloc = null;
const relocs = () => msgs.filter(m => m.type === 'relocate');
if (!location.hash.includes('manual')) (async () => {
  const caps = await wait(m => m.type === 'caps', 10000);
  out.caps = caps;
  for (const b of FIX) {
    const r = out.books[b.id] = {};
    const n0 = msgs.length;
    window.__lib.handle({ cmd: 'open', ciphertextB64: b.ciphertextB64, sha256: b.sha256, licence: b.licence, device: DEV, signingKey: SIGN, lastLocation: null, sanitize: b.sanitize });
    const o = await wait(m => m.type === 'opened' || m.type === 'error', 30000);
    if (!o || o.type === 'error') { r.error = o || 'timeout'; continue }
    r.opened = { ...o, toc: o.toc.slice(0, 14).map(t => '  '.repeat(t.depth) + t.label) };
    await sleep(400);
    r.first = relocs().slice(-1)[0];
    for (let i = 0; i < 4; i++) { await window.__lib.handle({ cmd: 'next' }); await sleep(250) }
    r.after4Next = relocs().slice(-1)[0];
    if (b.id === 'hostile') { await sleep(2500); r.security = msgs.filter(m => m.type === 'security').map(m => ({ index: m.index, pwnedTop: m.pwnedTop, pwnedInner: m.pwnedInner, red: m.pageRed, remoteImageLoaded: m.remoteImageLoaded, executed: m.executedMarker })); await window.__lib.handle({ cmd: 'next' }); await sleep(800); r.secondSection = relocs().slice(-1)[0]?.snippet }
    // font change keeps position?
    const before = relocs().slice(-1)[0];
    const nF = msgs.length; const lastCfi = document.querySelector('foliate-view')?.lastLocation?.cfi; try { await window.__lib.handle({ cmd: 'style', style: { fontSize: 140 } }) } catch (e) { r.styleErr = String(e) } await sleep(600); r.fontMsgs = msgs.slice(nF).map(m => m.type === 'styleCheck' ? m : m.type); r.lastCfiBefore = lastCfi;
    r.fontChange = { before: before?.snippet, after: relocs().slice(-1)[0]?.snippet, check: msgs.filter(m => m.type === 'styleCheck').slice(-1)[0]?.startStillVisible };
    await window.__lib.handle({ cmd: 'style', style: { fontSize: 100 } }); await sleep(500);
    // reopen from saved CFI
    const saved = relocs().slice(-1)[0];
    window.__lib.handle({ cmd: 'open', ciphertextB64: b.ciphertextB64, sha256: b.sha256, licence: b.licence, device: DEV, signingKey: SIGN, lastLocation: saved?.cfi, sanitize: b.sanitize });
    await wait(m => m.type === 'opened' || m.type === 'error', 30000); await sleep(500);
    r.restore = { savedCfi: saved?.cfi, before: saved?.snippet, after: relocs().slice(-1)[0]?.snippet };
    r.restore.same = r.restore.before === r.restore.after;
  }
  window.__lib.handle({ cmd: 'negative', ciphertextB64: FIX[0].ciphertextB64, licence: FIX[0].licence, device: DEV, signingKey: SIGN });
  out.negative = await wait(m => m.type === 'negative', 10000);
  out.errors = msgs.filter(m => m.type === 'error');
  const pre = document.createElement('pre'); pre.id = 'out'; pre.textContent = JSON.stringify(out, null, 1);
  document.body.innerHTML = ''; document.body.append(pre); document.title = 'DONE';
})().catch(e => { document.body.innerHTML = '<pre id=out>DRIVER ERROR ' + e + '</pre>'; document.title = 'DONE' });
`
// Driver must be defined before the bundle's async probe resolves; put it first, same nonce.
const harness = html.replace('<script nonce=', `<script nonce="${nonce}">${driver.replace(/<\/script/g, '<\\/script')}</script>\n<script nonce=`)
writeFileSync(path.join(here, 'harness.html'), harness)
console.log(`harness.html ${(harness.length / 1024 / 1024).toFixed(1)} MB`)
