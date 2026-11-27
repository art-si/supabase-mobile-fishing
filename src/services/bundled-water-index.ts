// Shared by all location entry points, using the same licensed files as H5.
// Static module dependencies are
// included by WeChat preview/upload; raw JSON files are not runtime assets.
import manifest from '@/static/web/water-index/manifest.json'
import southWest from '@/static/web/water-index/20261120T142112Z/456_121.json'
import northWest from '@/static/web/water-index/20261120T142112Z/456_122.json'
import southEast from '@/static/web/water-index/20261120T142112Z/457_121.json'
import northEast from '@/static/web/water-index/20261120T142112Z/457_122.json'

const tiles: Record<string, unknown> = {
  '456_121': southWest, '456_122': northWest, '457_121': southEast, '457_122': northEast
}
export function readBundledWaterIndex(path: string): unknown {
  if (path === 'manifest.json') return manifest
  const prefix = `${manifest.version}/`
  if (!path.startsWith(prefix) || !path.endsWith('.json')) return
  return tiles[path.slice(prefix.length, -5)]
}
