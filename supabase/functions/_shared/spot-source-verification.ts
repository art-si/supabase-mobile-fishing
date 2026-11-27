import { readSpotSharePosition, type SpotLead } from './discovery-contract.ts'
import type { SpotSourceDocument } from './spot-lead-analysis.ts'
import { mentionsFishingRestriction } from './spot-labels.ts'

export function sourceSafety(document: SpotSourceDocument, now = Date.now()): string | null {
  const text = [document.title, document.screeningText || [document.description,
    ...(Array.isArray(document.excerpts) ? document.excerpts : [])].join('\n')].join('\n')
  if (mentionsFishingRestriction(text)) return 'fishing_restriction'
  if (/停止营业|暂停营业|永久关闭|钓场关闭|不再开放|尚未开放|尚未营业|(?:计划|拟|正在).{0,8}(?:建设|打造).{0,12}(?:垂钓|钓场)|(?:钓场|垂钓[园区基地中心]{0,4}).{0,8}建设中/.test(text)) return 'venue_closed'
  if (/不对外开放|不(?:再|对外|提供|开展|接受).{0,6}(?:垂钓|钓鱼)|暂停(?:垂钓|钓鱼)|取消(?:垂钓|钓鱼)|仅(?:面向|接待)(?:内部|会员)/.test(text)) return 'access_unconfirmed'
  if (/开设赌场|涉嫌赌博|(?:^|[^目])标鱼|赌资/.test(text)) return 'not_a_public_venue'
  if (/比赛|赛事/.test(text) && !/对外开放|开放垂钓|接待游客|市民垂钓|提供.{0,10}垂钓|垂钓服务|日常练[竿杆]|日常垂钓|(?:可|开展|提供)休闲垂钓|垂钓体验(?:项目|服务|区)|(?:垂钓.{0,8}|基地.{0,6}|钓场.{0,6})(?:正式)?(?:投用|启用|营业)/.test(text)) return 'event_only'
  if (/(?:活动|垂钓|开放|体验)[^。！？]{0,30}(?:持续至|开放至|截止(?:至)?|仅限)[^。！？]{0,12}\d{1,2}月\d{1,2}日/.test(text)) return 'seasonal_access_unconfirmed'
  const date = typeof document.publishedOn === 'string' ? document.publishedOn.slice(0, 10) : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'publication_date_missing'
  const age = now - Date.parse(date)
  if (!Number.isFinite(age) || !new Date(Date.parse(date)).toISOString().startsWith(date) || age < -86_400_000 || age > 366 * 86_400_000) return 'publication_outdated'
  return null
}

