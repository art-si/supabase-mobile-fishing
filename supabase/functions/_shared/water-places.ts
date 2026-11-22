import type { MapPoint } from './water-geometry.ts'

export interface WaterPlace {
  name: string
  point: MapPoint
  flowing: boolean
}

// AMap's natural-feature family also contains islands, mountains and valleys.
export const naturalPlaceType = '190200'

export function waterPlace(nameValue: unknown, type: unknown, lng: unknown, lat: unknown): WaterPlace | undefined {
  if (typeof nameValue !== 'string' || !nameValue.trim() || typeof type !== 'string' ||
      typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat) ||
      Math.abs(lng) > 180 || Math.abs(lat) > 90) return
  const name = nameValue.trim().slice(0, 120)
  for (const group of type.split('|')) {
    const [family, category, feature] = group.split(';')
    if (family !== '地名地址信息' || category !== '自然地名') continue
    const flowing = /^(河流|溪流|运河|河渠)$/.test(feature)
    if (flowing || /^(湖泊|水库|池塘|海湾海峡|湾|洋|海域)$/.test(feature) ||
        (feature === '自然地名' && /水库$|[江河溪湖泊塘渠浜涌淀]$/.test(name))) {
      return { name, point: [lng, lat], flowing: flowing || (feature === '自然地名' && /[江河溪渠浜涌]$/.test(name)) }
    }
  }
}
