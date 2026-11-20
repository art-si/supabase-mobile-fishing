import test from 'node:test'
import assert from 'node:assert/strict'
import { catchNumber, changeWeightUnit } from '../src/domain/catch-measurements'
import { freshDraft, validateDraft } from '../src/domain/rules'
import { editAttempt, editFields, postEditDraft } from '../src/domain/content-edit'
import { catchRecordsFromDraft, freshCatch, validateCatches } from '../src/domain/trip-catches'
import type { Post } from '../src/domain/models'

test('kg and jin preserve a quantity, unknowns and small decimals through repeated switches', () => {
  for (const input of ['', '0', '.3', '10000', '1e-8', '0.0005']) {
    const jin = changeWeightUnit(input, 'kg', 'jin')
    assert.equal(catchNumber(jin, 'weight', 'jin'), catchNumber(input, 'weight'))
    assert.equal(
      catchNumber(changeWeightUnit(jin, 'jin', 'kg'), 'weight'),
      catchNumber(input, 'weight')
    )
  }
  assert.equal(catchNumber('20000', 'weight', 'jin'), 10000)
  assert.equal(catchNumber('0.001', 'weight', 'jin'), 0.0005)
  for (const invalid of ['-1', 'NaN', 'Infinity', '0x10', '3kg', '20001'])
    assert.throws(() => catchNumber(invalid, 'weight', 'jin'))
  assert.throws(() => changeWeightUnit('bad', 'kg', 'jin'))
  assert.throws(() => catchNumber('1.5', 'count'), /整数/)
})
test('post commands include canonical optional measurements in retry identity, never journal rows or local units', () => {
  const draft = {
    ...freshDraft(),
    body: '鱼情',
    location_label: '测试水域',
    location_longitude: 120.62,
    location_latitude: 31.32,
    count: '0',
    length: '38.5',
    weight: '2.4',
    weight_unit: 'jin' as const
  }
  const first = editAttempt('post', draft, 2)
  assert.equal(first.payload.weight, '1.2')
  assert.equal(first.payload.count, '0')
  assert.equal(first.payload.length, '38.5')
  assert.ok(!('weight_unit' in first.payload))
  assert.deepEqual(validateDraft(draft), {})
  assert.equal(validateDraft({ ...draft, count: '1.5' }).count, '尾数请输入 0–10000 的整数')
  const kg = { ...draft, weight: '1.2', weight_unit: 'kg' as const }
  assert.equal(editAttempt('post', kg, 2, first.attempt).attempt.requestId, first.attempt.requestId)
  assert.notEqual(
    editAttempt('post', { ...draft, count: '1' }, 2, first.attempt).attempt.requestId,
    first.attempt.requestId
  )
  assert.ok(validateDraft({ ...draft, length: '-1' }).length)
  const old = { ...draft, length: undefined, weight_unit: undefined }
  assert.equal(editFields('post', old).length, '')
  const post = {
    ...draft,
    id: 'post',
    kind: 'catch',
    count: 0,
    weight_kg: 1.2,
    length_cm: 38.5
  } as unknown as Post
  const restored = postEditDraft(post)
  assert.equal(restored.count, '0')
  assert.equal(restored.length, '38.5')
  assert.equal(restored.weight, '1.2')
  assert.equal(
    restored.catches,
    undefined,
    'post count must not misclassify a post as a private trip'
  )
})
test('mixed units in a multi-catch journal validate and sum in kg without leaking to posts', () => {
  const catches = [
    { ...freshCatch(), species: '鲫鱼', weight: '0.6', weight_unit: 'jin' as const, count: '2' },
    { ...freshCatch(), species: '鲤鱼', weight: '1.2', count: '' }
  ]
  const draft = { ...freshDraft(), catches }
  assert.deepEqual(validateCatches(catches), {})
  assert.deepEqual(catchRecordsFromDraft(draft), [
    { species: '鲫鱼', weight_kg: 0.3, count: 2 },
    { species: '鲤鱼', weight_kg: 1.2, count: null }
  ])
  assert.equal(editFields('trip', draft).weight, '1.5')
  assert.equal(editFields('trip', draft).count, '')
  assert.ok(!('catch_records' in editFields('post', draft)))
})
