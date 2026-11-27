import regions from './spot-source-regions.json' with { type: 'json' }
import areas from './spot-source-areas.json' with { type: 'json' }
import type { SpotSourceDocument } from './spot-lead-analysis.ts'

/** Reject ambiguity rather than assigning an entire province to its capital. */
export function inferSourceCities(document: SpotSourceDocument, region?: string) {
  const text = document.screeningText || [document.title, document.description, ...(Array.isArray(document.excerpts) ? document.excerpts : [])].join('\n')
  const cities = region ? (regions as Record<string, string[]>)[region] || [] : Object.keys(areas)
  const full = cities.filter(city => text.includes(city))
  if (full.length) return full.length === 1 ? full : []
  const short = cities.filter(city => city.endsWith('市') && new RegExp(city.slice(0, -1) + '(?![省区县镇村])').test(text))
  if (short.length) return short.length === 1 ? short : []
  const counties = cities.filter(city => ((areas as Record<string, string[]>)[city] || []).some(area => text.includes(area)))
  return counties.length === 1 ? counties : []
}
