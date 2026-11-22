export function webSearchKey() {
  return Deno.env.get('SPOT_WEB_SEARCH_API_KEY')?.trim()
}

export async function fishingWebSearch(
  query: string, key: string, { count = 12, recent = true, excerpts = false } = {}
): Promise<Record<string, unknown>[] | null> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search')
  url.search = new URLSearchParams({
    q: query, count: String(count), search_lang: 'zh-hans',
    ...(recent ? { freshness: 'py' } : {}),
    ...(excerpts ? { extra_snippets: 'true' } : {}),
    text_decorations: 'false', result_filter: 'web'
  }).toString()
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': key },
      redirect: 'error', signal: AbortSignal.timeout(3500)
    })
    if (!response.ok) return null
    const data = await response.json()
    return Array.isArray(data.web?.results) ? data.web.results.slice(0, count) : []
  } catch { return null }
}
