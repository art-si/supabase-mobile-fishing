import type {
  Audience,
  ContentStatus,
  Payload,
  Post,
  PostDraft,
  Precision,
  Spot,
  SpotDraft,
  Trip
} from './models'
import { createId, validDate, today } from './rules'
import { fishingDateTime } from './fishing-presets'
import { catchRecordsFromDraft, catchSummary, freshCatch, tripCatches } from './trip-catches'
import { catchNumber } from './catch-measurements'

export type ContentType = 'post' | 'spot' | 'trip'
export interface EditSnapshot<T = Post | Spot | Trip> {
  item: T
  revision: number
  publication?: { status: ContentStatus; audience: Audience; precision?: Precision | null }
}
export interface EditAttempt {
  signature: string
  requestId: string
}

/** Only editable fields enter a command; signed URLs, status, owner and counters never do. */
export function editFields(type: ContentType, value: PostDraft | SpotDraft): Payload {
  if (type === 'spot') {
    const d = value as SpotDraft
    return {
      id: d.id,
      name: d.name,
      city: d.city,
      ...(d.location_label !== undefined ? { location_label: d.location_label } : {}),
      water_type: d.water_type,
      ...(d.fishing_status !== undefined ? { fishing_status: d.fishing_status } : {}),
      species: d.species,
      description: d.description,
      fee_note: d.fee_note,
      access_note: d.access_note,
      observed_on: d.observed_on,
      audience: d.audience,
      precision: d.precision,
      latitude: d.latitude,
      longitude: d.longitude,
      media: (d.media || []).map(({ id }) => ({ id }))
    }
  }
  const d = value as PostDraft
  const experience = type === 'post' && d.kind === 'experience'
  return {
    id: d.id,
    title: d.title.trim(),
    body: d.body.trim(),
    species: experience ? '' : d.species,
    method: experience ? '' : d.method,
    bait: experience ? '' : d.bait,
    additives: type === 'post' && d.kind === 'experience' ? '' : d.additives || '',
    occurred_on: experience && !validDate(d.occurred_on) ? today() : d.occurred_on,
    occurred_at:
      d.kind === 'experience' && type === 'post'
        ? null
        : fishingDateTime(d.occurred_on, d.occurred_time),
    media: d.media.map(({ id }) => ({ id })),
    ...(type === 'trip'
      ? (() => {
          const catch_records = catchRecordsFromDraft(d)
          const summary = catchSummary(catch_records)
          return {
            catch_records,
            species: summary.species,
            count: summary.count == null ? '' : String(summary.count),
            weight: summary.weight_kg == null ? '' : String(summary.weight_kg)
          }
        })()
      : {
          kind: d.kind,
          audience: d.audience,
          location_label: d.location_label,
          location_longitude: d.location_longitude,
          location_latitude: d.location_latitude,
          topic: d.kind === 'experience' ? d.topic || '' : '',
          weight: experience
            ? ''
            : (catchNumber(d.weight, 'weight', d.weight_unit)?.toString() ?? ''),
          count: experience ? '' : (catchNumber(d.count, 'count')?.toString() ?? ''),
          length: experience ? '' : (catchNumber(d.length, 'length')?.toString() ?? '')
        })
  }
}
export function editAttempt(
  type: ContentType,
  draft: PostDraft | SpotDraft,
  revision: number,
  prior?: EditAttempt
) {
  const fields = { ...editFields(type, draft), type, revision }
  const signature = JSON.stringify(fields)
  const attempt = prior?.signature === signature ? prior : { signature, requestId: createId() }
  return { attempt, payload: { ...fields, request_id: attempt.requestId } }
}
export function postEditDraft(item: Post | Trip): PostDraft {
  return {
    id: item.id,
    title: item.title,
    body: item.body,
    kind: 'kind' in item ? item.kind : 'catch',
    species: item.species,
    method: item.method,
    bait: item.bait,
    additives: 'additives' in item ? item.additives || '' : '',
    weight: item.weight_kg === null ? '' : String(item.weight_kg),
    weight_unit: 'kg',
    count: item.count == null ? '' : String(item.count),
    length: 'kind' in item && item.length_cm != null ? String(item.length_cm) : '',
    ...(!('kind' in item) ? { catches: tripCatches(item).map(freshCatch) } : {}),
    occurred_on: item.occurred_on,
    occurred_time:
      'occurred_at' in item && item.occurred_at
        ? new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Shanghai',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          }).format(new Date(item.occurred_at))
        : '',
    location_label: 'location_label' in item ? item.location_label : '',
    location_longitude: 'location_longitude' in item ? item.location_longitude : null,
    location_latitude: 'location_latitude' in item ? item.location_latitude : null,
    topic: 'topic' in item ? item.topic : '',
    audience: 'audience' in item ? item.audience : 'private',
    media: item.media || []
  }
}
export function editRoute(type: ContentType, id: string) {
  return type === 'spot'
    ? `/pages/spot/create?id=${encodeURIComponent(id)}`
    : `/pages/post/compose?mode=${type}&edit=${encodeURIComponent(id)}`
}
