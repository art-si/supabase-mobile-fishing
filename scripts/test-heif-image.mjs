import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
const output = 'artifacts/heif-image'
await mkdir(output, { recursive: true })
const fixture = await readFile('tests/fixtures/fish-heic.heic')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()
const errors = [],
  escaped = []
page.on('pageerror', (error) => errors.push(error.message))
await page.route('**/*', (route) => {
  const url = new URL(route.request().url())
  if (url.origin !== base) {
    escaped.push(url.origin)
    return route.abort()
  }
  if (url.pathname === '/__heif_fixture__')
    return route.fulfill({ body: fixture, contentType: 'image/heic' })
  if (url.pathname === '/__heif_review__')
    return route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><meta charset="utf-8"><title>HEIF local decoder verification</title>'
    })
  return route.continue()
})
try {
  await page.goto(`${base}/__heif_review__`)
  const result = await page.evaluate(async () => {
    const { normalizeHeifImage, isHeifImage } = await import('/src/platforms/heif-image.ts')
    const blob = await (await fetch('/__heif_fixture__')).blob()
    const limits = { maxBytes: 8 * 1024 * 1024, maxPixels: 24000000, maxEdge: 128 }
    const OriginalWorker = window.Worker
    let created = 0,
      terminated = 0
    window.Worker = class extends OriginalWorker {
      constructor(...args) {
        super(...args)
        created++
      }
      terminate() {
        terminated++
        super.terminate()
      }
    }
    const captureError = async (fn) => {
      try {
        await fn()
        return 'unexpected success'
      } catch (error) {
        return error.code || error.message
      }
    }
    const output = await normalizeHeifImage(blob, limits)
    const magic = Array.from(new Uint8Array(await output.slice(0, 3).arrayBuffer()))
    const bitmap = await createImageBitmap(output)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    context.drawImage(bitmap, 0, 0)
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data
    let min = 255,
      max = 0
    for (let i = 0; i < pixels.length; i += 4) {
      min = Math.min(min, pixels[i], pixels[i + 1], pixels[i + 2])
      max = Math.max(max, pixels[i], pixels[i + 1], pixels[i + 2])
    }
    const image = { width: bitmap.width, height: bitmap.height, spread: max - min }
    bitmap.close()
    const oversize = await captureError(() =>
      normalizeHeifImage(blob, { ...limits, maxBytes: blob.size - 1 })
    )
    const dimensions = await captureError(() =>
      normalizeHeifImage(blob, { ...limits, maxPixels: 100 })
    )
    const unsupported = await captureError(() =>
      normalizeHeifImage(
        new Blob(['<svg><script>alert(1)</script></svg>'], { type: 'image/heic' }),
        limits
      )
    )
    const controller = new AbortController(),
      cancelled = normalizeHeifImage(blob, limits, { signal: controller.signal })
    setTimeout(() => controller.abort(), 10)
    const cancel = await captureError(() => cancelled)
    const prefix = new Uint8Array(await blob.slice(0, 128).arrayBuffer())
    return {
      type: output.type,
      magic,
      image,
      oversize,
      dimensions,
      unsupported,
      cancel,
      created,
      terminated,
      isHeif: isHeifImage(prefix)
    }
  })
  assert.equal(result.type, 'image/jpeg')
  assert.deepEqual(result.magic, [255, 216, 255])
  assert.deepEqual([result.image.width, result.image.height], [128, 128])
  assert.ok(result.image.spread > 50)
  assert.equal(result.oversize, 'IMAGE_INPUT_TOO_LARGE')
  assert.equal(result.dimensions, 'IMAGE_DIMENSIONS_TOO_LARGE')
  assert.equal(result.unsupported, 'IMAGE_UNSUPPORTED')
  assert.equal(result.cancel, 'UPLOAD_CANCELLED')
  assert.equal(result.created, result.terminated)
  assert.equal(result.isHeif, true)
  assert.deepEqual(errors, [])
  assert.deepEqual(escaped, [])
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        passed: true,
        result,
        errors,
        escaped,
        boundary:
          'Actual owned HEIC bytes decoded by the shipped WASM worker in Chrome, no hosted upload or device-camera claim'
      },
      null,
      2
    )
  )
  console.log(
    'PASS HEIC real decoding, JPEG dimensions/pixels, byte/pixel guards, false MIME rejection, worker cancellation and cleanup'
  )
} finally {
  await browser.close()
}
