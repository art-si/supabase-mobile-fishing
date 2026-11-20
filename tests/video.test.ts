import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sanitizeVideo, VIDEO_MAX_BYTES } from '../supabase/functions/_shared/video'

const clip = new Uint8Array(readFileSync(new URL('./fixtures/flower-cc0.mp4', import.meta.url)))
function append(type: string, payload: Uint8Array) {
  const bytes = new Uint8Array(clip.length + 8 + payload.length)
  bytes.set(clip)
  new DataView(bytes.buffer).setUint32(clip.length, payload.length + 8)
  bytes.set(new TextEncoder().encode(type), clip.length + 4)
  bytes.set(payload, clip.length + 8)
  return bytes
}
test('MP4 reads a real H.264 clip, strips ordinary metadata without moving frames, and leaves the input intact', () => {
  const source = append('udta', new TextEncoder().encode('GPS +31.32+120.62 private description'))
  const original = new Uint8Array(source)
  const clean = sanitizeVideo(source)
  assert.equal(clean.width, 960)
  assert.equal(clean.height, 540)
  assert.equal(clean.duration, 5.005)
  assert.equal(clean.data.length, source.length)
  assert.equal(
    new TextDecoder().decode(clean.data.subarray(clip.length + 4, clip.length + 8)),
    'free'
  )
  assert.ok(clean.data.subarray(clip.length + 8).every((x) => x === 0))
  assert.deepEqual(source, original)
})
test('video limit accepts exactly 20 MiB, rejects excess bytes, malformed boxes and disguised images', () => {
  const exact = append('free', new Uint8Array(VIDEO_MAX_BYTES - clip.length - 8))
  assert.equal(sanitizeVideo(exact).data.length, VIDEO_MAX_BYTES)
  assert.throws(() => sanitizeVideo(new Uint8Array(VIDEO_MAX_BYTES + 1)), /VIDEO_TOO_LARGE/)
  const broken = new Uint8Array(clip)
  new DataView(broken.buffer).setUint32(0, clip.length + 100)
  for (const bytes of [broken, clip.subarray(0, 60), new Uint8Array(100)])
    assert.throws(() => sanitizeVideo(bytes), /VIDEO_UNSUPPORTED/)
})
