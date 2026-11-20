import assert from 'node:assert/strict'
import test from 'node:test'
import {
  catchField,
  catchRecordsFromDraft,
  catchSummary,
  ensureTripCatches,
  freshCatch,
  tripCatches,
  validateCatches
} from '../src/domain/trip-catches'
import { draftFromTrip, freshDraft } from '../src/domain/rules'
import { editAttempt, editFields, postEditDraft } from '../src/domain/content-edit'
import type { Trip } from '../src/domain/models'
const records = [
  { species: '鲫鱼', count: 3, weight_kg: 0.3 },
  { species: '鲤鱼', count: 1, weight_kg: null }
]
const trip: Trip = {
  id: 'trip',
  title: '日志',
  body: '私人心得',
  occurred_on: '2026-11-19',
  species: '多条渔获',
  method: '台钓',
  bait: '蚯蚓',
  count: 4,
  weight_kg: null,
  created_at: '',
  catch_records: records
}
test('catch entries preserve unknowns, zero and order, and discard only fully blank rows', () => {
  const draft = {
    ...freshDraft(),
    catches: [
      freshCatch(),
      ...records.map(freshCatch),
      freshCatch({ species: '', count: 0, weight_kg: 0 })
    ]
  }
  assert.deepEqual(catchRecordsFromDraft(draft), [
    ...records,
    { species: '', count: 0, weight_kg: 0 }
  ])
  assert.deepEqual(catchSummary(records), { species: '多条渔获', count: 4, weight_kg: null })
  assert.deepEqual(catchSummary([]), { species: '', count: null, weight_kg: null })
  assert.equal(
    catchSummary([
      { species: '', count: null, weight_kg: 0.1 },
      { species: '', count: 0, weight_kg: 0.2 }
    ]).weight_kg,
    0.3
  )
})
test('catch validation bounds rows, measurements, integer counts and aggregate totals', () => {
  assert.ok(validateCatches(Array.from({ length: 21 }, () => freshCatch())).catches)
  for (const value of ['-1', 'NaN', 'Infinity', '0x10', '10kg', '10001']) {
    const row = { ...freshCatch(), count: value, weight: value }
    const errors = validateCatches([row])
    assert.ok(errors[catchField(row, 'count')], value)
    assert.ok(errors[catchField(row, 'weight')], value)
  }
  const row = { ...freshCatch(), count: '1.5' }
  assert.match(validateCatches([row])[catchField(row, 'count')], /整数/)
  assert.ok(
    validateCatches([
      { ...row, count: '9999' },
      { ...freshCatch(), count: '2' }
    ]).catches
  )
  assert.ok(
    validateCatches([
      { ...freshCatch(), weight: '10000' },
      { ...freshCatch(), weight: '0.01' }
    ]).catches
  )
  assert.deepEqual(validateCatches([{ ...freshCatch(), weight: '1e-8', count: '0' }]), {})
})
test('old trip data and old local drafts upgrade without changing unknown weight or zero count', () => {
  const old = { ...trip, catch_records: undefined, species: '鲫鱼', count: 0 }
  assert.deepEqual(tripCatches(old), [{ species: '鲫鱼', count: 0, weight_kg: null }])
  const draft = { ...freshDraft(), species: '鲫鱼', count: '0' }
  ensureTripCatches(draft)
  assert.equal(draft.catches![0].count, '0')
  assert.equal(draft.catches![0].weight, '')
  assert.equal(ensureTripCatches(draft)[0].id, draft.catches![0].id)
  assert.deepEqual(tripCatches({ ...old, catch_records: [] }), [])
})
test('trip edits and retries include all catches but never local row IDs or private columns', () => {
  const draft = postEditDraft(trip)
  assert.deepEqual(catchRecordsFromDraft(draft), records)
  const first = editAttempt('trip', draft, 2)
  assert.deepEqual(first.payload.catch_records, records)
  const regenerated = { ...draft, catches: records.map(freshCatch) }
  assert.equal(
    editAttempt('trip', regenerated, 2, first.attempt).attempt.requestId,
    first.attempt.requestId
  )
  regenerated.catches[1].count = '2'
  assert.notEqual(
    editAttempt('trip', regenerated, 2, first.attempt).attempt.requestId,
    first.attempt.requestId
  )
  assert.ok(!('catches' in first.payload))
  assert.ok(!('audience' in first.payload))
})
test('repeating a trip copies species only; sharing cannot copy private catch details or quantities', () => {
  const repeat = draftFromTrip(trip, 'repeat')
  assert.deepEqual(
    repeat.catches?.map((row) => [row.species, row.count, row.weight]),
    [
      ['鲫鱼', '', ''],
      ['鲤鱼', '', '']
    ]
  )
  assert.notEqual(repeat.id, trip.id)
  const share = draftFromTrip(trip, 'share')
  assert.equal(share.catches, undefined)
  assert.equal(share.count, '')
  assert.equal(share.weight, '')
  assert.equal(share.audience, 'public')
  assert.ok(
    !('catch_records' in editFields('post', { ...share, catches: records.map(freshCatch) }))
  )
})
