// Exercise the emitted production worker itself, without Vite source modules or hosted writes.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const build = resolve(process.env.FISHING_H5_BUILD || 'dist/review/media-spot-final/h5')
const base = new URL(process.env.FISHING_H5_URL || 'http://127.0.0.1:5178').origin
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname))
const output = 'artifacts/built-heif-worker'
await mkdir(output, { recursive: true })
const names = await readdir(`${build}/assets`)
const workers = names.filter(name => /^heif-worker-.*\.js$/.test(name))
assert.equal(workers.length, 1, 'One actual built HEIC worker is required')
const workerName = workers[0], workerBytes = await readFile(`${build}/assets/${workerName}`)
const fixture = await readFile('tests/fixtures/fish-heic.heic')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ serviceWorkers: 'block' })
const page = await context.newPage()
const errors = [], escaped = [], requested = []
page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', async route => {
  const url = new URL(route.request().url())
  requested.push(url.pathname)
  if (url.origin !== base) {
    escaped.push(url.origin)
    return route.abort()
  }
  if (url.pathname === '/__built_heif_review__') return route.fulfill({
    contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>Built HEIC worker verification</title>'
  })
  if (url.pathname === '/__built_heif_fixture__') return route.fulfill({ contentType: 'image/heic', body: fixture })
  const name = url.pathname.slice('/assets/'.length)
  if (url.pathname.startsWith('/assets/') && names.includes(name)) return route.fulfill({
    contentType: name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
    body: await readFile(`${build}/assets/${name}`)
  })
  errors.push(`Unexpected request: ${url.pathname}`)
  return route.abort()
})
try {
  await page.goto(`${base}/__built_heif_review__`)
  const result = await page.evaluate(async workerName => {
    const input = await (await fetch('/__built_heif_fixture__')).arrayBuffer()
    const worker = new Worker(`/assets/${workerName}`, { type: 'module' })
    let timer
    try {
      const blob = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Built worker timed out')), 90000)
        worker.onerror = event => reject(new Error(event.message || 'Built worker failed'))
        worker.onmessage = event => event.data?.blob instanceof Blob
          ? resolve(event.data.blob)
          : reject(new Error(event.data?.error || 'Built worker returned invalid output'))
        worker.postMessage({ input, limits: { maxBytes: 8 * 1024 * 1024, maxPixels: 24000000, maxEdge: 128 } }, [input])
      })
      const bitmap = await createImageBitmap(blob)
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d')
      context.drawImage(bitmap, 0, 0)
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data
      let min = 255, max = 0
      for (let at = 0; at < pixels.length; at += 4) {
        min = Math.min(min, pixels[at], pixels[at + 1], pixels[at + 2])
        max = Math.max(max, pixels[at], pixels[at + 1], pixels[at + 2])
      }
      const result = { type: blob.type, width: bitmap.width, height: bitmap.height, spread: max - min,
        bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) }
      bitmap.close()
      return result
    } finally { clearTimeout(timer); worker.terminate() }
  }, workerName)
  assert.equal(result.type, 'image/jpeg')
  assert.deepEqual(result.bytes.slice(0, 3), [255, 216, 255])
  assert.deepEqual([result.width, result.height], [128, 128])
  assert.ok(result.spread > 50, 'Decoded pixels must contain actual image detail')
  assert.deepEqual(errors, [])
  assert.deepEqual(escaped, [])
  assert.ok(requested.includes(`/assets/${workerName}`))
  assert.ok(requested.every(path => !path.startsWith('/src/')), 'No development source modules')
  await writeFile(`${output}/decoded-built-worker.jpg`, Uint8Array.from(result.bytes))
  const evidence = { passed: true, build, worker: workerName, workerBytes: workerBytes.length,
    workerSha256: createHash('sha256').update(workerBytes).digest('hex'),
    jpeg: { type: result.type, size: result.bytes.length, width: result.width, height: result.height, pixelSpread: result.spread },
    errors, escaped, requested,
    boundary: 'Actual production bundle module worker and real HEIC bytes in Chrome; all requests fulfilled from local build/fixture files; no hosted writes.' }
  await writeFile(`${output}/result.json`, JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence, null, 2))
} finally { await browser.close() }
