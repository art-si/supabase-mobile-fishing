import type { ZoneBounds } from './zones'

export interface MapSpot {
  id: string
  name: string
  city: string
  water_type: string
  longitude: number
  latitude: number
  precision: 'exact' | 'area'
  own: boolean
  crs: 'GCJ-02'
}
export interface MapSpots {
  items: MapSpot[]
  truncated: boolean
  zoom_in: boolean
}
export function sameMapBounds(a: ZoneBounds | null, b: ZoneBounds | null) {
  return (
    !!a &&
    !!b &&
    (['west', 'south', 'east', 'north'] as const).every(
      (key) => Math.abs(a[key] - b[key]) < 0.000001
    )
  )
}
export function mapSpotsHint(data: MapSpots) {
  if (data.zoom_in) return '范围较大，请放大地图后查看钓位。'
  if (data.truncated) return '已显示这片水域最新的 100 个钓位，放大地图可缩小范围。'
  if (!data.items.length) return '这片水域还没有可见钓位，可以移动地图再找找。'
  return `这片水域有 ${data.items.length} 个钓位。`
}
