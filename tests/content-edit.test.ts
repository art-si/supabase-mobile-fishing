import assert from 'node:assert/strict'
import test from 'node:test'
import { editAttempt, editFields, editRoute, postEditDraft } from '../src/domain/content-edit'
import { freshDraft, freshSpot } from '../src/domain/rules'
import type { Post, Trip } from '../src/domain/models'

test('author command retries keep a request ID, but edited input gets a fresh request ID', () => {
  const draft = freshDraft()
  const first = editAttempt('post', draft, 1)
  assert.equal(
    editAttempt('post', { ...draft }, 1, first.attempt).attempt.requestId,
    first.attempt.requestId
  )
  assert.notEqual(
    editAttempt('post', { ...draft, body: 'new' }, 1, first.attempt).attempt.requestId,
    first.attempt.requestId
  )
  assert.notEqual(
    editAttempt('post', draft, 2, first.attempt).attempt.requestId,
    first.attempt.requestId
  )
})
test('commands exclude media URLs, counters, authority and private trip sharing fields', () => {
  const draft = {
    ...freshDraft(),
    media: [{ id: 'photo', path: 'private/path', url: 'https://secret', width: 20, height: 20 }],
    status: 'published',
    author_id: 'intruder'
  }
  const payload = editFields('trip', draft)
  assert.deepEqual(payload.media, [{ id: 'photo' }])
  for (const key of ['status', 'author_id', 'location_label', 'audience', 'kind'])
    assert.ok(!(key in payload))
  const spot = editFields('spot', { ...freshSpot(), ...({ review_revision: 999 } as object) })
  assert.ok(!('review_revision' in spot))
})
test('editing a log preserves identity, date, photo metadata, unknown and zero catch', () => {
  const trip: Trip = {
    id: 'a',
    title: '昨日出钓',
    body: '空军',
    occurred_on: '2026-11-18',
    species: '鲫鱼',
    method: '台钓',
    bait: '蚯蚓',
    weight_kg: null,
    count: 0,
    created_at: ''
  }
  const result = postEditDraft(trip)
  assert.equal(result.id, trip.id)
  assert.equal(result.occurred_on, trip.occurred_on)
  assert.equal(result.count, '0')
  assert.equal(result.weight, '')
  assert.equal(result.audience, 'private')
  assert.deepEqual(result.media, [])
  const post = postEditDraft({
    ...trip,
    kind: 'experience',
    audience: 'friends',
    weight_kg: 0,
    location_label: '苏州',
    media: [{ id: 'photo', path: 'a', width: 20, height: 20 }]
  } as unknown as Post)
  assert.equal(post.weight, '0')
  assert.equal(post.kind, 'experience')
  assert.equal(post.audience, 'friends')
  assert.equal(post.media.length, 1)
})
test('edit links reuse existing editors and safely encode identifiers', () => {
  assert.equal(editRoute('trip', 'a'), '/pages/post/compose?mode=trip&edit=a')
  assert.equal(editRoute('spot', 'a&b'), '/pages/spot/create?id=a%26b')
})
