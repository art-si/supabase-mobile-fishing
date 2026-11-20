// Read only the primary image's orientation. Do not copy EXIF/GPS/XMP to output.
// Every offset is bounded to its own metadata segment before DataView reads.
function tiffOrientation(bytes: Uint8Array): number | undefined {
  if (bytes.length < 8) return
  const little = bytes[0] === 0x49 && bytes[1] === 0x49
  if (!little && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) return
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint16(2, little) !== 42) return
  const offset = view.getUint32(4, little)
  if (offset < 8 || offset > bytes.length - 2) return
  const count = view.getUint16(offset, little)
  if (count > Math.floor((bytes.length - offset - 2) / 12)) return
  for (let i = 0; i < count; i++) {
    const entry = offset + 2 + i * 12
    if (view.getUint16(entry, little) !== 0x0112) continue
    // Orientation must be a single inline SHORT, not an arbitrary value pointer.
    if (view.getUint16(entry + 2, little) !== 3 || view.getUint32(entry + 4, little) !== 1) return
    const orientation = view.getUint16(entry + 8, little)
    return orientation >= 1 && orientation <= 8 ? orientation : undefined
  }
}

export function photoOrientation(bytes: Uint8Array): number {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) break
      while (bytes[offset] === 0xff) offset++
      const marker = bytes[offset++]
      if (marker === 0xda || marker === 0xd9 || marker === undefined) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (offset + 2 > bytes.length) break
      const length = bytes[offset] * 256 + bytes[offset + 1]
      if (length < 2 || offset + length > bytes.length) break
      const start = offset + 2
      if (
        marker === 0xe1 && length >= 8 &&
        bytes[start] === 69 && bytes[start + 1] === 120 && bytes[start + 2] === 105 &&
        bytes[start + 3] === 102 && bytes[start + 4] === 0 && bytes[start + 5] === 0
      ) {
        const found = tiffOrientation(bytes.subarray(start + 6, offset + length))
        if (found) return found
      }
      offset += length
    }
  } else if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset, false)
      if (length > bytes.length - offset - 12) break
      // PNG eXIf stores TIFF directly, without the JPEG Exif prefix.
      if (view.getUint32(offset + 4, false) === 0x65584966) {
        const found = tiffOrientation(bytes.subarray(offset + 8, offset + 8 + length))
        if (found) return found
      }
      if (view.getUint32(offset + 4, false) === 0x49454e44) break
      offset += length + 12
    }
  }
  return 1
}

export interface PhotoFrame { width: number; height: number; data: Uint8Array }

export function uprightFrame(frame: PhotoFrame, orientation: number): PhotoFrame {
  const { width, height, data } = frame
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width * height > 10_000_000 || data.length !== width * height * 4) {
    throw new Error('INVALID_FRAME')
  }
  if (!Number.isInteger(orientation) || orientation < 1 || orientation > 8) orientation = 1
  const swapped = orientation >= 5
  const outputWidth = swapped ? height : width
  const outputHeight = swapped ? width : height
  // Reuse an upright decoded frame; avoid another full-frame copy for normal photos.
  const output = orientation === 1 ? data : new Uint8Array(data.length)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let dx = x, dy = y
    switch (orientation) {
      case 2: dx = width - 1 - x; break
      case 3: dx = width - 1 - x; dy = height - 1 - y; break
      case 4: dy = height - 1 - y; break
      case 5: dx = y; dy = x; break
      case 6: dx = height - 1 - y; dy = x; break
      case 7: dx = height - 1 - y; dy = width - 1 - x; break
      case 8: dx = y; dy = width - 1 - x; break
    }
    const source = (y * width + x) * 4, target = (dy * outputWidth + dx) * 4
    const alpha = data[source + 3]
    // JPEG has no alpha: explicitly composite transparent PNG pixels onto white.
    for (let channel = 0; channel < 3; channel++) {
      output[target + channel] = Math.round((data[source + channel] * alpha + 255 * (255 - alpha)) / 255)
    }
    output[target + 3] = 255
  }
  return { width: outputWidth, height: outputHeight, data: output }
}
