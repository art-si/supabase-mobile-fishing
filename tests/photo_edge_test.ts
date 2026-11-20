import jpeg from 'npm:jpeg-js@0.4.4'
import { PNG } from 'npm:pngjs@7.0.0'
import { Buffer } from 'node:buffer'
import { sanitizePhoto, PhotoError } from '../supabase/functions/_shared/photo.ts'
import { photoOrientation } from '../supabase/functions/_shared/photo-orientation.ts'

function check(value: unknown, message: string) {
  if (!value) throw new Error(message)
}
function sample() {
  const data = new Uint8Array(96 * 64 * 4)
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 96; x++) {
      const n = (y * 96 + x) * 4
      data.set(x < 48 && y < 32 ? [240, 140, 20, 255] : [20, 120, 80, 255], n)
    }
  return { width: 96, height: 64, data }
}
Deno.test('real JPEG pipeline rotates pixels before removing private EXIF/comments', () => {
  const encoded = jpeg.encode(sample(), 90).data
  const marker = Buffer.from('PRIVATE-GPS-XMP-COMMENT', 'ascii')
  const tiff = [73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0]
  const exif = [69, 120, 105, 102, 0, 0, ...tiff, ...marker]
  const size = exif.length + 2
  const input = Buffer.concat([
    encoded.subarray(0, 2),
    Buffer.from([
      255,
      225,
      size >> 8,
      size & 255,
      ...exif,
      255,
      254,
      0,
      marker.length + 2,
      ...marker
    ]),
    encoded.subarray(2)
  ])
  check(photoOrientation(input) === 6, 'fixture encodes portrait rotation')
  const result = sanitizePhoto(input)
  check(result.width === 64 && result.height === 96, 'stored metadata reports upright dimensions')
  const decoded = jpeg.decode(result.data, { useTArray: true })
  check(decoded.width === 64 && decoded.height === 96, 'JPEG itself has upright dimensions')
  // The original upper-left orange patch becomes upper-right after clockwise rotation.
  const upperRight = (8 * 64 + 56) * 4,
    lowerRight = (88 * 64 + 56) * 4
  check(
    decoded.data[upperRight] > 200 && decoded.data[lowerRight] < 60,
    'pixels actually rotated, not just width/height swapped'
  )
  check(
    !result.data.includes(marker) && !result.data.includes(Buffer.from('Exif\0\0')),
    'metadata is removed'
  )
  check(photoOrientation(result.data) === 1, 'no orientation tag needed by clients')
})
Deno.test('real PNG pipeline flattens alpha onto white and emits a JPEG', () => {
  const input = PNG.sync.write({ width: 16, height: 16, data: Buffer.alloc(16 * 16 * 4) })
  const result = sanitizePhoto(input)
  const decoded = jpeg.decode(result.data, { useTArray: true })
  check(result.data[0] === 255 && result.data[1] === 216, 'output is JPEG')
  check(
    decoded.data[0] >= 250 && decoded.data[1] >= 250 && decoded.data[2] >= 250,
    'transparent pixels are white, not black'
  )
})
Deno.test('image type and dimension guards remain enforced before decoding', () => {
  for (const input of [
    Buffer.from('<svg>not an image</svg>'),
    Buffer.from('GIF89a-invalid-file')
  ]) {
    let caught = false
    try {
      sanitizePhoto(input)
    } catch (error) {
      caught = error instanceof PhotoError && error.status === 415
    }
    check(caught, 'only JPEG/PNG accepted')
  }
  const png = Buffer.alloc(24)
  png.set([137, 80, 78, 71, 13, 10, 26, 10])
  png.writeUInt32BE(100000, 16)
  png.writeUInt32BE(100000, 20)
  let caught = false
  try {
    sanitizePhoto(png)
  } catch (error) {
    caught = error instanceof PhotoError && error.status === 413
  }
  check(caught, 'oversize image rejected before allocating pixels')
})

Deno.test(
  'decoded JPEG memory guard returns a bounded dimension error, not generic processing failure',
  () => {
    // A valid 10MP JPEG can be well under 8MB yet require more than 100MB to decode.
    const width = 4000,
      height = 2500
    const input = jpeg.encode(
      { width, height, data: new Uint8Array(width * height * 4).fill(255) },
      75
    ).data
    check(input.length < 8 * 1024 * 1024, 'fixture fits the input byte limit')
    let caught = false
    try {
      sanitizePhoto(input)
    } catch (error) {
      caught =
        error instanceof PhotoError &&
        error.status === 413 &&
        error.message === 'IMAGE_DIMENSIONS_TOO_LARGE'
    }
    check(caught, 'memory budget is retained and classified as a size constraint')
  }
)
