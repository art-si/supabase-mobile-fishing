import type { PostDraft, Trip } from '../domain/models'
import { createId, draftFromTrip } from '../domain/rules'

type Intent = 'repeat' | 'share'
type Mode = 'trip' | 'post'
interface Handoff {
  token: string
  owner: string
  intent: Intent
  mode: Mode
  draft: PostDraft
  expires: number
}
// Single-use, account-bound memory only: private journal text never goes into a URL.
let pending: Handoff | undefined
export function prepareTripDraft(trip: Trip, owner: string, intent: Intent) {
  if (!owner) throw new Error('请先登录再使用这份日志')
  const token = createId()
  const mode = 'post'
  pending = {
    token,
    owner,
    intent,
    mode,
    draft: draftFromTrip(trip, intent),
    expires: Date.now() + 5 * 60 * 1000
  }
  return { token, mode }
}
export function discardTripDraft(token: string) {
  if (pending?.token === token) pending = undefined
}
export function clearTripDraft() {
  pending = undefined
}
export function takeTripDraft(token: string, owner: string, mode: Mode) {
  const value = pending
  pending = undefined
  if (
    !value ||
    value.token !== token ||
    !owner ||
    value.owner !== owner ||
    value.mode !== mode ||
    Date.now() >= value.expires
  )
    return null
  return { intent: value.intent, draft: value.draft }
}
