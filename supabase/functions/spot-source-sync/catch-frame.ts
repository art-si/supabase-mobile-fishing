import { parseShareSource, type SpotCatchFrame } from '../_shared/discovery-contract.ts'
import { FishingError } from '../_shared/fishing-edge.ts'
import { service } from '../_shared/http.ts'

const bucket = 'fishing-catch-frames'
const maxBytes = 256 * 1024

/** Only the authenticated catalog worker can submit frames from an inspected original. */
export async function storeCatchFrame(input: Record<string, unknown>, storage = service): Promise<SpotCatchFrame> {
  const source = typeof input.sourceUrl === 'string' && parseShareSource(input.sourceUrl)
  const { seconds, description, jpeg } = input
  if (!source || source.url !== input.sourceUrl || typeof seconds !== 'number' || !Number.isInteger(seconds) ||
      seconds < 0 || seconds > 86400 || typeof description !== 'string' || !description.trim() || description.length > 100 ||
      typeof jpeg !== 'string' || jpeg.length > Math.ceil(maxBytes / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(jpeg))
    throw new FishingError('INVALID_CATCH_FRAME', 400)
  let bytes: Uint8Array<ArrayBuffer>
  try { bytes = Uint8Array.from(atob(jpeg), char => char.charCodeAt(0)) }
  catch { throw new FishingError('INVALID_CATCH_FRAME', 400) }
  if (bytes.length < 32 || bytes.length > maxBytes || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 ||
      bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw new FishingError('INVALID_CATCH_FRAME', 400)

  const root = '/storage/v1/bucket'
  const existing = await storage(root + '/' + bucket)
  if (!existing.ok) {
    const created = await storage(root, { method: 'POST', body: JSON.stringify({
      id: bucket, name: bucket, public: true, file_size_limit: maxBytes, allowed_mime_types: ['image/jpeg']
    }) })
    if (!created.ok && !(await storage(root + '/' + bucket)).ok) throw new FishingError('FRAME_STORAGE_UNAVAILABLE', 503)
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') + '.jpg'
  const saved = await storage('/storage/v1/object/' + bucket + '/' + key, {
    method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=31536000', 'x-upsert': 'false' }, body: bytes
  })
  if (!saved.ok) {
    const error = await saved.json().catch(() => ({}))
    if (String(error.statusCode) !== '409' && error.error !== 'Duplicate') throw new FishingError('FRAME_STORAGE_UNAVAILABLE', 503)
  }
  return { key, seconds, sourceUrl: source.url, description: description.trim() }
}
