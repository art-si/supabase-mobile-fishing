import type { Audience, Precision, Spot, PostDraft, SpotDraft, Trip } from './models'
import { userErrorText } from './user-errors'
import { compositionLimits } from './composition'
import { currentChinaTime } from './fishing-presets'
import { catchNumber } from './catch-measurements'

export const audienceLabels: Record<Audience, string> = {
  public: '公开',
  friends: '仅好友',
  private: '仅自己'
}
export const precisionLabels: Record<Precision, string> = {
  exact: '精确钓点',
  area: '大致水域',
  hidden: '不分享位置'
}
export const audienceOptions = Object.entries(audienceLabels).map(([id, name]) => ({ id, name }))
export const precisionOptions = Object.entries(precisionLabels).map(([id, name]) => ({ id, name }))
export function today() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
export function createId() {
  // Idempotency identifier, not a security credential. Mini programs need a non-DOM fallback.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const n = Math.floor(Math.random() * 16)
    return (c === 'x' ? n : (n & 3) | 8).toString(16)
  })
}
export function normalizePhone(value: string) {
  const compact = value.replace(/[\s-]/g, '')
  const phone = compact.startsWith('+86')
    ? compact.slice(3)
    : /^861\d{10}$/.test(compact)
      ? compact.slice(2)
      : compact
  if (!/^1[3-9]\d{9}$/.test(phone)) throw new Error('请输入正确的中国大陆手机号')
  return `+86${phone}`
}
export function optionalNumber(value: string, max: number) {
  if (!value.trim()) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(`请填写 0–${max} 之间的数字`)
  return n
}
export function validCoordinates(longitude: unknown, latitude: unknown): boolean {
  return (
    typeof longitude === 'number' &&
    typeof latitude === 'number' &&
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90
  )
}
export function safeSpot(spot: Spot, isOwner = false): Spot {
  if (isOwner || spot.precision === 'exact') return { ...spot }
  if (spot.precision === 'hidden')
    return { ...spot, longitude: null, latitude: null, access_note: '', location_label: '' }
  return {
    ...spot,
    longitude: spot.longitude === null ? null : Math.round(spot.longitude / 0.02) * 0.02,
    latitude: spot.latitude === null ? null : Math.round(spot.latitude / 0.02) * 0.02,
    access_note: '',
    location_label: ''
  }
}
export function canNavigate(spot: Spot) {
  return spot.precision === 'exact' && validCoordinates(spot.longitude, spot.latitude)
}
export function freshDraft(): PostDraft {
  return {
    id: createId(),
    title: '',
    body: '',
    kind: 'catch',
    species: '',
    method: '台钓',
    bait: '',
    additives: '',
    weight: '',
    weight_unit: 'kg',
    count: '',
    length: '',
    occurred_on: today(),
    occurred_time: currentChinaTime(),
    location_label: '',
    location_longitude: null,
    location_latitude: null,
    topic: '',
    audience: 'public',
    media: []
  }
}
export function freshSpot(): SpotDraft {
  return {
    fishing_status: 'allowed',
    id: createId(),
    name: '',
    city: '',
    location_label: '',
    water_type: '自然水域',
    species: '',
    description: '',
    fee_note: '未核实',
    access_note: '',
    observed_on: today(),
    audience: 'public',
    precision: 'exact',
    latitude: null,
    longitude: null,
    media: []
  }
}
/** Only explicitly reusable fields cross from a private log into another draft. */
export function draftFromTrip(trip: Trip, intent: 'repeat' | 'share'): PostDraft {
  return {
    ...freshDraft(),
    species: trip.catch_records && trip.catch_records.length > 1 ? '' : trip.species,
    method: trip.method,
    bait: trip.bait,
    ...(intent === 'repeat' && trip.catch_records
      ? {
          catches: trip.catch_records.map((row) => ({
            id: createId(),
            species: row.species,
            count: '',
            weight: ''
          }))
        }
      : {}),
    ...(intent === 'share'
      ? { title: trip.title, body: trip.body, occurred_on: trip.occurred_on }
      : {})
  }
}
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
export function validateDraft(draft: PostDraft, mode: 'post' | 'trip' = 'post') {
  const errors: Record<string, string> = {}
  if (mode === 'trip' && !draft.title.trim()) errors.title = '给这次记录起个名字'
  if (mode === 'post' && !draft.body.trim() && !draft.media.length)
    errors.body = '写一点鱼情或添加照片 / 视频，至少提供一项'
  if (draft.title.length > compositionLimits.title) errors.title = '标题最多 60 字'
  if (draft.body.length > compositionLimits.body) errors.body = '正文最多 2000 字'
  if (draft.media.length > compositionLimits.photos) errors.media = '最多添加 9 项图片或视频'
  if (
    mode === 'post' &&
    (!draft.location_label?.trim() ||
      !validCoordinates(draft.location_longitude, draft.location_latitude))
  )
    errors['post-location'] = '选择所在位置后再发布'
  if (
    (mode === 'trip' || draft.kind === 'catch') &&
    draft.occurred_time &&
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(draft.occurred_time)
  )
    errors.occurred_on = '请选择有效的出钓时间'
  if ((draft.topic || '').length > 40) errors.topic = '心得主题最多 40 字'
  if (mode === 'post' && draft.kind === 'experience') return errors
  if (!validDate(draft.occurred_on)) errors.occurred_on = '请填写有效日期，格式为 YYYY-MM-DD'
  try {
    catchNumber(draft.weight, 'weight', draft.weight_unit)
  } catch (e) {
    // These messages come only from our local measurement validator, never an API response.
    errors.weight = (e as Error).message
  }
  try {
    catchNumber(draft.count, 'count')
  } catch (e) {
    errors.count = (e as Error).message
  }
  if (mode === 'post') {
    try {
      catchNumber(draft.length, 'length')
    } catch (e) {
      errors.length = (e as Error).message
    }
  }
  return errors
}
export function relativeTime(value: string) {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return ''
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`
  return value.slice(5, 10).replace('-', '月') + '日'
}
export function errorText(error: unknown) {
  return userErrorText(error)
}
