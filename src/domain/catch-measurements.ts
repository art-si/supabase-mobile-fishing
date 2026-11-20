export type WeightUnit = 'kg' | 'jin'
export const weightUnits = [
  { id: 'kg', name: '公斤（kg）' },
  { id: 'jin', name: '斤' }
] as const

/** Empty means unknown. All commands use kg, cm and whole tails, regardless of input units. */
export function catchNumber(
  value: string | undefined,
  kind: 'weight' | 'count' | 'length',
  unit: WeightUnit = 'kg'
) {
  const text = value?.trim() || ''
  if (!text) return null
  if (kind === 'count' && !/^\d+$/.test(text)) throw new Error('尾数请输入 0–10000 的整数')
  const max = kind === 'weight' && unit === 'jin' ? 20000 : 10000
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text))
    throw new Error(`请填写 0–${max} 之间的数字`)
  const number = Number(text)
  if (!Number.isFinite(number) || number < 0 || number > max)
    throw new Error(`请填写 0–${max} 之间的数字`)
  if (kind === 'count' && !Number.isInteger(number)) throw new Error('尾数请填整数')
  return kind === 'weight' && unit === 'jin' ? number / 2 : number
}

/** Switching units preserves the quantity; invalid input must be repaired first. */
export function changeWeightUnit(value: string, from: WeightUnit, to: WeightUnit) {
  const kg = catchNumber(value, 'weight', from)
  return kg === null ? value : String(to === 'jin' ? kg * 2 : kg)
}
