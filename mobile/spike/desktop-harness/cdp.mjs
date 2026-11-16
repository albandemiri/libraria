// Drives headless Chrome over CDP: loads the harness, records every network request
// and console/CSP message, waits for the driver to finish, prints the results.
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
// Set CHROME_PATH to override (e.g. /usr/bin/chromium or google-chrome-stable on Linux).
const CHROME = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'chromium')
const PORT = 9333
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${path.join(here, 'profile2')}`, `--remote-debugging-port=${PORT}`, '--window-size=390,844', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let targets
for (let i = 0; i < 40 && !targets; i++) { await sleep(250); try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json() } catch {} }
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
const requests = []
const logs = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Network.requestWillBeSent') requests.push({ requestId: m.params.requestId, url: m.params.request.url.slice(0, 120), type: m.params.type })
  if (m.method === 'Network.loadingFailed') { const r = requests.find((x) => x.requestId === m.params.requestId); if (r) r.outcome = `failed: ${m.params.blockedReason ?? m.params.errorText}` }
  if (m.method === 'Network.responseReceived') { const r = requests.find((x) => x.requestId === m.params.requestId); if (r) r.outcome = `RESPONSE ${m.params.response.status}` }
  if (m.method === 'Log.entryAdded') logs.push(`${m.params.entry.level} ${m.params.entry.source}: ${m.params.entry.text.slice(0, 220)}`)
  if (m.method === 'Runtime.consoleAPICalled') logs.push(`console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 220)}`)
  if (m.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${m.params.exceptionDetails.exception?.description?.slice(0, 300) ?? m.params.exceptionDetails.text}`)
})
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Network.enable')
await send('Log.enable')
await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:47123/harness.html' })

let done = false
const t0 = Date.now()
while (Date.now() - t0 < 240000) {
  await sleep(1000)
  const r = await send('Runtime.evaluate', { expression: 'document.title' })
  if (r.result?.result?.value === 'DONE') { done = true; break }
}
const dbg = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => { const v = document.querySelector('foliate-view'); const before = v?.lastLocation?.cfi; const n = msgs.length; try { await window.__lib.handle({ cmd: 'style', style: { fontSize: 150 } }) } catch (e) { return 'THREW ' + e } return { hasView: !!v, before, after: v?.lastLocation?.cfi, newMsgs: msgs.slice(n).map(m => m.type + ' ' + JSON.stringify(m).slice(0, 300)) } })()` })
console.log('DEBUG', JSON.stringify(dbg.result?.result?.value ?? dbg.result, null, 1))
const res = await send('Runtime.evaluate', { expression: "document.getElementById('out')?.textContent ?? 'NO OUTPUT'" })
const outText = res.result?.result?.value
writeFileSync(path.join(here, 'result.json'), outText ?? '')
const external = requests.filter((r) => !/^(blob:|data:|http:\/\/127\.0\.0\.1:47123\/harness)/.test(r.url))
console.log(JSON.stringify({ done, seconds: Math.round((Date.now() - t0) / 1000), totalRequests: requests.length, externalRequests: external, logs: logs.filter((l) => !/Content-Security-Policy.*report-only/.test(l)).slice(0, 40) }, null, 1))
ws.close()
chrome.kill()
process.exit(0)
