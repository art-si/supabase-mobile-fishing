import { publicArticleSource, spotSyndicationFeeds } from './spot-publishers.ts'
import { spotPublicIndexes } from './spot-public-indexes.ts'
import { parseShareSource, readSpotSharePosition } from './discovery-contract.ts'
import type { SpotPositionEvidence } from './discovery-contract.ts'
import type { SpotSourceDocument } from './spot-lead-analysis.ts'

type Fetch = typeof fetch
const originalSource = (url: string) => parseShareSource(url) || publicArticleSource(url)
function registeredFeed(url: string) {
  return (spotSyndicationFeeds as readonly string[]).includes(url) || spotPublicIndexes.some(index => index.url === url ||
    (index.url.includes('.chinanews.com.cn/') && index.url.replace('.chinanews.com.cn/', '.chinanews.com/') === url))
}
const agent = 'DiaoyoujiSourceBot/1.0'
const maxBytes = 1_000_000
export class SourceReadError extends Error {
  constructor(readonly reason: string, readonly retryable = false, readonly status = 0) { super(reason) }
}

function entities(text: string) {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·' }
  return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (raw, code: string) => {
    if (code[0] !== '#') return named[code] ?? raw
    const point = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ' '
  })
}
export function articleText(html: string) {
  return entities(html.replace(/<!--[^]*?-->/g, ' ').replace(/<(script|style|nav|header|footer|aside)\b[^>]*>[^]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')).replace(/[\s\u200b]+/g, ' ').trim()
}
function metadata(html: string, names: string[]) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*["']([^]*?)["']/g)].map(m => [m[1]!.toLowerCase(), entities(m[2]!)]))
    if (names.map(name => name.toLowerCase()).includes((attrs.property || attrs.name || attrs.itemprop || '').toLowerCase())) return attrs.content || ''
  }
  return ''
}
function structuredPost(html: string) {
  const result: Record<string, unknown>[] = []
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([^]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]!)
      const nodes = Array.isArray(parsed) ? parsed : [parsed, ...(Array.isArray(parsed?.['@graph']) ? parsed['@graph'] : [])]
      for (const node of nodes.slice(0, 32)) if (node && typeof node === 'object' && /VideoObject|Article|SocialMediaPosting/i.test(String(node['@type']))) result.push(node)
    } catch { /* Malformed structured data never becomes executable code. */ }
  }
  return result
}
export interface SourcePlaceAnnotation { name: string; query?: string; evidence?: string; district?: string; managedVenue?: boolean }
// A content location describes this post, unlike an author's home or publisher address.
// Only one explicitly named point is accepted; an area/route or multiple points need review.
function sourcePoint(post: Record<string, unknown> | undefined, text: string, url: string, annotations: readonly SourcePlaceAnnotation[]) {
  const places = post?.contentLocation
  const place = places && typeof places === 'object' && !Array.isArray(places) ? places as Record<string, unknown> : undefined
  const geo = place?.geo && typeof place.geo === 'object' && !Array.isArray(place.geo) ? place.geo as Record<string, unknown> : undefined
  const name = typeof place?.name === 'string' ? articleText(place.name) : ''
  const position = geo?.['@type'] === 'GeoCoordinates' && readSpotSharePosition({
    longitude: typeof geo.longitude === 'string' && /^\d{2,3}\.\d{3,9}$/.test(geo.longitude) ? Number(geo.longitude) : geo.longitude,
    latitude: typeof geo.latitude === 'string' && /^\d{1,2}\.\d{3,9}$/.test(geo.latitude) ? Number(geo.latitude) : geo.latitude,
    crs: 'WGS84'
  })
  if (name.length >= 2 && name.length <= 40 && position) {
    const address = typeof place?.address === 'string' ? place.address : ''
    const value = JSON.stringify({ name, geo: { '@type': 'GeoCoordinates', longitude: geo!.longitude, latitude: geo!.latitude } })
    return { poiName: name, sourcePosition: position, location: address,
      positionEvidence: { url, name, kind: 'structured_geo', value, original: position } satisfies SpotPositionEvidence }
  }
  // Numeric pairs without an explicit CRS/order can be a map offset or an unrelated number.
  const matches = [...text.matchAll(/(?:WGS[ -]?84|GCJ[ -]?02|高德坐标)[：:\s，,]*(?:经度[：:\s]*)?(\d{2,3}\.\d{3,9})[，,\s]+(?:纬度[：:\s]*)?(\d{1,2}\.\d{3,9})/gi)]
  if (matches.length !== 1) return
  const match = matches[0]!
  const quote = text.slice(Math.max(0, match.index - 80), match.index + match[0].length + 80)
  const label = /(?:钓位|钓点|地点|位置)[：:]\s*([\p{Script=Han}\d]{2,40})(?=[，,。；;\s])/u.exec(quote)?.[1]
  const hints = [...new Set([...annotations.filter(p => quote.includes(p.name)).map(p => p.name),
    ...(name && quote.includes(name) ? [name] : []), ...(label ? [label] : [])])]
  if (hints.length !== 1) return
  if (/^(?:这里|那里|钓点|钓位|秘密基地|位置|附近|岸边)$/.test(hints[0]!)) return
  const point = readSpotSharePosition({ longitude: Number(match[1]), latitude: Number(match[2]), crs: /^WGS/i.test(match[0]) ? 'WGS84' : 'GCJ-02' })
  if (point) return { poiName: hints[0]!, sourcePosition: point,
    positionEvidence: { url, name: hints[0]!, kind: 'text_coordinates', value: quote, original: point } satisfies SpotPositionEvidence }
}
export function sourceDocument(html: string, url: string, annotations: readonly SourcePlaceAnnotation[] = []): SpotSourceDocument {
  const source = originalSource(url)
  if (!source) throw new SourceReadError('unsupported_source')
  const social = source.platform !== 'public' && source.platform !== 'media'
  const linkedPosts = social ? structuredPost(html) : []
  const canonical = metadata(html, ['og:url']) || /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(html)?.[1] ||
    (source.platform === 'wechat' ? /\bmsg_link\s*=\s*["']([^"']+)["']/.exec(html)?.[1] : '') ||
    linkedPosts.find(post => typeof post.url === 'string')?.url as string || ''
  const canonicalSource = parseShareSource(entities(canonical).replace(/^http:/, 'https:'))
  const post = linkedPosts.find(post => {
    const candidate = typeof post.url === 'string' ? parseShareSource(post.url.replace(/^http:/, 'https:')) : null
    return candidate?.platform === source.platform && canonicalSource && new URL(candidate.url).pathname === new URL(canonicalSource.url).pathname
  })
  const heading = /<h1\b[^>]*>([^]*?)<\/h1>/i.exec(html)?.[1]
  const title = (heading ? articleText(heading) : '') || metadata(html, ['og:title', 'twitter:title']) || articleText(/<title\b[^>]*>([^]*?)<\/title>/i.exec(html)?.[1] || '')
  // Prefer the article body, avoiding recommendations and footer notices about different places.
  let body = [...html.matchAll(/<article\b[^>]*>([^]*?)<\/article>/gi)].map(match => match[1]!).find(candidate => articleText(candidate).length >= 60)
  if (!body) {
    const containers = html.matchAll(/<div\b[^>]*(?:id|class)=["'][^"']*(?:article-content|article_content|articleContent|detail-cont|content-edit|TRS_Editor|TRS_UEDITOR|zwCon|left_zw|news_content|NewsContent|js_content)[^"']*["'][^>]*>/gi)
    for (const container of containers) {
      const start = container.index + container[0].length
      const tags = /<\/?div\b[^>]*>/gi
      tags.lastIndex = start
      let depth = 1, tag: RegExpExecArray | null
      while ((tag = tags.exec(html))) {
        depth += /^<\//.test(tag[0]) ? -1 : 1
        if (!depth) {
          const candidate = html.slice(start, tag.index)
          if (articleText(candidate).length >= 60) body = candidate
          break
        }
      }
      if (body) break
    }
  }
  body ||= html
  const postText = social ? (typeof post?.articleBody === 'string' ? post.articleBody : typeof post?.description === 'string' ? post.description : metadata(html, ['og:description', 'description'])) : ''
  const text = articleText(postText && source.platform !== 'wechat' ? postText : body)
  if (social) {
    if (/笔记(?:不存在|无法浏览|已删除)|视频(?:不存在|已删除)|作品(?:不存在|已删除)|内容不存在|页面不存在|请登录后|登录后(?:查看|即可)|环境异常|访问过于频繁|安全验证/.test(articleText(body)))
      throw new SourceReadError('content_unavailable')
    const short = /^(?:v\.douyin\.com|b23\.tv|(?:www\.)?xhslink\.(?:com|cn))$/.test(new URL(url).hostname)
    if (!canonicalSource || canonicalSource.platform !== source.platform || (!short && source.platform !== 'wechat' && new URL(canonicalSource.url).pathname.replace(/\/$/, '') !== new URL(source.url).pathname.replace(/\/$/, '')))
      throw new SourceReadError('content_identity_unconfirmed')
    const author = post?.author && typeof post.author === 'object' ? (post.author as Record<string, unknown>).name : post?.author
    const byline = typeof author === 'string' ? author : metadata(html, ['author', 'article:author'])
    if (byline) source.author = articleText(byline).slice(0, 60)
    source.kind = post?.['@type'] === 'VideoObject' || /\/video\//.test(new URL(source.url).pathname) ? '视频' : '图文'
  }
  if (/验证码|访问过于频繁|安全验证|Access Denied|Just a moment/i.test(title) || text.length < (social ? 20 : 60)) throw new SourceReadError('unreadable_article')
  const urlDate = /(20\d\d)[/-](\d{2})[/-](\d{2})/.exec(new URL(url).pathname)?.slice(1, 4).join('-') || ''
  const wechatTime = source.platform === 'wechat' ? /\b(?:ct|publish_time|create_time)\s*[:=]\s*["']?([12]\d{9})\b/.exec(html)?.[1] : undefined
  const date = metadata(html, ['article:published_time', 'publishdate', 'pubdate', 'PubDate', 'date', 'publishDate', 'sourcetime']) ||
    (typeof post?.datePublished === 'string' ? post.datePublished : '') || (wechatTime ? new Date(Number(wechatTime) * 1000 + 28_800_000).toISOString() : '') || urlDate ||
    /(20\d\d)[年/-](\d{1,2})[月/-](\d{1,2})[日\sT]/.exec(articleText(html))?.slice(1, 4).map(s => s.padStart(2, '0')).join('-') || ''
  // Only short relevant passages go to the extractor. Whole articles are never persisted.
  const passages = text.match(/[^。！？；]{0,180}(?:垂钓|路亚|钓场|渔场|钓鱼|禁钓|禁止垂钓|停止营业|暂停营业)[^。！？；]{0,180}[。！？；]?/gu) ?? []
  const reviewedPlaces = annotations.slice(0, 6).flatMap(place => {
    const evidence = typeof place.evidence === 'string' ? place.evidence.trim() : ''
    if (typeof place.name !== 'string' || place.name.length < 2 || place.name.length > 40 ||
      evidence.length < 4 || evidence.length > 90 || !text.includes(place.name) || !text.includes(evidence)) return []
    // Maps can join a village or venue and its named facility with a middle dot.
    const parts = place.query?.split('·')
    const sameLocality = parts?.length === 2 && parts[1] === place.name && parts[0]!.length >= 2 &&
      text.split(parts[0]!).slice(1).some(passage => passage.slice(0, 90).includes(place.name))
    return [{ name: place.name, evidence,
      ...(place.managedVenue === true && /园区|景区|农庄|营地|生态鱼塘|垂钓园/.test(text) ? { managedVenue: true } : {}),
      ...(place.query && (place.name.includes(place.query) || text.includes(place.query) || sameLocality) ? { query: place.query } : {}),
      ...(place.district && text.includes(place.district) ? { district: place.district } : {}) }]
  })
  return { source, title: title.slice(0, 180), description: text.slice(0, 420),
    ...sourcePoint(post, text, source.url, annotations),
    excerpts: passages.slice(0, 8).map(p => p.slice(0, 420)), publishedOn: date.slice(0, 10), screeningText: text, reviewedPlaces }
}

export function robotsAllowed(text: string, pathname: string) {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = []
  let group: (typeof groups)[number] | undefined
  for (const line of text.split(/\r?\n/)) {
    const entry = /^\s*([\w-]+)\s*:\s*(.*?)\s*(?:#.*)?$/.exec(line)
    if (!entry) continue
    const field = entry[1]!.toLowerCase(), value = entry[2]!.trim()
    if (field === 'user-agent') {
      if (!group || group.rules.length) { group = { agents: [], rules: [] }; groups.push(group) }
      group.agents.push(value.toLowerCase())
    } else if (group && ['allow', 'disallow'].includes(field) && value) group.rules.push({ allow: field === 'allow', path: value })
  }
  const specific = groups.filter(g => g.agents.some(a => a !== '*' && agent.toLowerCase().startsWith(a)))
  const rules = (specific.length ? specific : groups.filter(g => g.agents.includes('*'))).flatMap(g => g.rules)
  const matching = rules.filter(r => {
    const escaped = r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')
    return new RegExp('^' + escaped).test(pathname)
  }).sort((a, b) => b.path.replace(/\*/g, '').length - a.path.replace(/\*/g, '').length || Number(b.allow) - Number(a.allow))
  return matching[0]?.allow ?? true
}

async function boundedText(response: Response, limit = maxBytes) {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new SourceReadError('article_too_large') }
  const reader = response.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder(/charset\s*=\s*(gbk|gb2312|gb18030)/i.test(response.headers.get('content-type') || '') ? 'gb18030' : 'utf-8')
  let result = '', size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > limit) { await reader.cancel(); throw new SourceReadError('article_too_large') }
      result += decoder.decode(value, { stream: true })
    }
    return result + decoder.decode()
  } finally { reader.releaseLock() }
}

