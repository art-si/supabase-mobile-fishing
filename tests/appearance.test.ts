import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FISHING_SKINS,
  fishingPalette,
  fishingThemeVars,
  validSkin
} from '../src/domain/appearance'

function luminance(hex: string) {
  const rgb = hex
    .match(/[a-f\d]{2}/gi)!
    .map((x) => parseInt(x, 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!
}
function ratio(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a)
  return (values[0]! + 0.05) / (values[1]! + 0.05)
}
test('all three fishing skins have readable light and dark semantic pairs', () => {
  assert.equal(FISHING_SKINS.length, 3)
  for (const skin of FISHING_SKINS)
    for (const mode of ['light', 'dark'] as const) {
      const p = skin[mode]
      for (const [fg, bg] of [
        ['ink', 'mist'],
        ['ink', 'paper'],
        ['ink', 'inset'],
        ['reed', 'mist'],
        ['reed', 'paper'],
        ['reed', 'inset'],
        ['lake', 'paper'],
        ['lake', 'lakeSoft'],
        ['onLake', 'lake'],
        ['danger', 'paper'],
        ['float', 'floatSoft']
      ] as const)
        assert.ok(
          ratio(p[fg], p[bg]) >= 4.5,
          `${skin.id}/${mode} ${fg}/${bg}: ${ratio(p[fg], p[bg]).toFixed(2)}`
        )
      assert.equal(fishingThemeVars(p).fishLake, p.lake)
      assert.equal(fishingPalette(skin.id, mode === 'dark'), p)
    }
})
test('unknown or corrupt persisted skin safely falls back to lake', () => {
  for (const value of [null, {}, '', 'dark', '__proto__', 'lake; display:none'])
    assert.equal(validSkin(value), 'lake')
  assert.equal(validSkin('ocean'), 'ocean')
})
