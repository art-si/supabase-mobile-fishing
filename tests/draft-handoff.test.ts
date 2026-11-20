import test from 'node:test'
import assert from 'node:assert/strict'
import { draftFromTrip, today } from '../src/domain/rules'
import {
  prepareTripDraft,
  takeTripDraft,
  discardTripDraft,
  clearTripDraft
} from '../src/services/draft-handoff'
import type { Trip } from '../src/domain/models'

const trip: Trip & { longitude: number; location_label: string } = {
  id: 'old-log',
  title: '旧日志',
  body: '只在本次分享时带入的正文',
  species: '鲫鱼',
  method: '台钓',
  bait: '蚯蚓',
  weight_kg: 12,
  count: 30,
  occurred_on: '2020-03-10',
  created_at: '2020-03-10',
  media: [{ id: 'private-photo', path: 'private/image.jpg', width: 1, height: 1 }],
  longitude: 120.5,
  location_label: '私人钓位'
}
test('repeat uses new identity and date, never copies the previous catch or private data', () => {
  const draft = draftFromTrip(trip, 'repeat')
  assert.notEqual(draft.id, trip.id)
  assert.notEqual(draft.id, draftFromTrip(trip, 'repeat').id)
  assert.equal(draft.occurred_on, today())
  assert.equal(draft.species, trip.species)
  assert.equal(draft.method, trip.method)
  assert.equal(draft.bait, trip.bait)
  for (const key of ['title', 'body', 'weight', 'count', 'location_label'] as const)
    assert.equal(draft[key], '')
  assert.equal(draft.audience, 'public')
  assert.deepEqual(draft.media, [])
  assert.equal('longitude' in draft, false)
})
test('share is independent and retains explicit text and date without photos or location', () => {
  const draft = draftFromTrip(trip, 'share')
  assert.notEqual(draft.id, trip.id)
  assert.equal(draft.title, trip.title)
  assert.equal(draft.body, trip.body)
  assert.equal(draft.occurred_on, trip.occurred_on)
  assert.deepEqual(draft.media, [])
  assert.equal(draft.location_label, '')
  assert.equal(draft.audience, 'public')
})
test('transfer is single-use and bound to owner and editor mode', () => {
  assert.throws(() => prepareTripDraft(trip, '', 'share'))
  const first = prepareTripDraft(trip, 'owner-a', 'repeat')
  assert.equal(first.mode, 'post')
  assert.equal(takeTripDraft(first.token, 'owner-b', 'trip'), null)
  assert.equal(takeTripDraft(first.token, 'owner-a', 'trip'), null)
  const second = prepareTripDraft(trip, 'owner-a', 'share')
  assert.equal(takeTripDraft(second.token, 'owner-a', 'trip'), null)
  const third = prepareTripDraft(trip, 'owner-a', 'share')
  assert.equal(takeTripDraft(third.token, 'owner-a', 'post')?.draft.body, trip.body)
  assert.equal(takeTripDraft(third.token, 'owner-a', 'post'), null)
  const fourth = prepareTripDraft(trip, 'owner-a', 'repeat')
  discardTripDraft(fourth.token)
  assert.equal(takeTripDraft(fourth.token, 'owner-a', 'trip'), null)
})

test('repeat and share both enter the unified fish-record composer', () => {
  for (const intent of ['repeat', 'share'] as const) {
    const handoff = prepareTripDraft(trip, 'owner-a', intent)
    assert.equal(handoff.mode, 'post')
    const value = takeTripDraft(handoff.token, 'owner-a', 'post')
    assert.equal(value?.intent, intent)
    assert.equal(value?.draft.audience, 'public')
  }
})
test('an abandoned transfer expires', (t) => {
  const value = prepareTripDraft(trip, 'owner-a', 'repeat')
  const later = Date.now() + 5 * 60 * 1000
  t.mock.method(Date, 'now', () => later)
  assert.equal(takeTripDraft(value.token, 'owner-a', 'trip'), null)
})
test('ending a session invalidates its in-memory handoff even if the same owner logs back in', () => {
  const value = prepareTripDraft(trip, 'owner-a', 'repeat')
  clearTripDraft()
  assert.equal(takeTripDraft(value.token, 'owner-a', 'trip'), null)
})
