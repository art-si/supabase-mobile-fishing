import type { CatchDraft, CatchRecord, PostDraft, Trip } from './models'
import { createId } from './rules'
import { catchNumber } from './catch-measurements'

export const MAX_TRIP_CATCHES = 20
export function freshCatch(record?: CatchRecord): CatchDraft {
  return {
    id: createId(),
    species: record?.species || '',
    count: record?.count == null ? '' : String(record.count),
    weight: record?.weight_kg == null ? '' : String(record.weight_kg),
    weight_unit: 'kg'
  }
}
export function tripCatches(trip: Pick<Trip, 'catch_records' | 'species' | 'count' | 'weight_kg'>) {
  if (Array.isArray(trip.catch_records)) return trip.catch_records
  return trip.species || trip.count !== null || trip.weight_kg !== null
    ? [{ species: trip.species, count: trip.count, weight_kg: trip.weight_kg }]
    : []
}
/** Upgrade old local drafts lazily; do not reinterpret null/unknown as zero. */
export function ensureTripCatches(draft: PostDraft) {
  if (!Array.isArray(draft.catches)) {
    draft.catches = [
      {
        id: createId(),
        species: draft.species,
        count: draft.count,
        weight: draft.weight,
        weight_unit: draft.weight_unit
      }
    ]
  }
  if (!draft.catches.length) draft.catches = [freshCatch()]
  return draft.catches
}
export function catchField(row: CatchDraft, field: 'species' | 'count' | 'weight') {
  return `catch-${row.id}-${field}`
}
export function validateCatches(rows: CatchDraft[]) {
  const errors: Record<string, string> = {}
  if (rows.length > MAX_TRIP_CATCHES) errors.catches = `每次出钓最多记录 ${MAX_TRIP_CATCHES} 条渔获`
  let count = 0,
    weight = 0
  for (const row of rows) {
    if ([...row.species.trim()].length > 60) errors[catchField(row, 'species')] = '鱼种最多 60 字'
    for (const field of ['count', 'weight'] as const) {
      try {
        const value = catchNumber(row[field], field, row.weight_unit)
        if (field === 'count') count += value ?? 0
        else weight += value ?? 0
      } catch (e) {
        errors[catchField(row, field)] = (e as Error).message
      }
    }
  }
  if (count > 10000) errors.catches = '这次出钓的合计尾数不能超过 10000'
  if (Number(weight.toPrecision(15)) > 10000) errors.catches = '这次出钓的合计重量不能超过 10000 kg'
  return errors
}
export function catchRecordsFromDraft(draft: PostDraft): CatchRecord[] {
  const rows = draft.catches ?? [
    {
      id: 'legacy',
      species: draft.species,
      count: draft.count,
      weight: draft.weight,
      weight_unit: draft.weight_unit
    }
  ]
  const errors = validateCatches(rows)
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0])
  return rows
    .map((row) => ({
      species: row.species.trim(),
      count: catchNumber(row.count, 'count'),
      weight_kg: catchNumber(row.weight, 'weight', row.weight_unit)
    }))
    .filter((row) => row.species || row.count !== null || row.weight_kg !== null)
}
/** A complete total is unknown if even one row is unknown. Never call a partial sum a total. */
export function catchSummary(rows: CatchRecord[]) {
  return {
    species: rows.length === 1 ? rows[0].species : rows.length ? '多条渔获' : '',
    count:
      rows.length && rows.every((row) => row.count !== null)
        ? rows.reduce((sum, row) => sum + row.count!, 0)
        : null,
    weight_kg:
      rows.length && rows.every((row) => row.weight_kg !== null)
        ? Number(rows.reduce((sum, row) => sum + row.weight_kg!, 0).toPrecision(15))
        : null
  }
}
