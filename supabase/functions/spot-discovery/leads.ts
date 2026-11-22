import { fishingRpc, FishingError } from '../_shared/fishing-edge.ts'
import { loadFishingAi, type FishingAi } from '../_shared/fishing-ai.ts'
import { mediaSource, professionalMediaSites, shareSource, type SpotLead, type SpotLeadResult } from '../_shared/discovery-contract.ts'
import { analyzeSpotSources, mergeSpotLeadSources } from '../_shared/spot-lead-analysis.ts'
import { fishingWebSearch, webSearchKey } from '../_shared/fishing-web-search.ts'

const sources = [
  { platform: 'douyin', sites: 'site:douyin.com' },
  { platform: 'toutiao', sites: 'site:toutiao.com' },
  { platform: 'bilibili', sites: 'site:bilibili.com' },
  { platform: 'media', sites: '(' + professionalMediaSites.map(host => 'site:' + host).join(' OR ') + ')' }
] as const
async function collectCityLeads(city: string, key: string, ask: FishingAi): Promise<SpotLeadResult> {
  const cityName = city.replace(/市$/, '')
  const batches = await Promise.all(sources.map(async ({ platform, sites }) => {
    const result = await fishingWebSearch(
      cityName + ' (钓场 OR 钓点 OR 垂钓 OR 路亚) ' + sites, key, {
        count: 20, excerpts: true, recent: platform !== 'media'
      }
    )
    if (!result) return { items: [], status: 'search_failed' } as const
    const documents = result.flatMap(row => {
      const source = typeof row?.url === 'string' ? shareSource(row.url) || mediaSource(row.url) : null
      return source?.platform === platform ? [{
        source, title: row.title, description: row.description,
        excerpts: row.extra_snippets, publishedOn: row.page_age
      }] : []
    })
    const items = await analyzeSpotSources(city, documents, ask)
    return items ? { items, status: 'ready' } as const : { items: [], status: 'analysis_failed' } as const
  }))
  const locations: SpotLead[] = []
  for (let index = 0; index < 6; index++) {
    for (const batch of batches) {
      const item = batch.items[index]
      if (item) locations.push(item)
    }
  }
  const statuses = batches.map(batch => batch.status)
  return {
    items: mergeSpotLeadSources(locations).slice(0, 20),
    status: statuses.includes('ready') ? 'ready' :
      statuses.includes('analysis_failed') ? 'analysis_failed' : 'search_failed'
  }
}

const cityCache = new Map<string, { until: number; result: Promise<SpotLeadResult> }>()
export async function discoverSpotLeads(uid: string, city: unknown): Promise<SpotLeadResult> {
  if (typeof city !== 'string' || !/^[\p{Script=Han}]{2,20}$/u.test(city))
    throw new FishingError('INVALID_INPUT', 400)
  const published = await fishingRpc<SpotLead[]>('fishing_list_spot_leads', { city_name: city }).catch(() => [])
  if (published.length) return { items: published, status: 'ready' }
  const key = webSearchKey()
  if (!key) {
    console.info('[spot-discovery] leads unconfigured', { search: false })
    return { items: [], status: 'unconfigured' }
  }
  const cached = cityCache.get(city)
  if (cached && cached.until > Date.now()) return cached.result
  const ask = await loadFishingAi()
  if (!ask) {
    console.info('[spot-discovery] leads unconfigured', { artClient: false })
    return { items: [], status: 'unconfigured' }
  }
  if (!await fishingRpc<boolean>('fishing_discovery_ticket', { uid }))
    return { items: [], status: 'limited' }
  const current = cityCache.get(city)
  if (current && current.until > Date.now()) return current.result
  const entry = {
    until: Date.now() + 60_000,
    result: collectCityLeads(city, key, ask).then(result => {
      entry.until = Date.now() + (result.items.length ? 30 * 60_000 : 60_000)
      console.info('[spot-discovery] leads completed', { status: result.status, count: result.items.length })
      return result
    })
  }
  cityCache.delete(city)
  cityCache.set(city, entry)
  if (cityCache.size > 32) cityCache.delete(cityCache.keys().next().value!)
  return entry.result
}
