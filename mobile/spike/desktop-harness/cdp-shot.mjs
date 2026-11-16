// Phone-sized screenshots of the table page in Libër prove at several font sizes.
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
// Set CHROME_PATH to override (e.g. /usr/bin/chromium or google-chrome-stable on Linux).
const CHROME = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'chromium')
const PORT = 9334
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${path.join(here, 'profile3')}`, `--remote-debugging-port=${PORT}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let targets
for (let i = 0; i < 40 && !targets; i++) { await sleep(250); try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json() } catch {} }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 760, deviceScaleFactor: 2, mobile: true })
await send('Page.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:47123/harness.html#manual' })
await sleep(2500)
await ev(`(async () => { const b = FIX.find(f => f.id === 'sq-test-3'); window.__lib.handle({ cmd: 'open', ciphertextB64: b.ciphertextB64, sha256: b.sha256, licence: b.licence, device: DEV, signingKey: SIGN, lastLocation: null, sanitize: true }); await wait(m => m.type === 'opened', 20000); return true })()`)
const shots = []
for (const fs of [100, 140, 180]) {
  await ev(`window.__lib.handle({ cmd: 'style', style: { fontSize: ${fs} } }).then(() => new Promise(r => setTimeout(r, 300)))`)
  await ev(`window.__lib.handle({ cmd: 'goTo', href: 'OEBPS/tekst/kapitulli-05.xhtml' }).then(() => new Promise(r => setTimeout(r, 500)))`)
  await ev(`(async () => { const v = document.querySelector('foliate-view'); for (const { doc, index } of v.renderer.getContents()) { const t = doc.querySelector('table.wide'); if (!t) continue; const r = doc.createRange(); r.selectNode(t); await v.goTo(v.getCFI(index, r)); await new Promise(x => setTimeout(x, 500)); return true } return false })()`)
  await ev(`window.__lib.handle({ cmd: 'next' }).then(() => new Promise(r => setTimeout(r, 500)))`)
  const tables = await ev(`JSON.stringify(msgs.filter(m => m.type === 'tables').slice(-1)[0]?.fit)`)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const file = path.join(here, `table-${fs}.png`)
  writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
  shots.push({ fs, file, tables })
}
console.log(JSON.stringify(shots, null, 1))
ws.close(); chrome.kill(); process.exit(0)
