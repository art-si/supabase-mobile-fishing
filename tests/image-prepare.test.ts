import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { resolveMobileProRoot } from '../scripts/mobile-pro.mjs'

const core = resolve(resolveMobileProRoot(), 'packages/mobile-core/src/image-prepare.ts')
const source = ts.transpileModule(readFileSync(core, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const limits = { maxBytes: 8 * 1024 * 1024, maxPixels: 24000000, maxEdge: 2048 }
function harness(globals: Record<string, unknown> = {}) {
  const exports: any = {}
  runInNewContext(source, {
    exports,
    Error,
    Uint8Array,
    DataView,
    setTimeout,
    clearTimeout,
    ...globals
  })
  return exports
}
const image = harness()
test('shared image preparation scales proportionally without enlarging small photos', () => {
  for (const [width, height, w, h] of [
    [4000, 3000, 2048, 1536],
    [3000, 4000, 1536, 2048],
    [96, 64, 96, 64],
    [6000, 4000, 2048, 1365],
    [1, 32000, 1, 2048]
  ])
    assert.deepEqual({ ...image.uploadImageSize(width, height, limits) }, { width: w, height: h })
  for (const [width, height] of [
    [0, 1],
    [-1, 1],
    [NaN, 1],
    [Infinity, 1],
    [1.2, 1]
  ])
    assert.throws(() => image.uploadImageSize(width, height, limits), {
      code: 'IMAGE_PREPARATION_FAILED'
    })
  for (const [width, height] of [
    [6001, 4000],
    [1, 32769]
  ])
    assert.throws(() => image.uploadImageSize(width, height, limits), {
      code: 'IMAGE_DIMENSIONS_TOO_LARGE'
    })
  assert.throws(() => image.uploadImageSize(1, 1, { ...limits, maxEdge: 0 }), {
    code: 'IMAGE_PREPARATION_FAILED'
  })
})
test('bounded header parsing rejects disguised types and honors typed-array offsets', () => {
  const jpeg = Uint8Array.from([
    255, 216, 255, 225, 0, 4, 0, 0, 255, 192, 0, 8, 8, 0x0b, 0xb8, 0x0f, 0xa0, 0
  ])
  const padded = new Uint8Array(jpeg.length + 4)
  padded.set(jpeg, 2)
  assert.deepEqual(
    { ...image.uploadImageHeader(padded.subarray(2, -2)) },
    { width: 4000, height: 3000 }
  )
  const png = new Uint8Array(24)
  png.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
  const view = new DataView(png.buffer)
  view.setUint32(16, 3000)
  view.setUint32(20, 4000)
  assert.deepEqual({ ...image.uploadImageHeader(png) }, { width: 3000, height: 4000 })
  for (const data of [
    new TextEncoder().encode('<svg>'),
    new Uint8Array()
  ])
    assert.throws(() => image.uploadImageHeader(data), { code: 'IMAGE_UNSUPPORTED' })
  assert.throws(() => image.uploadImageHeader(new TextEncoder().encode('GIF89a')), { code: 'IMAGE_PREPARATION_FAILED' })
  for (let end = 3; end < jpeg.length; end++)
    assert.throws(() => image.uploadImageHeader(jpeg.subarray(0, end)))
  png[12] = 0
  assert.throws(() => image.uploadImageHeader(png), { code: 'IMAGE_PREPARATION_FAILED' })
})
function mini(
  options: {
    width?: number
    height?: number
    size?: number
    type?: string
    failed?: boolean
    unchanged?: boolean
    outputFailure?: boolean
    outputType?: string
  } = {}
) {
  const original = 'wxfile://tmp/original.jpg',
    copy = 'wxfile://tmp/generated.jpg'
  const calls: any[] = [],
    removed: string[] = []
  const api = harness({
    uni: {
      getFileInfo(o: any) {
        o.success({ size: options.size ?? 500000 })
      },
      getImageInfo(o: any) {
        if (options.outputFailure && o.src === copy) {
          o.fail({ errMsg: 'private diagnostic' })
          return
        }
        o.success(
          o.src === copy
            ? { width: Math.min(options.width ?? 2048, 2048), height: Math.min(options.height ?? 1536, 1536), type: options.outputType ?? 'jpeg' }
            : {
                width: options.width ?? 4000,
                height: options.height ?? 3000,
                type: options.type ?? 'jpeg'
              }
        )
      },
      compressImage(o: any) {
        calls.push(o)
        options.failed
          ? o.fail({ errMsg: 'private diagnostic' })
          : o.success({ tempFilePath: options.unchanged ? original : copy })
      },
      getFileSystemManager() {
        return {
          unlink(o: any) {
            removed.push(o.filePath)
          }
        }
      }
    }
  })
  return {
    original,
    copy,
    calls,
    removed,
    prepare: () => api.prepareUploadImage(original, limits),
    api
  }
}
test('mini-program preparation verifies output and releases only its own generated copy once', async () => {
  const m = mini(),
    prepared = await m.prepare()
  assert.equal(prepared.path, m.copy)
  assert.equal(m.calls[0].compressedWidth, 2048)
  assert.equal(m.calls[0].compressedHeight, undefined, 'one axis preserves the aspect ratio')
  prepared.dispose()
  prepared.dispose()
  assert.deepEqual(m.removed, [m.copy])
  const small = mini({ width: 96, height: 64 }),
    kept = await small.prepare()
  assert.equal(kept.path, small.original)
  kept.dispose()
  assert.equal(small.calls.length, 0)
  assert.deepEqual(small.removed, [])
})
test('mini-program guards fail closed and never delete selected originals', async () => {
  for (const [options, code] of [
    [{ size: limits.maxBytes + 1 }, 'IMAGE_INPUT_TOO_LARGE'],
    [{ width: 6001, height: 4000 }, 'IMAGE_DIMENSIONS_TOO_LARGE'],
    [{ type: 'svg' }, 'IMAGE_UNSUPPORTED'],
    [{ failed: true }, 'IMAGE_PREPARATION_FAILED'],
    [{ unchanged: true }, 'IMAGE_PREPARATION_FAILED'],
    [{ outputFailure: true }, 'IMAGE_PREPARATION_FAILED']
  ] as const) {
    const m = mini(options)
    await assert.rejects(m.prepare(), { code, message: code })
    assert.ok(!m.removed.includes(m.original))
    if ('outputFailure' in options) assert.deepEqual(m.removed, [m.copy])
  }
  const m = mini()
  await assert.rejects(m.api.prepareUploadImage('https://external.invalid/photo.jpg', limits), {
    code: 'IMAGE_PREPARATION_FAILED'
  })
  assert.equal(m.calls.length, 0)
})
test('native new formats are normalized even when small, and original-format compressor output is rejected', async () => {
  for (const type of ['webp', 'gif', 'bmp', 'avif', 'heic', 'heif']) {
    const m = mini({ width: 96, height: 64, type }), prepared = await m.prepare()
    assert.equal(m.calls.length, 1); assert.equal(prepared.path, m.copy)
    assert.equal(prepared.width, 96); assert.equal(prepared.height, 64)
    prepared.dispose(); assert.deepEqual(m.removed, [m.copy])
    const unsupported = mini({ width: 96, height: 64, type, outputType: type })
    await assert.rejects(unsupported.prepare(), { code: 'IMAGE_UNSUPPORTED' })
    assert.deepEqual(unsupported.removed, [unsupported.copy])
  }
})

test('new raster header guards read real dimensions before allocation and honor byte offsets', () => {
  const bytes = (length: number) => new Uint8Array(length)
  const gif = bytes(13); gif.set(new TextEncoder().encode('GIF89a')); new DataView(gif.buffer).setUint16(6, 96, true); new DataView(gif.buffer).setUint16(8, 64, true)
  assert.deepEqual({ ...image.uploadImageMetadata(gif) }, { width: 96, height: 64, format: 'gif' })
  const bmp = bytes(54), bv = new DataView(bmp.buffer); bmp.set([66, 77]); bv.setUint32(14, 40, true); bv.setInt32(18, 96, true); bv.setInt32(22, -64, true)
  assert.deepEqual({ ...image.uploadImageMetadata(bmp) }, { width: 96, height: 64, format: 'bmp' })
  const webp = bytes(30), wv = new DataView(webp.buffer); webp.set(new TextEncoder().encode('RIFF')); wv.setUint32(4, 22, true); webp.set(new TextEncoder().encode('WEBPVP8X'), 8); wv.setUint32(16, 10, true); webp[24] = 95; webp[27] = 63
  const padded = new Uint8Array(34); padded.set(webp, 2)
  assert.deepEqual({ ...image.uploadImageMetadata(padded.subarray(2, -2)) }, { width: 96, height: 64, format: 'webp' })
  for (const input of [gif.subarray(0, 12), bmp.subarray(0, 30), webp.subarray(0, 25)]) assert.throws(() => image.uploadImageMetadata(input))
  webp[24] = webp[25] = webp[26] = 255
  assert.throws(() => image.uploadImageSize(image.uploadImageMetadata(webp).width, 64, limits), { code: 'IMAGE_DIMENSIONS_TOO_LARGE' })
})

test('AVIF requires bounded nested ISO ispe dimensions and rejects malformed or excessive boxes', () => {
  const box = (kind: string, data: Uint8Array) => { const result = new Uint8Array(data.length + 8); new DataView(result.buffer).setUint32(0, result.length); result.set(new TextEncoder().encode(kind), 4); result.set(data, 8); return result }
  const join = (...parts: Uint8Array[]) => { const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length } return result }
  const ispe = (w: number, h: number) => { const data = new Uint8Array(12), v = new DataView(data.buffer); v.setUint32(4, w); v.setUint32(8, h); return box('ispe', data) }
  const ftyp = box('ftyp', new TextEncoder().encode('avif\0\0\0\0avifmif1'))
  const avif = join(ftyp, box('meta', join(new Uint8Array(4), box('iprp', box('ipco', join(ispe(96, 64), ispe(128, 80)))))))
  assert.deepEqual({ ...image.uploadImageMetadata(avif) }, { width: 128, height: 80, format: 'avif' })
  assert.throws(() => image.uploadImageMetadata(avif.subarray(0, -1)), { code: 'IMAGE_PREPARATION_FAILED' })
  assert.throws(() => image.uploadImageMetadata(join(ftyp, ...Array.from({ length: 513 }, () => box('free', new Uint8Array())))), { code: 'IMAGE_PREPARATION_FAILED' })
  const large = join(ftyp, box('meta', join(new Uint8Array(4), box('iprp', box('ipco', ispe(12000, 12000))))))
  const dimensions = image.uploadImageMetadata(large)
  assert.throws(() => image.uploadImageSize(dimensions.width, dimensions.height, limits), { code: 'IMAGE_DIMENSIONS_TOO_LARGE' })
  const heic = box('ftyp', new TextEncoder().encode('heic\0\0\0\0mif1heic'))
  assert.throws(() => image.uploadImageMetadata(heic), { code: 'IMAGE_UNSUPPORTED' })
})
test('late mini-program compression completion releases its copy after timeout', async () => {
  let timeout: () => void = () => {},
    complete: (r: object) => void = () => {}
  const removed: string[] = []
  const api = harness({
    setTimeout(fn: () => void) {
      timeout = fn
      return 1
    },
    clearTimeout() {},
    uni: {
      getFileInfo(o: any) {
        o.success({ size: 1000 })
      },
      getImageInfo(o: any) {
        o.success({ width: 4000, height: 3000, type: 'jpeg' })
      },
      compressImage(o: any) {
        complete = o.success
        queueMicrotask(() => timeout())
      },
      getFileSystemManager() {
        return {
          unlink(o: any) {
            removed.push(o.filePath)
          }
        }
      }
    }
  })
  await assert.rejects(api.prepareUploadImage('wxfile://tmp/original.jpg', limits), {
    code: 'IMAGE_PREPARATION_FAILED'
  })
  complete({ tempFilePath: 'wxfile://tmp/generated.jpg' })
  assert.deepEqual(removed, ['wxfile://tmp/generated.jpg'])
})

test('cancellation stops native preparation promptly and disposes a late compressor result', async () => {
  const controller = new AbortController(), removed: string[] = []
  let complete: (result: object) => void = () => {}, compressed = false
  const api = harness({ uni: {
    getFileInfo(o: any) { o.success({ size: 1000 }) },
    getImageInfo(o: any) { o.success({ width: 96, height: 64, type: 'webp' }) },
    compressImage(o: any) { compressed = true; complete = o.success; controller.abort() },
    getFileSystemManager() { return { unlink(o: any) { removed.push(o.filePath) } } }
  } })
  await assert.rejects(api.prepareUploadImage('wxfile://tmp/original.webp', limits, { signal: controller.signal }), { code: 'UPLOAD_CANCELLED' })
  assert.equal(compressed, true)
  complete({ tempFilePath: 'wxfile://tmp/generated.jpg' })
  assert.deepEqual(removed, ['wxfile://tmp/generated.jpg'])
  compressed = false
  await assert.rejects(api.prepareUploadImage('wxfile://tmp/original.webp', limits, { signal: controller.signal }), { code: 'UPLOAD_CANCELLED' })
  assert.equal(compressed, false, 'an already-cancelled job must not enter the native bridge')
})
