import { cors, json, limitedFormData } from '../_shared/http.ts'
import type { authenticate, service, settings } from '../_shared/http.ts'
import type { reserveUploadTicket as reserveTicket } from '../_shared/upload-ticket.ts'
import { PhotoError, sanitizePhoto } from '../_shared/photo.ts'
import { sanitizeVideo, VideoError, VIDEO_MAX_BYTES } from '../_shared/video.ts'

// Re-encoding is mandatory: never trust file extensions, uploaded EXIF or client-side compression.
export function createMediaUploadHandler(deps: {
  authenticate: typeof authenticate
  service: typeof service
  settings: typeof settings
  reserveUploadTicket: typeof reserveTicket
}) {
  const { authenticate, service, settings, reserveUploadTicket } = deps
  return async (request: Request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
    if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    try {
      const user = await authenticate(request)
      if (!user) return json({ error: 'AUTH_REQUIRED' }, 401)
      if (Number(request.headers.get('content-length') || 0) > 21 * 1024 * 1024)
        return json({ error: 'VIDEO_TOO_LARGE' }, 413)
      const { url, anonKey } = settings()
      const ticketFailure = await reserveUploadTicket(url, anonKey, user.token)
      if (ticketFailure) return ticketFailure
      const form = await limitedFormData(request, 21 * 1024 * 1024)
      const file = form.get('file')
      const video = form.get('kind') === 'video'
      if (
        !(file instanceof File) ||
        file.size > (video ? VIDEO_MAX_BYTES : 8 * 1024 * 1024) ||
        file.size < 16
      )
        return json({ error: video ? 'VIDEO_TOO_LARGE' : 'INVALID_FILE' }, 413)
      const source = new Uint8Array(await file.arrayBuffer())
      const result = video ? sanitizeVideo(source) : sanitizePhoto(source)
      const { data: clean, width, height } = result
      const duration = 'duration' in result ? result.duration : null
      const kind = video ? 'video' : 'image'
      const id = crypto.randomUUID(),
        path = `${user.id}/${id}.${video ? 'mp4' : 'jpg'}`
      const uploaded = await service(`/storage/v1/object/fishing-media/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': video ? 'video/mp4' : 'image/jpeg', 'x-upsert': 'false' },
        body: new Uint8Array(clean),
        signal: AbortSignal.timeout(30000)
      })
      if (!uploaded.ok) return json({ error: 'STORAGE_UNAVAILABLE' }, 502)
      const metadata = await service('/rest/v1/media_assets', {
        method: 'POST',
        body: JSON.stringify({
          id,
          owner_id: user.id,
          path,
          width,
          height,
          kind,
          duration,
          size: clean.byteLength
        })
      })
      if (!metadata.ok) {
        await service('/storage/v1/object/fishing-media', {
          method: 'DELETE',
          body: JSON.stringify({ prefixes: [path] })
        })
        return json({ error: 'METADATA_UNAVAILABLE' }, 502)
      }
      return json({ id, path, width, height, kind, duration, size: clean.byteLength })
    } catch (error) {
      if (error instanceof VideoError) return json({ error: error.message }, error.status)
      if (error instanceof PhotoError) return json({ error: error.message }, error.status)
      if (error instanceof Error && error.message === 'TOO_LARGE')
        return json({ error: 'TOO_LARGE' }, 413)
      return json({ error: 'IMAGE_PROCESSING_FAILED' }, 422)
    }
  }
}
