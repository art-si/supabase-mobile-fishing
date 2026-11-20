import createHeif from 'libheif-js/libheif-wasm/libheif-bundle.mjs'

interface Limits {
  maxBytes: number
  maxPixels: number
  maxEdge: number
}
type PixelFrame = { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> }
type HeifImage = {
  get_width(): number
  get_height(): number
  is_primary?(): boolean
  free?(): void
  display(frame: PixelFrame, done: (result: PixelFrame | null) => void): void
}
const port = self as unknown as {
  onmessage: ((event: MessageEvent<{ input: ArrayBuffer; limits: Limits }>) => void) | null
  postMessage(value: unknown): void
}

port.onmessage = async ({ data: { input, limits } }) => {
  let images: HeifImage[] = []
  try {
    if (
      ![limits.maxBytes, limits.maxPixels, limits.maxEdge].every(
        (value) => Number.isSafeInteger(value) && value > 0
      )
    )
      throw new Error('IMAGE_PREPARATION_FAILED')
    if (input.byteLength > Math.min(limits.maxBytes, 8 * 1024 * 1024))
      throw new Error('IMAGE_INPUT_TOO_LARGE')
    const library = await createHeif({ print() {}, printErr() {} })
    images = new library.HeifDecoder().decode(new Uint8Array(input))
    if (!images.length || images.length > 64) throw new Error('IMAGE_UNSUPPORTED')
    const image = images.find((item) => item.is_primary?.()) || images[0]
    const width = image.get_width(),
      height = image.get_height()
    if (
      ![width, height].every((value) => Number.isSafeInteger(value) && value > 0) ||
      width > 32768 ||
      height > 32768 ||
      width * height > Math.min(limits.maxPixels, 24000000)
    )
      throw new Error('IMAGE_DIMENSIONS_TOO_LARGE')
    const pixels: PixelFrame = { width, height, data: new Uint8ClampedArray(width * height * 4) }
    await new Promise<void>((resolve, reject) =>
      image.display(pixels, (result) =>
        result ? resolve() : reject(new Error('IMAGE_PREPARATION_FAILED'))
      )
    )
    const full = new OffscreenCanvas(width, height),
      context = full.getContext('2d')
    if (!context) throw new Error('IMAGE_PREPARATION_FAILED')
    context.putImageData(new ImageData(pixels.data, width, height), 0, 0)
    const scale = Math.min(1, limits.maxEdge / Math.max(width, height))
    const output = new OffscreenCanvas(
      Math.max(1, Math.round(width * scale)),
      Math.max(1, Math.round(height * scale))
    )
    const target = output.getContext('2d')
    if (!target) throw new Error('IMAGE_PREPARATION_FAILED')
    target.fillStyle = '#fff'
    target.fillRect(0, 0, output.width, output.height)
    target.drawImage(full, 0, 0, output.width, output.height)
    const blob = await output.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
    if (blob.size > limits.maxBytes) throw new Error('IMAGE_INPUT_TOO_LARGE')
    port.postMessage({ blob })
    full.width = full.height = output.width = output.height = 0
  } catch (error) {
    const code =
      error instanceof Error &&
      ['IMAGE_INPUT_TOO_LARGE', 'IMAGE_DIMENSIONS_TOO_LARGE', 'IMAGE_UNSUPPORTED'].includes(
        error.message
      )
        ? error.message
        : 'IMAGE_PREPARATION_FAILED'
    port.postMessage({ error: code })
  } finally {
    images.forEach((image) => image.free?.())
  }
}
