import { isDemo } from '@/config'
import type { DiscussionPerson, Media } from '@/domain/models'
import type { SpotLead } from '../../supabase/functions/_shared/discovery-contract'
import { resolveContentMedia } from './media'
import { sessionRequest } from './session'

export interface SpotCommunitySummary {
  target: string
  likes: number
  rank_likes?: number
  liked: boolean
  comments: number
  pending_analysis?: boolean
  saved: boolean
  status: '' | 'prohibited' | 'open' | 'unavailable'
}

export interface SpotDiscussion {
  id: string
  body: string
  created_at: string
  own: boolean
  author: DiscussionPerson | null
  media: Media[]
  reply_to_id: string | null
  reply_to: { id: string; author: DiscussionPerson | null; body: string } | null
}

export type SpotReaction = 'like' | 'bookmark'
export const spotCommunityKey = (id: string) => 'spot:' + id
export const leadCommunityKey = (lead: Pick<SpotLead, 'city' | 'name'>) =>
  'lead:' + lead.city + '|' + lead.name

function rpc<T>(action: string, payload: Record<string, unknown>, auth = false) {
  return sessionRequest<T>('/rest/v1/rpc/fishing_spot_community', {
    method: 'POST', data: { action, payload }
  }, auth)
}
export function spotCommunitySummary(targets: string[]) {
  if (!targets.length || isDemo) return Promise.resolve([] as SpotCommunitySummary[])
  const requests: Promise<SpotCommunitySummary[]>[] = []
  for (let offset = 0; offset < targets.length; offset += 100)
    requests.push(rpc('summary', { targets: targets.slice(offset, offset + 100) }))
  return Promise.all(requests).then(results => results.flat())
}
export async function spotComments(target: string, cursor: string | null = null) {
  const page = await rpc<{ summary: SpotCommunitySummary; items: SpotDiscussion[]; next?: string | null }>(
    'comments', { target, cursor }
  )
  return resolveContentMedia(page)
}
export const saveSpotComment = (target: string, id: string, body: string, reply_to_id: string | null = null, media: { id: string }[] = []) =>
  rpc<{ id: string }>('comment', { target, id, body, reply_to_id, media }, true)
export const deleteSpotComment = (target: string, id: string) =>
  rpc<SpotCommunitySummary>('delete_comment', { target, id }, true)
export const reactToSpot = (target: string, kind: SpotReaction, enabled: boolean) =>
  rpc<SpotCommunitySummary>('react', { target, kind, enabled }, true)
export const savedSpotLeads = () => isDemo ? Promise.resolve([] as SpotLead[]) : rpc<SpotLead[]>('saved_leads', {}, true)

const analysing = new Map<string, Promise<SpotCommunitySummary[]>>()
export function analyseSpotComments(target: string, afterSubmission = false): Promise<SpotCommunitySummary[]> {
  const pending = analysing.get(target)
  if (pending) return afterSubmission
    ? pending.catch(() => []).then(() => analyseSpotComments(target))
    : pending
  const request = sessionRequest('/functions/v1/spot-discovery', {
    method: 'POST', timeout: 55_000, data: { operation: 'analyse_spot_comments', target }
  }, true).then(() => spotCommunitySummary([target])).finally(() => analysing.delete(target))
  analysing.set(target, request)
  return request
}
