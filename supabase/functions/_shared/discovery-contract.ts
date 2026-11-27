import { publisherSource, spotPublishers } from './spot-publishers.ts'

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
export const sourcePlatforms = { ...platforms, xiaohongshu: '小红书', wechat: '微信公众号' } as const
export type SourcePlatform = keyof typeof sourcePlatforms
export interface ShareSource {
  platform: SourcePlatform
  url: string
  author?: string
  kind?: '图文' | '视频'
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
/** Copied from the fetched original, never from model output or an import hint. */
export interface SpotPositionEvidence {
  url: string
  name: string
  kind: 'structured_geo' | 'text_coordinates'
  value: string
  original: SpotSharePosition
}
export interface SpotLead {
  name: string
  displayName?: string
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
  verifiedAt?: string
  poiId?: string
  positionSource?: 'amap' | 'source'
  locationScope?: 'entrance' | 'shoreline'
  catchFrame?: SpotCatchFrame
  positionEvidence?: SpotPositionEvidence
}

export interface SpotCatchFrame {
  key: string
  seconds: number
  sourceUrl: string
  description: string
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
  return sourcePlatforms[source.platform]
}
export interface WaterNotice {
  name: string
  evidence: string
  sourceUrl: string
  validFrom: string
  validUntil: string
}
export const spotLabelBatchSize = 12

const shareHosts: Record<string, SourcePlatform> = {
  'www.douyin.com': 'douyin', 'v.douyin.com': 'douyin', 'jingxuan.douyin.com': 'douyin',
  'www.toutiao.com': 'toutiao', 'm.toutiao.com': 'toutiao', 'toutiao.com': 'toutiao',
  'www.bilibili.com': 'bilibili', 'm.bilibili.com': 'bilibili', 't.bilibili.com': 'bilibili', 'b23.tv': 'bilibili',
  'www.xiaohongshu.com': 'xiaohongshu', 'xiaohongshu.com': 'xiaohongshu',
  'mp.weixin.qq.com': 'wechat',
  'xhslink.com': 'xiaohongshu', 'www.xhslink.com': 'xiaohongshu', 'xhslink.cn': 'xiaohongshu', 'www.xhslink.cn': 'xiaohongshu'
}

export function parseShareSource(link: string): ShareSource | null {
  if (link.length > 500) return null
  try {
    const url = new URL(link)
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !Object.hasOwn(shareHosts, url.hostname)) return null
    const platform = shareHosts[url.hostname]!
    if (platform === 'wechat') {
      if (/^\/s\/[A-Za-z\d_-]{10,80}$/.test(url.pathname)) return { platform, url: url.origin + url.pathname }
      if (url.pathname !== '/s') return null
      const biz = url.searchParams.get('__biz'), mid = url.searchParams.get('mid'), idx = url.searchParams.get('idx'), sn = url.searchParams.get('sn')
      if (!biz || !/^[A-Za-z\d_+=/-]{6,100}$/.test(biz) || !mid || !/^\d{6,20}$/.test(mid) || !idx || !/^\d{1,3}$/.test(idx) || !sn || !/^[a-f\d]{16,64}$/i.test(sn)) return null
      const canonical = new URL('https://mp.weixin.qq.com/s')
      canonical.search = new URLSearchParams({ __biz: biz, mid, idx, sn }).toString()
      return { platform, url: canonical.href }
    }
    if (platform === 'xiaohongshu') {
      if (url.hostname.includes('xhslink.')) return /^\/(?:[ao]\/)?[A-Za-z\d_-]{4,100}\/?$/.test(url.pathname)
        ? { platform, url: url.origin + url.pathname } : null
      const note = /^\/(?:explore|discovery\/item)\/([a-f\d]{24})\/?$/i.exec(url.pathname)
      if (!note) return null
      const canonical = new URL('https://www.xiaohongshu.com/explore/' + note[1])
      // Keep only the signed public share fields needed to open a note, never account cookies.
      for (const key of ['xsec_token', 'xsec_source']) {
        const value = url.searchParams.get(key)
        if (value && /^[A-Za-z\d_+=./-]{1,180}$/.test(value)) canonical.searchParams.set(key, value)
      }
      return { platform, url: canonical.href }
    }
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
    const parsed = new URL(source.url)
    const identity = source.platform === 'wechat' && parsed.pathname === '/s'
      ? source.url : parsed.origin + parsed.pathname.replace(/\/$/, '')
    const previous = links.get(identity)
    if (!previous || source.url.length > previous.url.length) links.set(identity, source)
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

export const professionalMediaSites = spotPublishers.map(([host]) => host)

export function mediaSource(value: string): Extract<LeadSource, { platform: 'media' }> | null {
  return publisherSource(value)
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
