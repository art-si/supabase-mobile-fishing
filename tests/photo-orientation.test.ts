import test from 'node:test'
import assert from 'node:assert/strict'
import { photoOrientation, uprightFrame } from '../supabase/functions/_shared/photo-orientation'

function tiff(orientation: number, little = true) {
  const bytes = new Uint8Array(26)
  const view = new DataView(bytes.buffer)
  bytes.set(little ? [73, 73] : [77, 77])
  view.setUint16(2, 42, little)
  view.setUint32(4, 8, little)
  view.setUint16(8, 1, little)
  view.setUint16(10, 0x0112, little)
  view.setUint16(12, 3, little)
  view.setUint32(14, 1, little)
  view.setUint16(18, orientation, little)
  return bytes
}
function jpeg(metadata: Uint8Array) {
  const length = metadata.length + 8
  return Uint8Array.from([
    255,
    216,
    255,
    225,
    length >> 8,
    length & 255,
    69,
    120,
    105,
    102,
    0,
    0,
    ...metadata,
    255,
    217
  ])
}
test('orientation supports both TIFF byte orders, offset views and all eight values', () => {
  for (const little of [true, false])
    for (let n = 1; n <= 8; n++) {
      const payload = jpeg(tiff(n, little))
      const padded = new Uint8Array(payload.length + 4)
      padded.set(payload, 2)
      assert.equal(photoOrientation(padded.subarray(2, -2)), n)
    }
})
test('orientation parser fails safely on truncated data, invalid offsets and types', () => {
  const valid = jpeg(tiff(6))
  for (let length = 0; length < valid.length - 2; length++) {
    assert.equal(photoOrientation(valid.subarray(0, length)), 1)
  }
  for (const n of [0, 9, 65535]) assert.equal(photoOrientation(jpeg(tiff(n))), 1)
  for (const mutate of [
    (v: DataView) => v.setUint32(4, 0xfffffff0, true),
    (v: DataView) => v.setUint16(8, 65535, true),
    (v: DataView) => v.setUint16(12, 4, true),
    (v: DataView) => v.setUint32(14, 0xffffffff, true)
  ]) {
    const bytes = tiff(6)
    mutate(new DataView(bytes.buffer))
    assert.equal(photoOrientation(jpeg(bytes)), 1)
  }
})
test('PNG eXIf orientation is honored without reading beyond its chunk', () => {
  const metadata = tiff(8)
  const png = Uint8Array.from([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    0,
    0,
    0,
    metadata.length,
    101,
    88,
    73,
    102,
    ...metadata,
    0,
    0,
    0,
    0
  ])
  assert.equal(photoOrientation(png), 8)
  png[8] = 255
  assert.equal(photoOrientation(png), 1)
})
test('all rotations and mirrored orientations preserve pixel positions and shape', () => {
  const expected = [
    [1, 2, 3, 4, 5, 6],
    [3, 2, 1, 6, 5, 4],
    [6, 5, 4, 3, 2, 1],
    [4, 5, 6, 1, 2, 3],
    [1, 4, 2, 5, 3, 6],
    [4, 1, 5, 2, 6, 3],
    [6, 3, 5, 2, 4, 1],
    [3, 6, 2, 5, 1, 4]
  ]
  for (let orientation = 1; orientation <= 8; orientation++) {
    const data = Uint8Array.from([1, 2, 3, 4, 5, 6].flatMap((n) => [n, 10, 20, 255]))
    const result = uprightFrame({ width: 3, height: 2, data }, orientation)
    assert.equal(result.width, orientation >= 5 ? 2 : 3)
    assert.equal(result.height, orientation >= 5 ? 3 : 2)
    assert.deepEqual(
      [...result.data].filter((_, i) => i % 4 === 0),
      expected[orientation - 1]
    )
    assert.deepEqual(
      [...result.data].filter((_, i) => i % 4 === 3),
      [255, 255, 255, 255, 255, 255]
    )
  }
})
test('transparent PNG pixels composite on white and upright frames avoid a copy', () => {
  const data = Uint8Array.from([0, 0, 0, 0, 0, 100, 200, 128])
  const result = uprightFrame({ width: 2, height: 1, data }, 1)
  assert.equal(result.data, data)
  assert.deepEqual([...result.data], [255, 255, 255, 255, 127, 177, 227, 255])
  assert.throws(() => uprightFrame({ width: 3, height: 2, data }, 6), /INVALID_FRAME/)
})
