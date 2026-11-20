import type { SpotDraft } from './models'
import { validCoordinates } from './rules'

/** A display title, not an invented water-body name. Existing nonempty server contracts stay valid. */
export function spotEntryName(name: string, selectedLabel = '') {
  return name.trim() || selectedLabel.trim().slice(0, 60) || '已保存钓位'
}
export function canSaveSpotPoint(draft: SpotDraft, resolved: boolean) {
  return resolved && draft.precision === 'exact' && validCoordinates(draft.longitude, draft.latitude) && !!draft.city.trim()
}
