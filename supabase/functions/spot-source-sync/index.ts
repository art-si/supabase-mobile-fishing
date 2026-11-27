import { fishingRpc } from '../_shared/fishing-edge.ts'
import { loadFishingAi } from '../_shared/fishing-ai.ts'
import { createSourceReader } from '../_shared/spot-source-reader.ts'
import { fishingWebSearch, webSearchKey } from '../_shared/fishing-web-search.ts'
import { createSpotSourceSyncHandler } from './handler.ts'

const reader = createSourceReader()
const key = webSearchKey()
// The search vendor's storage permission must cover retention of discovery URLs.
// Search excerpts are never used as article evidence or stored in this catalog.
const permitted = Deno.env.get('SPOT_WEB_SEARCH_STORAGE_ALLOWED') === 'true'
// The Amap subscription permits one request per second, including fallback place queries.
let nextMapRequest = 0
const mapFetch: typeof fetch = async (input, init) => {
  const now = Date.now()
  const start = Math.max(now, nextMapRequest)
  nextMapRequest = start + 1100
  if (start > now) await new Promise(resolve => setTimeout(resolve, start - now))
  return fetch(input, { ...init, signal: AbortSignal.timeout(8000) })
}
Deno.serve(createSpotSourceSyncHandler({
  authorized: worker_token => fishingRpc<boolean>('fishing_spot_worker_authorized', { worker_token }),
  rpc: fishingRpc, loadAi: loadFishingAi,
  readArticle: reader.article, readFeed: reader.feed,
  mapKey: Deno.env.get('AMAP_WEB_SERVICE_KEY') || '',
  fetch: mapFetch,
  searchStatus: !key ? 'search_unconfigured' : !permitted ? 'storage_permission_required' : 'ready',
  search: key && permitted ? async query => {
    const results = await fishingWebSearch(query, key, { count: 20, recent: true })
    return results?.flatMap(row => typeof row.url === 'string' ? [{ url: row.url }] : []) ?? null
  } : undefined
}))
