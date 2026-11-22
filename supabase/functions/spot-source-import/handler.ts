import { parseShareSource, readSpotSharePosition, type SpotLead } from '../_shared/discovery-contract.ts'
import type { FishingAi } from '../_shared/fishing-ai.ts'
import { FishingError, readFishingInput } from '../_shared/fishing-edge.ts'
import { json } from '../_shared/http.ts'
import { analyzeSpotSources, mergeSpotLeadSources, type SpotSourceDocument } from '../_shared/spot-lead-analysis.ts'

const batchSize = 6

interface ImportDependencies {
  loadAi: (callerToken: string) => Promise<FishingAi | null>
  publish: (items: SpotLead[], callerToken: string) => Promise<number>
}

function importDocument(value: unknown): SpotSourceDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new FishingError('INVALID_SOURCE', 400)
  const row = value as Record<string, unknown>
  const source = typeof row.url === 'string' ? parseShareSource(row.url.trim()) : null
  const location = typeof row.location === 'string' ? row.location.trim() : undefined
  const poiName = typeof row.poiName === 'string' ? row.poiName.trim() : undefined
  const poiQuery = typeof row.poiQuery === 'string' ? row.poiQuery.trim() : undefined
  const sourcePosition = readSpotSharePosition(row.sourcePosition)
  if (!source || typeof row.excerpt !== 'string' || !row.excerpt.trim() || row.excerpt.length > 700 ||
      (row.location !== undefined && (!location || location.length > 160)) ||
      (row.poiName !== undefined && (!poiName || poiName.length < 2 || poiName.length > 40)) ||
      (row.poiQuery !== undefined && (!poiName || !poiQuery || poiQuery.length < 2 || poiQuery.length > 40)) ||
      (row.sourcePosition !== undefined && !sourcePosition) ||
      (row.title !== undefined && (typeof row.title !== 'string' || row.title.length > 180)))
    throw new FishingError('INVALID_SOURCE', 400)
  return { source, title: row.title, description: row.excerpt, publishedOn: row.publishedOn,
    location, poiName, poiQuery, sourcePosition }
}

export function createSpotSourceImportHandler({ loadAi, publish }: ImportDependencies) {
  return async (request: Request) => {
    if (request.method !== 'POST') return json({ code: 'INVALID_INPUT' }, 405)
    try {
      const token = request.headers.get('Authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1]
      if (!token) throw new FishingError('NOT_AUTHENTICATED', 401)
      const ask = await loadAi(token)
      if (!ask) throw new FishingError('NOT_AUTHENTICATED', 401)
      const body = await readFishingInput(request)
      const city = typeof body.city === 'string' ? body.city.trim() : ''
      if (!/^[\p{Script=Han}]{2,20}$/u.test(city) || !Array.isArray(body.posts) ||
          !body.posts.length || body.posts.length > batchSize ||
          (body.preview !== undefined && typeof body.preview !== 'boolean'))
        throw new FishingError('INVALID_INPUT', 400)
      const documents = body.posts.map(importDocument)
      const analyzed = await analyzeSpotSources(city, documents, ask)
      if (!analyzed) throw new FishingError('ANALYSIS_FAILED', 502)
      const items = mergeSpotLeadSources(analyzed)
      const published = !body.preview && items.length ? await publish(items, token) : 0
      return json({ received: documents.length, published, items })
    } catch (error) {
      return error instanceof FishingError
        ? json({ code: error.code }, error.status)
        : json({ code: 'SERVICE_UNAVAILABLE' }, 503)
    }
  }
}
