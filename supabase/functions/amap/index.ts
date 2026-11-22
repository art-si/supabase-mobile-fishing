import { authenticate, settings } from '../_shared/http.ts'
import { createMapHandler, MapError } from './handler.ts'
import { lookupTileWater } from '../_shared/water-tiles.ts'

async function rpc(token: string, name: string, body: unknown) {
  const { url, anonKey } = settings()
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000)
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    if (String(error.message).includes('RATE_LIMIT')) throw new MapError('MAP_QUOTA_EXCEEDED', 429)
    if (String(error.message).includes('NOT_FOUND')) throw new MapError('NOT_FOUND', 404)
    throw new MapError('MAP_BACKEND_UNAVAILABLE', 503)
  }
  return response.json()
}
Deno.serve(
  createMapHandler({
    authenticate,
    shoreline: lookupTileWater,
    apiKey: () => Deno.env.get('AMAP_WEB_SERVICE_KEY') || '',
    reserve: async (caller) => {
      const result = await rpc(caller.token, 'fishing_map_ticket', {})
      if (result?.ok !== true) throw new MapError('MAP_BACKEND_UNAVAILABLE', 503)
    },
    readSpot: (caller, id) =>
      rpc(caller.token, 'fishing_read', { action: 'spot', payload: { id } }),
    fetch
  })
)