export function createSourceReader(fetcher: Fetch = fetch) {
  const robots = new Map<string, { until: number; result: Promise<string> }>()
  async function get(url: string, isRobots = false, redirects = 0, feed = false): Promise<string> {
    try {
      const response = await fetcher(url, { redirect: 'manual', headers: { 'User-Agent': agent, Accept: isRobots ? 'text/plain' : 'text/html,application/rss+xml,application/xml' }, signal: AbortSignal.timeout(12_000) })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const target = new URL(response.headers.get('location') || '', url)
        await response.body?.cancel()
        if (redirects >= 3 || target.protocol !== 'https:' || target.username || target.password || target.port ||
          (isRobots ? target.origin !== new URL(url).origin : feed ? !registeredFeed(target.href) : !originalSource(target.href))) throw new SourceReadError('redirect_requires_review')
        if (!isRobots) await allowed(target)
        return get(target.href, isRobots, redirects + 1, feed)
      }
      if (isRobots && [404, 410].includes(response.status)) { await response.body?.cancel(); return '' }
      if (response.status === 429 || response.status >= 500) { await response.body?.cancel(); throw new SourceReadError('source_unavailable', true, response.status) }
      if (!response.ok) { await response.body?.cancel(); throw new SourceReadError(response.status >= 300 && response.status < 400 ? 'redirect_requires_review' : 'source_http_' + response.status, false, response.status) }
      const type = response.headers.get('content-type') || ''
      if (!isRobots && !/text\/html|application\/(rss\+xml|atom\+xml|xml)|text\/xml/i.test(type)) { await response.body?.cancel(); throw new SourceReadError('unsupported_content_type') }
      return await boundedText(response, isRobots ? 100_000 : maxBytes)
    } catch (error) {
      if (error instanceof SourceReadError) throw error
      throw new SourceReadError('network_error', true)
    }
  }
  async function allowed(parsed: URL) {
    if (!robots.has(parsed.origin) || robots.get(parsed.origin)!.until < Date.now()) {
      const result = get(parsed.origin + '/robots.txt', true).catch(error => { robots.delete(parsed.origin); throw error })
      robots.set(parsed.origin, { until: Date.now() + 3_600_000, result })
      if (robots.size > 64) robots.delete(robots.keys().next().value!)
    }
    if (!robotsAllowed(await robots.get(parsed.origin)!.result, parsed.pathname)) throw new SourceReadError('robots_disallowed')
  }
  async function read(url: string, feed = false) {
    if (feed ? !registeredFeed(url) : !originalSource(url)) throw new SourceReadError('unsupported_source')
    await allowed(new URL(url))
    return get(url, false, 0, feed)
  }
  return { article: async (url: string, annotations?: readonly SourcePlaceAnnotation[]) => sourceDocument(await read(url), url, annotations), feed: (url: string) => read(url, true) }
}

