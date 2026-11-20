import type { Audience, ContentStatus, Media, Profile } from './models'
export type ReviewType = 'post' | 'spot' | 'comment'
export type ReviewDecision = 'published' | 'rejected' | 'hidden'
export interface ReviewCursor {
  created_at: string
  id: string
  type: ReviewType
}
export interface ReviewSummary {
  is_update?: boolean
  id: string
  type: ReviewType
  title: string
  author: Profile
  audience: Audience
  created_at: string
}
export interface ReviewItem extends ReviewSummary {
  current?: ReviewItem
  body: string
  revision: number
  status: ContentStatus
  details: Record<string, string>
  media: Media[]
}
export interface ReviewQueue {
  items: ReviewSummary[]
  next: ReviewCursor | null
}
export interface OwnReviewStatus {
  status: ContentStatus
  reason: string
}
export const reviewLabels = {
  pending: '待审核',
  published: '已通过审核',
  rejected: '审核未通过',
  hidden: '暂时隐藏',
  deleted: '已删除'
}
export const decisionLabels: Record<ReviewDecision, string> = {
  published: '通过审核',
  rejected: '退回内容',
  hidden: '隐藏内容'
}
