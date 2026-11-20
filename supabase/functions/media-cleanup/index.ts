import { service, settings } from '../_shared/http.ts'
import { createMediaCleanupHandler } from './handler.ts'

Deno.serve(
  createMediaCleanupHandler({
    service,
    secret: () =>
      settings().url === 'https://tlfmfokyhahlpzmpliad.supabase.co'
        ? Deno.env.get('MEDIA_CLEANUP_HMAC_KEY') || ''
        : ''
  })
)
