// Replaces the harness driver: opens each book, walks every section at 100% and 200%, reports overflow.
import { readFileSync, writeFileSync } from 'node:fs'
const src = readFileSync(new URL('./make-harness.mjs', import.meta.url), 'utf8')
const start = src.indexOf('(async () => {'), end = src.indexOf("})().catch(")
const driver = `(async () => {
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
`
writeFileSync(new URL('./make-harness-overflow.mjs', import.meta.url), src.slice(0, start) + driver + src.slice(end).replace("path.join(here, 'harness.html')", "path.join(here, 'harness.html')"))
