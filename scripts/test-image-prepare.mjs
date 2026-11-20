// Browser-level tests of the real shared module, without accounts or remote services.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const origin = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178'
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
let external = 0
try {
  const page = await browser.newPage()
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) {
      external++
      return route.abort()
    }
    if (url.pathname === '/__local_image_test__')
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Local image module test</title>'
      })
    return route.continue()
  })
  await page.goto(`${origin}/__local_image_test__`)
  const checks = await page.evaluate(async () => {
    const { prepareUploadImage } = await import('/src/_mobile-core/image-prepare.ts')
    const limits = { maxBytes: 8 * 1024 * 1024, maxPixels: 24000000, maxEdge: 2048 }
    const labels = []
    function check(condition, label) {
      if (!condition) throw new Error(label)
      labels.push(label)
    }
    const canvas = document.createElement('canvas')
    canvas.width = 4000
    canvas.height = 3000
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'rgb(20,120,80)'
    ctx.fillRect(0, 0, 4000, 3000)
    ctx.fillStyle = 'rgb(240,140,20)'
    ctx.fillRect(0, 0, 2000, 1500)
    const jpeg = new Uint8Array(
      await (await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85))).arrayBuffer()
    )
    const corners = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1]
    ]
    for (let orientation = 1; orientation <= 8; orientation++) {
      const exif = Uint8Array.from([
        255,
        225,
        0,
        34,
        69,
        120,
        105,
        102,
        0,
        0,
        73,
        73,
        42,
        0,
        8,
        0,
        0,
        0,
        1,
        0,
        18,
        1,
        3,
        0,
        1,
        0,
        0,
        0,
        orientation,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ])
      const source = new Blob([jpeg.subarray(0, 2), exif, jpeg.subarray(2)], { type: 'image/jpeg' })
      const original = URL.createObjectURL(source)
      let prepared
      try {
        prepared = await prepareUploadImage(original, limits)
        const width = orientation >= 5 ? 1536 : 2048,
          height = orientation >= 5 ? 2048 : 1536
        check(
          prepared.width === width && prepared.height === height,
          `orientation ${orientation} keeps proportional upright dimensions`
        )
        const copy = await (await fetch(prepared.path)).blob()
        const bitmap = await createImageBitmap(copy)
        const output = document.createElement('canvas')
        output.width = width
        output.height = height
        const result = output.getContext('2d')
        result.drawImage(bitmap, 0, 0)
        const [x, y] = corners[orientation - 1]
        const pixel = result.getImageData(
          Math.floor(width * (x ? 0.875 : 0.125)),
          Math.floor(height * (y ? 0.875 : 0.125)),
          1,
          1
        ).data
        check(
          pixel[0] > 200 && pixel[2] < 70,
          `orientation ${orientation} transforms actual photo pixels`
        )
        bitmap.close()
        output.width = output.height = 0
        check(
          !new TextDecoder().decode(await copy.arrayBuffer()).includes('Exif\0\0'),
          `orientation ${orientation} copy has no EXIF orientation to apply twice`
        )
        prepared.dispose()
        prepared.dispose()
        let revoked = false
        try {
          await fetch(prepared.path)
        } catch {
          revoked = true
        }
        check(
          revoked && (await fetch(original)).ok,
          `orientation ${orientation} releases only the generated blob`
        )
      } finally {
        prepared?.dispose()
        URL.revokeObjectURL(original)
      }
    }
    ctx.clearRect(0, 0, 4000, 3000)
    const transparent = URL.createObjectURL(await new Promise((r) => canvas.toBlob(r, 'image/png')))
    let flattened
    try {
      flattened = await prepareUploadImage(transparent, limits)
      const bitmap = await createImageBitmap(await (await fetch(flattened.path)).blob())
      canvas.width = 1
      canvas.height = 1
      ctx.drawImage(bitmap, 0, 0, 1, 1)
      const pixel = ctx.getImageData(0, 0, 1, 1).data
      check(
        pixel[0] >= 250 && pixel[1] >= 250 && pixel[2] >= 250,
        'large transparent PNG is flattened onto white'
      )
      bitmap.close()
    } finally {
      flattened?.dispose()
      URL.revokeObjectURL(transparent)
    }
    canvas.width = 96
    canvas.height = 64
    const small = URL.createObjectURL(await new Promise((r) => canvas.toBlob(r, 'image/png')))
    try {
      const kept = await prepareUploadImage(small, limits)
      kept.dispose()
      check(
        kept.path === small && kept.width === 96 && kept.height === 64 && (await fetch(small)).ok,
        'small photo is neither enlarged nor deleted'
      )
    } finally {
      URL.revokeObjectURL(small)
    }
    const tooManyPixels = new Uint8Array(24)
    tooManyPixels.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
    const view = new DataView(tooManyPixels.buffer)
    view.setUint32(16, 6001)
    view.setUint32(20, 4000)
    for (const [blob, code, label] of [
      [
        new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], { type: 'image/jpeg' }),
        'IMAGE_UNSUPPORTED',
        'disguised SVG is rejected locally'
      ],
      [
        new Blob([tooManyPixels], { type: 'image/png' }),
        'IMAGE_DIMENSIONS_TOO_LARGE',
        'oversized dimensions are rejected before decoding'
      ],
      [
        new Blob([new Uint8Array(limits.maxBytes + 1)], { type: 'image/jpeg' }),
        'IMAGE_INPUT_TOO_LARGE',
        'input byte limit is enforced before decoding'
      ]
    ]) {
      const original = URL.createObjectURL(blob)
      try {
        let error
        try {
          await prepareUploadImage(original, limits)
        } catch (e) {
          error = e
        }
        check(error?.code === code, label)
      } finally {
        URL.revokeObjectURL(original)
      }
    }
    let remoteError
    try {
      await prepareUploadImage('https://not-a-local-photo.invalid/image.jpg', limits)
    } catch (e) {
      remoteError = e
    }
    check(
      remoteError?.code === 'IMAGE_PREPARATION_FAILED',
      'remote paths cannot initiate external photo downloads'
    )
    canvas.width = canvas.height = 0
    return labels
  })
  assert.equal(external, 0)
  process.stdout.write(
    JSON.stringify({ passed: checks.length, externalRequests: external, checks }, null, 2) + '\n'
  )
} finally {
  await browser.close()
}
