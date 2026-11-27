import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizePhone,
  optionalNumber,
  validCoordinates,
  safeSpot,
  canNavigate,
  freshDraft,
  freshSpot,
  validateDraft,
  validDate
} from '../src/domain/rules'
test('phone normalization and invalid input', () => {
  assert.equal(normalizePhone('138 0013 8000'), '+8613800138000')
  assert.equal(normalizePhone('+86 13800138000'), '+8613800138000')
  assert.throws(() => normalizePhone('123'))
})
test('unknown measurements differ from zero', () => {
  assert.equal(optionalNumber('', 10000), null)
  assert.equal(optionalNumber('0', 10000), 0)
  assert.throws(() => optionalNumber('-1', 10000))
  assert.throws(() => optionalNumber('NaN', 10000))
})
test('coordinates reject nonfinite and out of range', () => {
  assert.equal(validCoordinates(120.5, 31.2), true)
  assert.equal(validCoordinates(Infinity, 31), false)
  assert.equal(validCoordinates(200, 31), false)
  assert.equal(validCoordinates('120', 31), false)
})
test('location privacy applies to all returned fields and navigation', () => {
  const original = {
    ...freshSpot(),
    precision: 'area' as const,
    author: { id: 'angler', nickname: '', city: '', bio: '', method: '', handle: '' },
    saved: false,
    created_at: '2026-01-01',
    longitude: 120.523456,
    latitude: 31.287654,
    access_note: 'secret'
  }
  const area = safeSpot(original)
  assert.ok(Math.abs(area.longitude! - 120.52) < 0.000001)
  assert.ok(Math.abs(area.latitude! - 31.28) < 0.000001)
  assert.equal(area.access_note, '')
  assert.equal(canNavigate(area), false)
  const hidden = safeSpot({ ...original, precision: 'hidden' })
  assert.equal(hidden.longitude, null)
  assert.equal(hidden.latitude, null)
  assert.equal(hidden.access_note, '')
  assert.deepEqual(safeSpot(original, true), original)
})
test('new posts and spots default public and validate data', () => {
  const draft = freshDraft()
  assert.equal(draft.audience, 'public')
  assert.equal(freshSpot().audience, 'public')
  assert.ok(validateDraft(draft).body)
  assert.ok(validateDraft(draft, 'trip').title)
  draft.title = '空军也是记录'
  draft.body = '观察水情，带走垃圾。'
  draft.count = '0'
  draft.weight = '0'
  Object.assign(draft, {
    location_label: '测试水域',
    location_longitude: 120.62,
    location_latitude: 31.32
  })
  assert.deepEqual(validateDraft(draft), {})
  draft.count = '1.5'
  assert.ok(validateDraft(draft).count)
})
test('calendar dates do not silently roll into another month', () => {
  assert.equal(validDate('2026-02-30'), false)
  assert.equal(validDate('2026-02-29'), false)
  assert.equal(validDate('2024-02-29'), true)
  assert.equal(validDate('2026-13-01'), false)
})
