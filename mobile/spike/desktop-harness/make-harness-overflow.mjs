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
  await wait(m => m.type === 'caps', 10000);
  for (const b of FIX) {
    const r = out.books[b.id] = {};
    window.__lib.handle({ cmd: 'open', ciphertextB64: b.ciphertextB64, sha256: b.sha256, licence: b.licence, device: DEV, signingKey: SIGN, lastLocation: null, sanitize: b.sanitize });
    const o = await wait(m => m.type === 'opened' || m.type === 'error', 30000);
    if (!o || o.type === 'error') { r.error = o; continue }
    for (const fs of [100, 200]) {
      await window.__lib.handle({ cmd: 'style', style: { fontSize: fs } }); await sleep(300);
      let total = 0; const samples = [];
      for (const t of o.toc.length ? o.toc : [{ href: 0 }]) {
        await window.__lib.handle({ cmd: 'goTo', href: t.href }); await sleep(250);
        await window.__lib.handle({ cmd: 'overflowCheck' });
        const m = msgs.filter(x => x.type === 'overflow').slice(-1)[0];
        total += m.count; if (m.count) samples.push(...m.overflowing.slice(0, 2));
      }
      r['font' + fs] = { overflowingElements: total, samples: samples.slice(0, 4) };
    }
    await window.__lib.handle({ cmd: 'style', style: { fontSize: 100 } });
  }
  const pre = document.createElement('pre'); pre.id = 'out'; pre.textContent = JSON.stringify(out, null, 1);
  document.body.innerHTML = ''; document.body.append(pre); document.title = 'DONE';
})().catch(e => { document.body.innerHTML = '<pre id=out>DRIVER ERROR ' + e + '</pre>'; document.title = 'DONE' });
`
// Driver must be defined before the bundle's async probe resolves; put it first, same nonce.
const harness = html.replace('<script nonce=', `<script nonce="${nonce}">${driver.replace(/<\/script/g, '<\\/script')}</script>\n<script nonce=`)
writeFileSync(path.join(here, 'harness.html'), harness)
console.log(`harness.html ${(harness.length / 1024 / 1024).toFixed(1)} MB`)
