// Arm B: headless Chromium renders a docx through the genoffice Docs web build
// and prints with the same options desktop main passes to printToPDF.
// usage: node render-web.mjs <forkDir> <outDir> <docx>...   (one browser, docs in sequence)
import { createServer } from 'node:http'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { join, extname, basename, resolve } from 'node:path'
import { createRequire } from 'node:module'
const [forkDir, outDir, ...docs] = process.argv.slice(2)
const require = createRequire(join(resolve(forkDir), 'package.json'))
const { chromium } = require('playwright-core')
const { PDFDocument } = require('pdf-lib')
const dist = join(resolve(forkDir), 'web/docs/dist')
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  try {
    let file
    if (u.pathname.startsWith('/doc/')) file = docs[Number(u.pathname.slice(5))]
    else file = join(dist, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname))
    if (!file.startsWith(dist) && !docs.includes(file)) throw new Error('nope')
    await stat(file)
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(await readFile(file))
  } catch { res.writeHead(404); res.end() }
}).listen(0)
const port = srv.address().port
const T = (n) => Number(n) / 1440
const t0 = performance.now()
const browser = await chromium.launch({ headless: true, args: ['--font-render-hinting=none'] })
const launchMs = performance.now() - t0
const results = []
for (let i = 0; i < docs.length; i++) {
  const s = performance.now()
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const opts = (w, h, scale) => ({ width: `${T(w)}in`, height: `${T(h)}in`, printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 }, ...(scale && scale > 0 && scale !== 1 ? { scale } : {}) })
  let finalPdf = null, calls = 0
  await page.exposeFunction('__w8Pdf', async (w, h, scale) => { calls++; finalPdf = await page.pdf(opts(w, h, scale)); return true })
  await page.exposeFunction('__w8Part', async (w, h, scale) => { calls++; return (await page.pdf(opts(w, h, scale))).toString('base64') })
  await page.exposeFunction('__w8Merge', async (parts) => {
    const merged = await PDFDocument.create()
    for (const b64 of parts) { const p = await PDFDocument.load(Buffer.from(b64, 'base64')); for (const pg of await merged.copyPages(p, p.getPageIndices())) merged.addPage(pg) }
    finalPdf = Buffer.from(await merged.save()); return true
  })
  const done = new Promise((r) => page.exposeFunction('__w8Done', r))
  await page.addInitScript(() => {
    let real
    let consumed = false
    Object.defineProperty(window, 'desktop', { configurable: true, get: () => real, set(v) {
      real = v
      v.consumeHeadlessExport = async () => { if (consumed) return null; consumed = true; return { outPath: '/server/out.pdf', format: 'pdf' } }
      v.headlessExportDone = (r) => window.__w8Done(r)
      v.exportPdf = async (_n, w, h, _o, sc) => { await window.__w8Pdf(w, h, sc); return { ok: true, path: '/server/out.pdf' } }
      v.printPdfBuffer = async (w, h, sc) => ({ ok: true, base64: await window.__w8Part(w, h, sc) })
      v.saveMergedPdf = async (_n, parts) => { await window.__w8Merge(parts); return { ok: true, path: '/server/out.pdf' } }
    } })
  })
  await page.goto(`http://127.0.0.1:${port}/?open=/doc/${i}`)
  let timer
  const report = await Promise.race([done, new Promise((r) => { timer = setTimeout(() => r({ ok: false, error: 'timeout' }), 120000) })])
  clearTimeout(timer)
  const name = basename(docs[i], '.docx')
  if (finalPdf) await writeFile(join(outDir, name + '.pdf'), finalPdf)
  results.push({ doc: name, ok: report?.ok === true, error: report?.error, ms: Math.round(performance.now() - s), printCalls: calls, pageErrors: errors.slice(0, 3) })
  await ctx.close()
}
await browser.close(); srv.close()
console.log(JSON.stringify({ launchMs: Math.round(launchMs), results }))
