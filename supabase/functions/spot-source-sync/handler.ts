import { analyzeSpotSources, mergeSpotLeadSources, type SpotSourceDocument } from '../_shared/spot-lead-analysis.ts'
import { SourceReadError, feedArticles, indexArticles, type SourcePlaceAnnotation } from '../_shared/spot-source-reader.ts'
import { publicArticleSource, spotSyndicationFeeds, spotPublishers } from '../_shared/spot-publishers.ts'
import { sourceSafety, verifyLeadPlace } from '../_shared/spot-source-verification.ts'
import type { FishingAi } from '../_shared/fishing-ai.ts'
import { parseShareSource, shareSources, type SpotLead } from '../_shared/discovery-contract.ts'
import sourceAreas from '../_shared/spot-source-areas.json' with { type: 'json' }
import { spotPublicIndexes } from '../_shared/spot-public-indexes.ts'
import { FishingError, readFishingInput } from '../_shared/fishing-edge.ts'
import { storeCatchFrame } from './catch-frame.ts'
import { inferSourceCities } from '../_shared/spot-source-geography.ts'

interface SourceJob { id: string; city: string; url: string; lease: string; places?: SourcePlaceAnnotation[] }
interface CityJob { city: string; lease: string }
type Rpc = <T>(name: string, body: unknown) => Promise<T>
export interface SyncDependencies {
  authorized: (token: string) => Promise<boolean>
  rpc: Rpc
  loadAi: () => Promise<FishingAi | null>
  readArticle: (url: string, annotations?: readonly SourcePlaceAnnotation[]) => Promise<SpotSourceDocument>
  readFeed: (url: string) => Promise<string>
  search?: (query: string) => Promise<{ url: string }[] | null>
  searchStatus: 'ready' | 'search_unconfigured' | 'storage_permission_required'
  mapKey: string
  fetch?: typeof fetch
  now?: () => number
}

