import type { ZoneBoundary } from './zone-geometry'
export interface ZoneFeedback {
  version: string
  total: number
  can_fish: number
  cannot_fish: number
  percent: number
  mine: 'can_fish' | 'cannot_fish' | null
  note: string
  released: boolean
  changed_at: string | null
  minimum: number
  threshold: number
}
export interface ZoneCircle {
  longitude: number
  latitude: number
  radius_m: number
}
export interface ZoneBounds {
  west: number
  south: number
  east: number
  north: number
}
export interface Zone extends ZoneCircle {
  id: string
  title: string
  description: string
  location_label: string
  crs: 'GCJ-02'
  source: 'community' | 'official' | 'spot' | 'notice'
  spot_id?: string
  community_based?: boolean
  boundary?: ZoneBoundary | null
  reporter?: string
  issuer?: string
  boundary_source_url?: string
  water_attribution?: string
  water_source_url?: string
  boundary_note?: string
  checked_on?: string
  observed_on: string
  expires_on: string
  source_url: string
  status: 'pending' | 'published' | 'rejected' | 'hidden' | 'withdrawn'
  revision: number
  created_at: string
  own?: boolean
  review_note?: string
  feedback?: ZoneFeedback
}
export interface ZonePage {
  items: Zone[]
  next: { created_at: string; id: string } | null
}
export interface ZoneMap {
  items: Zone[]
  released?: Zone[]
  truncated: boolean
  zoom_in: boolean
  spot_points?: ProhibitedSpotPoint[]
}
export interface ProhibitedSpotPoint {
  id: string
  catalog?: boolean
  community_based?: boolean
  name: string
  city: string
  observed_on: string | null
  created_at: string
  review_revision: number
  longitude: number
  latitude: number
}
export const zoneSourceLabels: Record<Zone['source'], string> = {
  official: '官方公告',
  community: '钓友上报',
  spot: '钓位上报',
  notice: '公告线索'
}
export const zoneSourceLabel = (zone: Zone) => zone.community_based ? '钓友评论' : zoneSourceLabels[zone.source]
export const zoneStatus = {
  pending: '待审核 · 尚未公开',
  published: '已公开 · 钓友提醒',
  rejected: '未通过审核',
  hidden: '已隐藏',
  withdrawn: '已撤回'
}
export function chinaDate(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)
}
export function validZoneCircle(value: ZoneCircle) {
  return (
    Number.isFinite(value.longitude) &&
    value.longitude >= -179 &&
    value.longitude <= 179 &&
    Number.isFinite(value.latitude) &&
    value.latitude >= -85 &&
    value.latitude <= 85 &&
    Number.isInteger(value.radius_m) &&
    value.radius_m >= 50 &&
    value.radius_m <= 5000
  )
}
/** Approximate extent for browsing, not legal geometry or a navigation boundary. */
export function circleBounds(circle: ZoneCircle): ZoneBounds {
  const dy = circle.radius_m / 110000
  const dx = dy / Math.cos((circle.latitude * Math.PI) / 180)
  return {
    west: Math.max(-180, circle.longitude - dx),
    east: Math.min(180, circle.longitude + dx),
    south: Math.max(-85, circle.latitude - dy),
    north: Math.min(85, circle.latitude + dy)
  }
}
export function safeSourceUrl(value: string) {
  return value.length <= 1000 && /^https:\/\/[A-Za-z0-9.-]+(?::[0-9]+)?(?:\/[^\s]*)?$/.test(value)
}
// Verified public policy, NOT a nationwide GIS feed. No unverified boundaries are drawn.
export const fishingPolicy = {
  title: '长江流域禁捕水域垂钓管理意见',
  issuer: '农业农村部办公厅',
  scope: '长江流域禁捕水域；不是全国所有水域',
  issued: '2024-12-27',
  checked: '2026-11-19',
  url: 'https://cjyzbgs.moa.gov.cn/tzgg/202412/t20241231_6468771.htm',
  summary:
    '禁捕不等于一律禁钓。具体禁钓区、禁钓期及钓具要求由适用政策和当地公告确定；请查看原文并核实现场标识。'
}
