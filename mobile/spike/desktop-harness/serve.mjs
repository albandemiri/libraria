import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
const load = () => readFileSync(new URL('./harness.html', import.meta.url))
createServer((req, res) => { if (req.url.startsWith('/harness')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(load()) } else { console.log('UNEXPECTED REQUEST', req.url); res.writeHead(404); res.end() } }).listen(47123, '127.0.0.1', () => console.log('listening'))