export function groundedPlaceDocuments(document: SpotSourceDocument, places: SourceJob['places'], city = '') {
  if (document.positionEvidence) return [document]
  const parts = [String(document.description || ''), ...(Array.isArray(document.excerpts) ? document.excerpts.map(String) : [])]
  const text = [document.title, ...parts].join('\n')
  const documents = (places ?? []).slice(0, 6).flatMap(hint => {
    const name = city && hint.name.startsWith(city) ? hint.name.slice(city.length) : hint.name
    if (!name || name.length < 2 || !text.includes(name)) return []
    const local = String(document.title).includes(name) ? parts : parts.filter((part, index) => part.includes(name) ||
      (index > 0 && parts[index - 1]!.includes(name) && /^(?:据介绍|该|这里|园区|目前|如今)/.test(part.trim())))
    return [{ ...document, poiName: name, poiQuery: hint.query && (name.includes(hint.query) || text.includes(hint.query)) ? hint.query : hint.name,
      description: local[0], excerpts: local.slice(1) }]
  })
  return documents.length ? documents : [document]
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
type Channel = { url: string; city: string; region?: string; kind: 'rss' | 'index' }
const channels: Channel[] = [...spotSyndicationFeeds.map(url => ({ url, city: '', kind: 'rss' as const })),
  ...spotPublicIndexes.map(index => ({ ...index, kind: 'index' as const }))]
export function createSpotSourceSyncHandler(deps: SyncDependencies) {
  return async (request: Request) => {
    if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405)
    const token = /^Bearer ([a-f\d]{64})$/i.exec(request.headers.get('authorization') || '')?.[1]
    if (!token || !await deps.authorized(token).catch(() => false)) return json({ code: 'NOT_AUTHENTICATED' }, 401)
    if (new URL(request.url).pathname.endsWith('/catch-frame')) {
      try { return json(await storeCatchFrame(await readFishingInput(request, 355_000))) }
      catch (error) { return error instanceof FishingError ? json({ code: error.code }, error.status) : json({ code: 'FRAME_STORAGE_UNAVAILABLE' }, 503) }
    }
    // The caller cannot select URLs, cities, batch sizes or override verification.
    try {
      const input = await readFishingInput(request)
      if (input.operation === 'check_channels') {
        const offset = input.offset ?? 0, limit = input.limit ?? 10
        if (!Number.isInteger(offset) || !Number.isInteger(limit) || Number(offset) < 0 || Number(limit) < 1 || Number(limit) > 10)
          return json({ code: 'INVALID_INPUT' }, 400)
        const results: { url: string; ok: boolean; reason?: string; articleLinks?: number }[] = []
        const selected = channels.slice(Number(offset), Number(offset) + Number(limit))
        for (let batch = 0; batch < selected.length; batch += 3) {
          results.push(...await Promise.all(selected.slice(batch, batch + 3).map(async channel => {
            try {
              const content = await deps.readFeed(channel.url)
              const links = channel.kind === 'index' ? indexArticles(content, channel.url, channel.city).articleLinks : 0
              if (channel.kind === 'index' ? links < 3 : !/<rss\b|<feed\b/i.test(content)) throw new SourceReadError('channel_unreadable')
              return { url: channel.url, ok: true, articleLinks: links }
            } catch (error) { return { url: channel.url, ok: false, reason: error instanceof SourceReadError ? error.reason : 'network_error' } }
          })))
        }
        return json({ total: channels.length, offset, channels: results })
      }
      const shares = await deps.rpc<{ id: string; city: string; lease: string; fingerprint: string; description: string }[]>('fishing_claim_spot_shares', {})
      let sharedEnqueued = 0, sharedHeld = 0
      for (const share of shares) {
        const parsed = shareSources(share.description)
        // Match the queue's input bounds. A malformed legacy city or overlong
        // signed link must not wedge every later public submission in this batch.
        const sources = /^[一-鿿]{2,20}$/.test(share.city)
          ? parsed.filter(source => source.url.length <= 500).slice(0, 6).map(source => source.url) : []
        if (parsed.length && !sources.length) sharedHeld++
        const finished = await deps.rpc<{ applied: boolean; enqueued: number }>('fishing_finish_spot_shares', {
          spot: share.id, lease_token: share.lease, fingerprint: share.fingerprint, sources
        })
        if (finished.applied) sharedEnqueued += finished.enqueued
      }
      const queue = await deps.rpc<{ sources: SourceJob[]; cities: CityJob[] }>('fishing_claim_spot_sources', {})
      const ask = queue.sources.length ? await deps.loadAi() : null
      const counts = { claimed: queue.sources.length, published: 0, review: 0, failed: 0, enqueued: sharedEnqueued,
        publicShares: shares.length, sharedEnqueued, sharedHeld,
        feeds: 0, feedFailed: 0, search: deps.searchStatus, analysis: Boolean(ask), places: Boolean(deps.mapKey),
        reviews: [] as { name: string; reason: string; alternatives: { name: string; city: string; district: string }[] }[],
        analysisRejected: [] as { name: string; evidence: string }[], notApplied: 0, channel: '', channels: [] as string[],
        discoveryHeld: [] as { url: string; reason: string }[] }
      await Promise.all(queue.sources.map(async job => {
        let result: Record<string, unknown>
        try {
          const document = await deps.readArticle(job.url, job.places)
          const safety = sourceSafety(document, deps.now?.())
          if (safety) result = { state: 'review', reason: safety }
          else if ((!ask && !document.reviewedPlaces?.length) || !deps.mapKey) result = { state: 'failed', reason: !deps.mapKey ? 'map_unconfigured' : 'analysis_unconfigured' }
          else {
            const checkedAsk: FishingAi = (prompt, input, validate) => ask!(prompt, input, data => {
              const accepted = validate(data)
              if (accepted === null && Array.isArray(data.items)) counts.analysisRejected.push(...data.items.slice(0, 6).map(item => ({
                name: String(item?.name || '').slice(0, 40), evidence: String(item?.evidence || '').slice(0, 90)
              })))
              return accepted
            })
            const areas = [job.city.replace(/市$/, ''), ...((sourceAreas as Record<string, string[]>)[job.city] || [])]
            const areaProof = areas.find(area => document.screeningText?.includes(area))
            const reviewed = areaProof ? document.reviewedPlaces || [] : []
            const annotatedDocs = reviewed.map(place => ({ ...document, title: place.name,
              description: place.name + '\n' + place.evidence, excerpts: [], poiName: place.name,
              poiQuery: place.query || place.name, location: place.district || areaProof,
              managedVenue: place.managedVenue === true,
              ...(document.positionEvidence?.name === place.name ? {} : { sourcePosition: undefined, positionEvidence: undefined }) }))
            const annotationAsk: FishingAi = async (_prompt, input, validate) => validate({ items:
              (input as { candidates: { number: number }[] }).candidates.map(candidate => ({ number: candidate.number,
                name: reviewed[candidate.number - 1]?.name, evidence: reviewed[candidate.number - 1]?.evidence,
                district: reviewed[candidate.number - 1]?.district })) })
            const leads = !reviewed.length && !ask ? null : await analyzeSpotSources(job.city,
              annotatedDocs.length ? annotatedDocs : groundedPlaceDocuments(document, job.places, job.city),
              annotatedDocs.length ? annotationAsk : checkedAsk, true, areas)
            if (leads === null) result = { state: 'failed', reason: 'analysis_failed' }
            else {
              const verified: SpotLead[] = []
              let prohibited = 0
              for (const lead of mergeSpotLeadSources(leads)) {
                const placed = await verifyLeadPlace(lead, deps.mapKey, deps.fetch, detail => counts.reviews.push(detail))
                if (placed && !verified.some(previous => placed.poiId ? previous.poiId === placed.poiId :
                  previous.positionSource === 'source' && JSON.stringify(previous.sourcePosition) === JSON.stringify(placed.sourcePosition))) {
                  const restriction = await deps.rpc<{ blocked: boolean }>('fishing_spot_creation_check', {
                    longitude: placed.sourcePosition!.longitude, latitude: placed.sourcePosition!.latitude
                  })
                  if (typeof restriction?.blocked !== 'boolean') throw new Error('PROHIBITION_CHECK_UNAVAILABLE')
                  if (restriction.blocked) { prohibited++; continue }
                  verified.push(placed)
                }
              }
              const content = JSON.stringify([document.title, document.screeningText || document.description, document.excerpts, document.publishedOn])
              const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
              const hash = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('')
              result = verified.length ? { state: 'published', cards: verified, hash } :
                { state: 'review', reason: prohibited ? 'prohibited_location' : leads.length ? 'place_unverified' : 'no_fishing_evidence', hash }
            }
          }
        } catch (error) {
          result = error instanceof SourceReadError ? {
            state: error.retryable ? 'failed' : 'blocked', reason: error.reason, httpStatus: error.status
          } : { state: 'failed', reason: 'verification_unavailable' }
        }
        const completed = await deps.rpc<boolean>('fishing_finish_spot_source', { job_id: job.id, lease_token: job.lease, result })
        if (completed) {
          if (result.state === 'published') counts.published += (result.cards as unknown[]).length
          else if (result.state === 'failed') counts.failed++
          else counts.review++
        } else counts.notApplied++
      }))
      for (const job of queue.cities) {
        let outcome: string = deps.searchStatus
        if (deps.search && deps.searchStatus === 'ready') {
          const domains = spotPublishers.map(([host]) => host).filter((host, index, all) => all.indexOf(host) === index)
          // Rotate the publisher groups so the same handful of national websites do not dominate.
          const day = Math.floor((deps.now?.() ?? Date.now()) / 86_400_000)
          const group = domains.filter((_, i) => i % 4 === day % 4)
          const social = ['douyin.com/video', 'bilibili.com/video', 'toutiao.com/video', 'xiaohongshu.com/explore']
          const result = await deps.search(job.city + ' (野钓 钓点 定位 OR 垂钓基地 OR 钓场) (' +
            [...group, ...social].map(host => 'site:' + host).join(' OR ') + ' OR site:gov.cn)')
          outcome = result ? 'ready' : 'search_failed'
          const sources = (result ?? []).flatMap(row => {
            const source = parseShareSource(row.url) || publicArticleSource(row.url)
            return source ? [{ city: job.city, url: source.url }] : []
          })
          if (sources.length) counts.enqueued += await deps.rpc<number>('fishing_enqueue_spot_sources', { sources: sources.slice(0, 20) })
        }
        await deps.rpc('fishing_finish_spot_city', { city_name: job.city, lease_token: job.lease, outcome })
      }
      // Rotate official RSS and public city news columns; visitors never start crawls.
      const bucket = Math.floor((deps.now?.() ?? Date.now()) / 300_000)
      const selected = Array.from({ length: Math.min(3, channels.length) }, (_, index) => channels[(bucket * 3 + index) % channels.length]!)
      counts.channel = selected[0]!.url
      counts.channels = selected.map(channel => channel.url)
      const cities = await deps.rpc<string[]>('fishing_spot_source_city_names', {})
      await Promise.all(selected.map(async channel => {
        try {
          const content = await deps.readFeed(channel.url)
          const index = channel.kind === 'index' ? indexArticles(content, channel.url, channel.city) : null
          if (index && index.articleLinks < 3) throw new SourceReadError('index_unreadable')
          let sources = index ? index.items : feedArticles(content, cities)
          if (index && !channel.city) {
            const start = (Math.floor(bucket / Math.ceil(channels.length / 3)) % Math.max(1, Math.ceil(sources.length / 2))) * 2
            const resolved = await Promise.all(sources.slice(start, start + 2).map(async source => {
              try {
                const document = await deps.readArticle(source.url)
                const city = inferSourceCities(document, channel.region)[0]
                if (city) return { city, url: source.url }
                counts.discoveryHeld.push({ url: source.url, reason: 'city_unconfirmed' })
              } catch { counts.discoveryHeld.push({ url: source.url, reason: 'original_unavailable' }) }
              return null
            }))
            sources = resolved.filter((value): value is { city: string; url: string } => value !== null)
          }
          if (sources.length) counts.enqueued += await deps.rpc<number>('fishing_enqueue_spot_sources', { sources: sources.slice(0, 100) })
          counts.feeds++
        } catch { counts.feedFailed++ }
      }))
      await deps.rpc('fishing_spot_source_run', { summary: counts })
      return json(counts)
    } catch { return json({ code: 'SYNC_UNAVAILABLE' }, 503) }
  }
}