const normalized = (text: string) => text.replace(/[\s·（）()，,]/g, '').replaceAll('硃', '朱')
export async function verifyLeadPlace(lead: SpotLead, apiKey: string, fetcher: typeof fetch = fetch,
  review?: (details: { name: string; reason: string; alternatives: { name: string; city: string; district: string }[] }) => void): Promise<SpotLead | null> {
  if (!lead.evidence || !apiKey) {
    review?.({ name: lead.name, reason: 'place_unverified', alternatives: [] })
    return null
  }
  const proof = lead.positionEvidence
  let point = readSpotSharePosition(lead.sourcePosition)
  if (proof && point && proof.url === lead.source.url && proof.name === lead.name &&
      ['structured_geo', 'text_coordinates'].includes(proof.kind) && proof.value.length > 0 && proof.value.length <= 700 &&
      JSON.stringify(readSpotSharePosition(proof.original)) === JSON.stringify(point)) {
    // Preserve the source pin. Looking up a river/lake POI would move it to the waterbody centre.
    const original = point
    if (point.crs === 'WGS84') {
      const url = new URL('https://restapi.amap.com/v3/assistant/coordinate/convert')
      url.search = new URLSearchParams({ key: apiKey, locations: `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`, coordsys: 'gps' }).toString()
      const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(8000) })
      if (!response.ok) throw new Error('MAP_UNAVAILABLE')
      const data = await response.json()
      const values = typeof data.locations === 'string' ? data.locations.split(',').map(Number) : []
      point = data.status === '1' && values.length === 2 ? readSpotSharePosition({ longitude: values[0], latitude: values[1], crs: 'GCJ-02' }) : undefined
      if (!point) throw new Error('MAP_UNAVAILABLE')
      if (Math.abs(point.longitude - original.longitude) > 0.02 || Math.abs(point.latitude - original.latitude) > 0.02)
        throw new Error('MAP_UNAVAILABLE')
    }
    const url = new URL('https://restapi.amap.com/v3/geocode/regeo')
    url.search = new URLSearchParams({ key: apiKey, location: `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`, extensions: 'base' }).toString()
    const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error('MAP_UNAVAILABLE')
    const data = await response.json()
    if (data.status !== '1' || !data.regeocode?.addressComponent) throw new Error('MAP_UNAVAILABLE')
    const address = data.regeocode.addressComponent
    const city = typeof address.city === 'string' && address.city ? address.city :
      ['北京市', '上海市', '天津市', '重庆市'].includes(address.province) ? address.province : address.district
    if (typeof city !== 'string' || normalized(city).replace(/市$/, '') !== normalized(lead.city).replace(/市$/, '') ||
        (lead.district && address.district !== lead.district)) {
      review?.({ name: lead.name, reason: 'source_point_region_mismatch', alternatives: [] })
      return null
    }
    const { poiId: _unusedPoi, ...sourceLead } = lead
    return { ...sourceLead, displayName: lead.name, positionSource: 'source', sourcePosition: point,
      positionEvidence: { ...proof, original },
      ...(typeof data.regeocode.formatted_address === 'string' ? { sourceAddress: data.regeocode.formatted_address.slice(0, 160) } : {}) }
  }
  if (lead.waterType !== '钓场') {
    review?.({ name: lead.name, reason: 'source_coordinates_missing', alternatives: [] })
    return null
  }
  const localName = (text: string) => normalized(text).replace(new RegExp('^' + normalized(lead.city) + '|^' + normalized(lead.city).replace(/市$/, '')), '')
  const names = [lead.name, lead.poiQuery].filter((v): v is string => Boolean(v)).map(localName)
  const pois = new Map<string, { id: string; longitude: number; latitude: number }>()
  const alternatives: Record<string, unknown>[] = []
  const withoutCity = lead.city.endsWith('市') ? lead.name.replace(new RegExp('^' + lead.city.replace(/市$/, '') + '市?'), '') : lead.name
  const queries = [...new Set([lead.poiQuery || lead.name, lead.name, withoutCity])].filter(query => query.length >= 2)
  for (const query of queries) {
    const url = new URL('https://restapi.amap.com/v3/place/text')
    url.search = new URLSearchParams({ key: apiKey, keywords: query, city: lead.city,
      citylimit: 'true', offset: '10', page: '1', extensions: 'base' }).toString()
    const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error('MAP_UNAVAILABLE')
    const data = await response.json()
    if (data.status !== '1' || !Array.isArray(data.pois)) throw new Error('MAP_UNAVAILABLE')
    alternatives.push(...data.pois.slice(0, 3))
    for (const poi of data.pois.slice(0, 10)) {
    const location = typeof poi.location === 'string' ? poi.location.split(',').map(Number) : []
    if ((typeof poi.type === 'string' && /自然地名|自然景观|河流|水库|湖泊/.test(poi.type)) ||
      typeof poi.id !== 'string' || !/^[A-Za-z\d]{5,40}$/.test(poi.id) || typeof poi.name !== 'string' ||
      !names.includes(localName(poi.name)) || typeof poi.cityname !== 'string' || normalized(poi.cityname).replace(/市$/, '') !== normalized(lead.city).replace(/市$/, '') ||
      (lead.district && poi.adname !== lead.district) || location.length !== 2 ||
      !Number.isFinite(location[0]) || !Number.isFinite(location[1]) || location[0]! < 73 || location[0]! > 136 || location[1]! < 3 || location[1]! > 54) continue
    pois.set(poi.id, { id: poi.id, longitude: location[0]!, latitude: location[1]! })
    }
    // Retry the original venue name when a long editorial query only finds nearby facilities.
    // Keep the same exact-name/city/district/unique-ID requirements on every query.
    if (pois.size) break
  }
  if (pois.size !== 1) {
    review?.({ name: lead.name, reason: !alternatives.length ? 'poi_not_found' : pois.size > 1 ? 'poi_ambiguous' : 'poi_name_or_region_mismatch',
      alternatives: alternatives.slice(0, 3).map(poi => ({ name: String(poi.name || '').slice(0, 60), city: String(poi.cityname || '').slice(0, 30), district: String(poi.adname || '').slice(0, 30) })) })
    return null
  }
  const poi = [...pois.values()][0]!
  return { ...lead, displayName: lead.name, poiId: poi.id, positionSource: 'amap', sourcePosition: { longitude: poi.longitude, latitude: poi.latitude, crs: 'GCJ-02' } }
}
