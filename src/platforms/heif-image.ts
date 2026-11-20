import { ImagePreparationError, type UploadImageLimits } from '@mobile-core/image-prepare'
import type { UploadSignal } from '@mobile-core/upload-progress'

/** Check the actual ISO container, never a filename or a claimed MIME type. */
export function isHeifImage(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const text = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  const size = view.getUint32(0)
  if (text(4) !== 'ftyp' || size < 16 || size > bytes.length || size > 1024 || size % 4)
    return false
  const brands: string[] = []
  for (let offset = 8; offset < size; offset += 4) if (offset !== 12) brands.push(text(offset))
  return (
    !brands.some((brand) => ['avif', 'avis'].includes(brand)) &&
    brands.some((brand) =>
      ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'].includes(
        brand
      )
    )
  )
}

let previous: Promise<unknown> = Promise.resolve()
/** Optional host decoder: the shared uploader and avatar cropper receive the same adapter. */
export async function normalizeHeifImage(
  source: Blob,
  limits: UploadImageLimits,
  options: { signal?: UploadSignal } = {}
): Promise<Blob> {
  // #ifdef H5
  const cancelled = () => Object.assign(new Error('UPLOAD_CANCELLED'), { code: 'UPLOAD_CANCELLED' })
  if (options.signal?.aborted) throw cancelled()
  if (source.size > limits.maxBytes) throw new ImagePreparationError('IMAGE_INPUT_TOO_LARGE')
  if (!isHeifImage(new Uint8Array(await source.slice(0, 1024).arrayBuffer())))
    throw new ImagePreparationError('IMAGE_UNSUPPORTED')
  // A single bounded worker at a time avoids multiplying a phone's decoded-image memory.
  const result = previous
    .catch(() => {})
    .then(async () => {
      if (options.signal?.aborted) throw cancelled()
      const input = await source.arrayBuffer()
      return new Promise<Blob>((resolve, reject) => {
        let worker: Worker | undefined
        let settled = false
        const finish = (blob?: Blob, code = 'IMAGE_PREPARATION_FAILED') => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          options.signal?.removeEventListener('abort', abort)
          worker?.terminate()
          if (blob) resolve(blob)
          else if (code === 'UPLOAD_CANCELLED') reject(cancelled())
          else
            reject(
              new ImagePreparationError(
                code === 'IMAGE_DIMENSIONS_TOO_LARGE'
                  ? code
                  : code === 'IMAGE_INPUT_TOO_LARGE'
                    ? code
                    : code === 'IMAGE_UNSUPPORTED'
                      ? code
                      : 'IMAGE_PREPARATION_FAILED'
              )
            )
        }
        const abort = () => finish(undefined, 'UPLOAD_CANCELLED')
        const timer = setTimeout(() => finish(), 30000)
        options.signal?.addEventListener('abort', abort, { once: true })
        if (options.signal?.aborted) {
          abort()
          return
        }
        try {
          worker = new Worker(new URL('./heif-worker.ts', import.meta.url), { type: 'module' })
          worker.onmessage = (event) => {
            const result = event.data as { blob?: unknown; error?: string }
            if (
              result.blob instanceof Blob &&
              result.blob.type === 'image/jpeg' &&
              result.blob.size > 0 &&
              result.blob.size <= limits.maxBytes
            )
              finish(result.blob)
            else finish(undefined, result.error)
          }
          worker.onerror = () => finish()
          worker.postMessage({ input, limits }, [input])
        } catch {
          finish()
        }
      })
    })
  previous = result.then(
    () => undefined,
    () => undefined
  )
  return result
  // #endif
  // #ifndef H5
  throw new ImagePreparationError('IMAGE_UNSUPPORTED')
  // #endif
}