export function indexArticles(html: string, indexUrl: string, city: string) {
  const entries = new Map<string, { city: string; url: string }>()
  let articleLinks = 0
  for (const match of html.matchAll(/<a\b([^>]*?)>([^]*?)<\/a>/gi)) {
    const href = /(?:^|\s)href\s*=\s*(["'])([^]*?)\1/i.exec(match[1]!)?.[2]
    if (!href) continue
    let url: URL
    try { url = new URL(entities(href), indexUrl) } catch { continue }
    if (url.protocol === 'http:') url.protocol = 'https:'
    const cns = (host: string) => /(?:^|\.)chinanews\.com(?:\.cn)?$/.test(host)
    if ((url.origin !== new URL(indexUrl).origin && !(cns(url.hostname) && cns(new URL(indexUrl).hostname))) || !/\d{6}|[a-f\d]{24}/i.test(url.pathname)) continue
    const source = publicArticleSource(url.href)
    if (!source || source.url === indexUrl) continue
    articleLinks++
    const title = articleText(match[2]!) || /\btitle\s*=\s*(["'])([^]*?)\1/i.exec(match[1]!)?.[2] || ''
    if (!/垂钓|钓鱼|海钓|路亚|渔乐|钓场|休闲渔业|农庄|庄园|休闲农业|乡村旅游/.test(title)) continue
    entries.set(source.url, { city, url: source.url })
  }
  return { articleLinks, items: [...entries.values()].slice(0, 8) }
}

export function feedArticles(xml: string, cities: string[]) {
  return (xml.match(/<(?:item|entry)\b[^>]*>[^]*?<\/(?:item|entry)>/gi) ?? []).slice(0, 80).flatMap(item => {
    const text = articleText(item.replace(/<!\[CDATA\[([^]*?)\]\]>/g, '$1'))
    if (!/钓鱼|垂钓|钓场|路亚|海钓/.test(text)) return []
    const raw = /<link[^>]*>([^]*?)<\/link>/.exec(item)?.[1] || /<link[^>]*href=["']([^"']+)["']/.exec(item)?.[1] || ''
    const source = publicArticleSource(entities(raw.replace(/<!\[CDATA\[([^]*?)\]\]>/g, '$1').trim()).replace(/^http:/, 'https:'))
    if (!source) return []
    const matches = cities.filter(city => text.includes(city.replace(/市$/, '')))
    return matches.slice(0, 3).map(city => ({ city, url: source.url }))
  })
}
