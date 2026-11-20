import test from 'node:test'
import assert from 'node:assert/strict'
import { freshSpot } from '../src/domain/rules'
import { canSaveSpotPoint, spotEntryName } from '../src/domain/spot-entry'

test('new spots default to public natural-water exact points but cannot save before location resolves', () => {
  const spot = freshSpot()
  assert.equal(spot.audience, 'public')
  assert.equal(spot.water_type, '自然水域')
  assert.equal(spot.precision, 'exact')
  assert.equal(canSaveSpotPoint(spot, true), false)
  Object.assign(spot, { latitude: 30.5, longitude: 114.3, city: '武汉市' })
  assert.equal(canSaveSpotPoint(spot, false), false)
  assert.equal(canSaveSpotPoint(spot, true), true)
  assert.equal(canSaveSpotPoint({ ...spot, precision: 'area' }, true), false)
  assert.equal(canSaveSpotPoint({ ...spot, city: '' }, true), false)
  assert.equal(canSaveSpotPoint({ ...spot, latitude: NaN }, true), false)
})
test('optional titles preserve user names and use actual place labels with an honest empty-label fallback', () => {
  assert.equal(spotEntryName('  常去的岸边 ', '真实地点'), '常去的岸边')
  assert.equal(spotEntryName(' ', '真实选择的地点'), '真实选择的地点')
  assert.equal(spotEntryName('', '地'.repeat(100)).length, 60)
  assert.equal(spotEntryName(''), '已保存钓位')
})
