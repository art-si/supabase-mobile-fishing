import { sessionRequest, sessionScope } from './session'
import { spotLabelBatchSize, type Platform, type SpotLabelBatch, type SpotLabels, type SpotLead, type WaterNotice } from '../../supabase/functions/_shared/discovery-contract'
import { spotLabelText, verifiedSpotLabels } from '../../supabase/functions/_shared/spot-labels'
import { matchLeadPlace, sharedLeadPlace } from '@/domain/spot-lead-place'
import type { MapPlace } from '@/domain/map'
import { districtOptions } from '@/domain/regions'
// #ifdef H5
import { searchPlacePage } from '@/platforms/amap'
// #endif
// #ifndef H5
import { searchMapPlaces } from './amap'
// #endif

interface LabelCache {
  scope: number
  items: Map<string, { description: string; labels: SpotLabels; until: number }>
  nextRequest: number
  pending?: Promise<void>
}
const discoveryTimeoutMs = 50_000
let labelCache: LabelCache | undefined

export async function classifyVisibleSpots(spots: readonly { id: string; description: string }[]) {
  const scope = sessionScope.value
  if (labelCache?.scope !== scope) labelCache = { scope, items: new Map(), nextRequest: 0 }
  const cache = labelCache
  const candidates = spots.map(spot => ({ id: spot.id, description: spotLabelText(spot.description) }))
    .filter(spot => spot.description)
  const get = (spot: typeof candidates[number]) => {
    const entry = cache.items.get(spot.id)
    return entry?.description === spot.description && entry.until > Date.now() ? entry.labels : undefined
  }
  const missing = candidates.filter(spot => !get(spot)).slice(0, spotLabelBatchSize)
  if (missing.length && !cache.pending && Date.now() >= cache.nextRequest) {
    cache.nextRequest = Date.now() + 45_000
    cache.pending = sessionRequest<SpotLabelBatch>('/functions/v1/spot-discovery', {
      method: 'POST', timeout: discoveryTimeoutMs,
      data: { operation: 'labels', ids: missing.map(spot => spot.id) }
    }).then(result => {
      if (result.mode !== 'ai' || !Array.isArray(result.items)) {
        cache.nextRequest = Date.now() + 3 * 60_000
        return
      }
      const until = Date.now() + 30 * 60_000
      for (const spot of missing) {
        const match = result.items.find(item => item.spotId === spot.id)
        cache.items.delete(spot.id)
        cache.items.set(spot.id, {
          description: spot.description,
          labels: verifiedSpotLabels(spot.description, match?.labels),
          until
        })
      }
      for (const id of cache.items.keys()) {
        if (cache.items.size <= 100) break
        cache.items.delete(id)
      }
    }).catch(() => {
      // The list already has evidence from its public descriptions.
    }).finally(() => {
      cache.pending = undefined
    })
  }
  await cache.pending
  const labels: Record<string, SpotLabels> = {}
  if (sessionScope.value === scope) {
    for (const spot of candidates) {
      const found = get(spot)
      if (found) labels[spot.id] = found
    }
  }
  return labels
}

let leadRequest: { key: string; expires: number; result: Promise<SpotLead[] | null> } | undefined
export function loadPublicSpotLeads(city: string) {
  const key = sessionScope.value + ':' + city
  if (leadRequest?.key === key && leadRequest.expires > Date.now()) return leadRequest.result
  const request = {
    key, expires: Date.now() + 60_000,
    result: sessionRequest<SpotLead[]>('/rest/v1/rpc/fishing_list_spot_leads', {
      method: 'POST', data: { city_name: city }
    }, false).then(items => {
      if (!Array.isArray(items)) return null
      request.expires = Date.now() + 60_000
      return items
    }).catch(() => null)
  }
  leadRequest = request
  return request.result
}

const leadPlaces = new Map<string, { expires: number; result: Promise<MapPlace | undefined> }>()
let nextLeadLookup = 0
function waitForLeadLookup() {
  const now = Date.now()
  const wait = Math.max(0, nextLeadLookup - now)
  nextLeadLookup = now + wait + 1100
  return wait ? new Promise<void>(resolve => setTimeout(resolve, wait)) : Promise.resolve()
}

export function loadSpotLeadPlace(lead: SpotLead) {
  const sharedPlace = sharedLeadPlace(lead)
  if (sharedPlace) return Promise.resolve(sharedPlace)
  const key = [sessionScope.value, lead.city, lead.district, lead.name, lead.poiQuery].join(':')
  const prior = leadPlaces.get(key)
  if (prior && prior.expires > Date.now()) return prior.result
  const districtCode = lead.district
    ? districtOptions.find(region => region.city === lead.city && region.name === lead.district)?.id
    : undefined
  const region = districtCode || lead.city
  const query = lead.poiQuery || lead.name
  const slot = waitForLeadLookup()
  let result: Promise<MapPlace | undefined>
  // #ifdef H5
  result = slot.then(() => searchPlacePage(query, region)).then(({ items, hasMore }) =>
    hasMore ? undefined : matchLeadPlace(lead, items, districtCode))
  // #endif
  // #ifndef H5
  result = slot.then(() => searchMapPlaces(query, region)).then(({ items, hasMore }) =>
    hasMore ? undefined : matchLeadPlace(lead, items, districtCode))
  // #endif
  const cached = { expires: Date.now() + 15 * 60_000, result: result.catch(() => {
    // Allow another attempt after a temporary provider outage.
    leadPlaces.delete(key)
    return undefined
  }) }
  leadPlaces.set(key, cached)
  if (leadPlaces.size > 40) leadPlaces.delete(leadPlaces.keys().next().value!)
  return cached.result
}

let noticeRequest: { scope: number; expires: number; result: Promise<WaterNotice[]> } | undefined
export function loadWaterNotices() {
  const scope = sessionScope.value
  if (noticeRequest?.scope === scope && noticeRequest.expires > Date.now()) return noticeRequest.result
  const result = sessionRequest<{ items: WaterNotice[] }>('/functions/v1/spot-discovery', {
    method: 'POST', timeout: discoveryTimeoutMs, data: { operation: 'water_notices' }
  }).then(response => Array.isArray(response.items) ? response.items : []).catch(() => [])
  noticeRequest = { scope, expires: Date.now() + 15 * 60_000, result }
  return result
}

export interface SocialAccount {
  platform: Platform
  available: boolean
  boundAt: string | null
}
export function socialAccounts<T>(operation: string, details: Record<string, string> = {}) {
  return sessionRequest<T>('/functions/v1/social-accounts', {
    method: 'POST',
    data: { operation, ...details }
  })
}
