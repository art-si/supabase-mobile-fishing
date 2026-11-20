import jpeg from 'npm:jpeg-js@0.4.4'
import { PNG } from 'npm:pngjs@7.0.0'
import { Buffer } from 'node:buffer'
import { photoOrientation, uprightFrame, type PhotoFrame } from './photo-orientation.ts'

export class PhotoError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export function sanitizePhoto(input: Uint8Array) {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  let decoded: PhotoFrame
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    try {
      decoded = jpeg.decode(bytes, { useTArray: true, maxResolutionInMP: 10, maxMemoryUsageInMB: 100, tolerantDecoding: false })
    } catch (error) {
      // A JPEG can fit the byte limit but exceed the decoded-memory budget.
      // Keep the guard; classify this separately from corrupt files or network errors.
      if (error instanceof Error && /^(maxResolutionInMP|maxMemoryUsageInMB) limit exceeded/.test(error.message))
        throw new PhotoError('IMAGE_DIMENSIONS_TOO_LARGE', 413)
      throw error
    }
  } else if (bytes.length >= 24 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20)
    if (!width || !height || width * height > 10000000) throw new PhotoError('IMAGE_DIMENSIONS_TOO_LARGE', 413)
    decoded = PNG.sync.read(bytes, { checkCRC: true })
  } else throw new PhotoError('ONLY_JPEG_PNG_SUPPORTED', 415)
  if (!decoded.width || !decoded.height || decoded.width * decoded.height > 10000000) {
    throw new PhotoError('IMAGE_DIMENSIONS_TOO_LARGE', 413)
  }
  // Apply phone rotation/mirroring before stripping metadata, so a portrait stays upright.
  decoded = uprightFrame(decoded, photoOrientation(bytes))
  // Encode a fresh frame only: no original EXIF, GPS, XMP or comments survive.
  const clean = jpeg.encode(decoded, 85).data
  if (clean.length > 8 * 1024 * 1024) throw new PhotoError('ENCODED_IMAGE_TOO_LARGE', 413)
  return { data: clean, width: decoded.width, height: decoded.height }
}
