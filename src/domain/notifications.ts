export type NotificationCategory = 'interaction' | 'system'
export interface NotificationCounts {
  interaction: number
  system: number
}
export interface NotificationPreferences {
  likes: boolean
  comments: boolean
}
export interface InboxNotification {
  id: string
  kind:
    | 'like'
    | 'comment'
    | 'reply'
    | 'friend_accepted'
    | 'review'
    | 'report_result'
    | 'zone_review'
  category: NotificationCategory
  created_at: string
  read: boolean
  available: boolean
  title: string
  preview: string
  target: { type: 'post' | 'spot' | 'person' | 'reports' | 'zones'; id: string } | null
}
export interface NotificationPage {
  items: InboxNotification[]
  next: string | null
  summary: NotificationCounts
}
export interface NotificationRefresh {
  items: InboxNotification[]
  latest: string | null
  summary: NotificationCounts
}
export const notificationSections = [
  { value: 'interaction', label: '互动' },
  { value: 'system', label: '系统' }
] as const
export function notificationCount(value: number) {
  return value > 99 ? '99+' : String(Math.max(0, value || 0))
}
/** IDs stay decimal strings: PostgreSQL bigint is larger than JS safe integers. */
export function hasNewNotification(latest: string | null, first?: string) {
  if (!latest || !/^[1-9]\d*$/.test(latest)) return false
  if (!first) return true
  return latest.length > first.length || (latest.length === first.length && latest > first)
}
export function notificationUrl(item: InboxNotification): string | null {
  const target = item.available ? item.target : null
  if (!target || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target.id))
    return null
  switch (target.type) {
    case 'post':
      return `/pages/post/detail?id=${target.id}`
    case 'spot':
      return `/pages/spot/detail?id=${target.id}`
    case 'person':
      return `/pages/people/detail?id=${target.id}`
    case 'reports':
      return '/pages/content-report/index'
    case 'zones':
      return '/pages/map/marks'
    default:
      return null
  }
}
/** Update only visible records; removed references disappear, new events don't shift reading. */
export function refreshNotifications(current: InboxNotification[], fresh: InboxNotification[]) {
  const byId = new Map(fresh.map((item) => [item.id, item]))
  return current.flatMap((item) => (byId.has(item.id) ? [byId.get(item.id)!] : []))
}
