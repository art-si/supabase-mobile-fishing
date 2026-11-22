export const preferences = {
  catch: '鱼情好',
  quiet: '人少',
  setting: '环境好',
  parking: '停车方便',
  family: '适合亲子'
} as const
export type Preference = keyof typeof preferences
export const preferenceKeys = Object.keys(preferences) as Preference[]
export const platforms = {
  douyin: '抖音',
  toutiao: '今日头条',
  bilibili: 'B 站'
} as const
export type Platform = keyof typeof platforms
export interface ShareSource {
  platform: Platform
  url: string
}
export type SpotLabels = Partial<Record<Preference, string>>
export interface SpotLabelBatch {
  mode: 'ai' | 'observations'
  items: { spotId: string; labels: SpotLabels }[]
}
export type LeadSource = ShareSource |
  { platform: 'public'; url: string; publisher?: string } |
  { platform: 'media'; url: string; publisher: string }
export interface SpotSharePosition {
  longitude: number
  latitude: number
  crs: 'GCJ-02' | 'WGS84'
}
export interface SpotLead {
  name: string
  city: string
  waterType: '' | '自然水域' | '水库' | '钓场'
  poiQuery?: string
  district?: string
  sourceAddress?: string
  sourcePosition?: SpotSharePosition
  evidence?: string
  labels: SpotLabels
  source: LeadSource
  relatedSources?: LeadSource[]
  sourceDate: string
}

export function readSpotSharePosition(value: unknown): SpotSharePosition | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const { longitude, latitude, crs } = value as Record<string, unknown>
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < 73 || longitude > 136 ||
      typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < 3 || latitude > 54 ||
      (crs !== 'GCJ-02' && crs !== 'WGS84')) return
  return { longitude, latitude, crs }
}
export interface SpotLeadResult {
  items: SpotLead[]
  status: 'ready' | 'unconfigured' | 'limited' | 'search_failed' | 'analysis_failed'
}
export function leadSourceName(source: LeadSource) {
  if (source.platform === 'public') return source.publisher || '公开资料'
  if (source.platform === 'media') return source.publisher
  return platforms[source.platform]
}
export interface WaterNotice {
  name: string
  evidence: string
  sourceUrl: string
  validFrom: string
  validUntil: string
}
export const spotLabelBatchSize = 12

const shareHosts: Record<string, Platform> = {
  'www.douyin.com': 'douyin', 'v.douyin.com': 'douyin', 'jingxuan.douyin.com': 'douyin',
  'www.toutiao.com': 'toutiao', 'm.toutiao.com': 'toutiao', 'toutiao.com': 'toutiao',
  'www.bilibili.com': 'bilibili', 'm.bilibili.com': 'bilibili', 't.bilibili.com': 'bilibili', 'b23.tv': 'bilibili'
}

export function parseShareSource(link: string): ShareSource | null {
  if (link.length > 500) return null
  try {
    const url = new URL(link)
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !Object.hasOwn(shareHosts, url.hostname)) return null
    const platform = shareHosts[url.hostname]!
    const short = ['v.douyin.com', 'b23.tv'].includes(url.hostname)
    const fullContent = /^\/(video|article|item|note)\/[\w-]+\/?$/
    const curatedVideo = url.hostname === 'jingxuan.douyin.com' && /^\/m\/video\/\d+\/?$/.test(url.pathname)
    const biliVideo = url.hostname === 'www.bilibili.com' && /^\/list\/\d+\/?$/.test(url.pathname)
      ? url.searchParams.get('bvid') : null
    if (biliVideo && /^BV[\w]+$/.test(biliVideo))
      return { platform, url: 'https://www.bilibili.com/video/' + biliVideo + '/' }
    const biliPost = platform === 'bilibili' && (url.hostname === 't.bilibili.com'
      ? /^\/(\d+)\/?$/.exec(url.pathname) : /^\/opus\/(\d+)\/?$/.exec(url.pathname))
    if (biliPost) return { platform, url: 'https://www.bilibili.com/opus/' + biliPost[1] }
    const toutiaoShare = /^\/(?:i\d+|is\/[\w-]+|w\/\d+)\/?$/
    if (!(short ? /^\/[\w-]+\/?$/.test(url.pathname)
      : curatedVideo || fullContent.test(url.pathname) || (platform === 'toutiao' && toutiaoShare.test(url.pathname))))
      return null
    return { platform, url: url.origin + url.pathname }
  } catch { return null }
}

export function splitSpotShareText(value: string): { description: string; sources: ShareSource[] } {
  const links = new Map<string, ShareSource>()
  const description = value.replace(/https:\/\/[^\s，。；！？、（）【】“”<>]+/gu, raw => {
    const link = raw.replace(/[),.!?;]+$/, '')
    const source = parseShareSource(link)
    if (!source) return raw
    links.set(source.url.replace(/\/$/, ''), source)
    return raw.slice(link.length)
  })
  return { description: description.trim(), sources: [...links.values()] }
}

export function shareSources(value: string): ShareSource[] {
  return splitSpotShareText(value).sources
}

export function shareSource(value: string): ShareSource | null {
  return shareSources(value)[0] ?? null
}

const mediaHosts: Readonly<Record<string, string>> = {
  'm.diaoyu.com': '钓鱼之家', 'www.diaoyu.com': '钓鱼之家',
  'm.diaoyur.com': '钓鱼人', 'www.diaoyur.com': '钓鱼人',
  'www.haodiaoyu.com': '好钓鱼',
  'news.hubeidaily.net': '湖北日报', 'www.cnhubei.com': '荆楚网', 'news.cnhubei.com': '荆楚网',
  'www.ctdsb.net': '极目新闻',
  'm.app.dawuhanapp.com': '长江日报', 'cjrb.cjn.cn': '长江日报',
  'whwb.cjn.cn': '武汉晚报', 'news.cjn.cn': '长江网',
  'www.thepaper.cn': '澎湃新闻', 'www.news.cn': '新华网',
  'people.com.cn': '人民网', 'hb.people.com.cn': '人民网'
}
export const professionalMediaSites = [
  'diaoyu.com', 'diaoyur.com', 'haodiaoyu.com', 'hubeidaily.net', 'cnhubei.com',
  'ctdsb.net', 'dawuhanapp.com', 'cjn.cn', 'thepaper.cn', 'news.cn', 'people.com.cn'
] as const

export function mediaSource(value: string): Extract<LeadSource, { platform: 'media' }> | null {
  if (value.length > 500) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !Object.hasOwn(mediaHosts, url.hostname) || !/\d{3,}/.test(url.pathname)) return null
    if (url.hostname.endsWith('.diaoyu.com') && !/^\/diaochang\/[a-z-]+\/\d+\.html$/.test(url.pathname))
      return null
    return { platform: 'media', url: url.origin + url.pathname, publisher: mediaHosts[url.hostname]! }
  } catch { return null }
}

export interface DiscoveryItem {
  spotId?: string
  name: string
  species: string
  observedOn: string | null
  source?: ShareSource
  evidence?: string
}
export interface DiscoveryResult {
  mode: 'ai' | 'recent'
  items: DiscoveryItem[]
}

export function governmentNoticeUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.endsWith('.gov.cn') &&
      !url.username && !url.password && !url.port && url.pathname.length > 1
      ? url.href : null
  } catch { return null }
}
