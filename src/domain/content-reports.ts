import type { ReviewItem } from './moderation'
import type { Audience } from './models'
export type ContentReportType = 'post' | 'spot' | 'profile' | 'comment'
export type ContentReportStatus = 'pending' | 'actioned' | 'dismissed' | 'unavailable'
export type ContentReportDecision = 'hide' | 'dismiss' | 'unavailable'
export interface ContentReport {
  id: string
  type: ContentReportType
  title: string
  reason: string
  status: ContentReportStatus
  revision: number
  created_at: string
  resolution: string
  resolved_at: string | null
}
export interface ContentReportCursor {
  id: string
  time: string
}
export interface ContentReportPage {
  items: ContentReport[]
  next: ContentReportCursor | null
}
export interface ContentReportReview {
  report: ContentReport
  content:
    | (Omit<ReviewItem, 'type' | 'audience'> & { type: ContentReportType; audience?: Audience })
    | null
  content_revision: number
  changed: boolean
  needs_other_reviewer: boolean
  can_hide: boolean
}
export const reportStatusLabels: Record<ContentReportStatus, string> = {
  pending: '待处理',
  actioned: '已处理',
  dismissed: '未采取措施',
  unavailable: '已结案'
}
export const reportTypeLabels: Record<ContentReportType, string> = {
  post: '鱼情 / 心得',
  spot: '钓位',
  comment: '评论',
  profile: '个人资料'
}
export const reportDecisionLabels: Record<ContentReportDecision, string> = {
  hide: '隐藏内容并结案',
  dismiss: '不处理内容并结案',
  unavailable: '按内容不可用结案'
}
export function reportDecisions(item: ContentReportReview): ContentReportDecision[] {
  if (item.report.status !== 'pending' || item.needs_other_reviewer) return []
  if (!item.content || item.content.status !== 'published') return ['unavailable']
  return item.can_hide ? ['hide', 'dismiss'] : ['dismiss']
}
