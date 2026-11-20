/** Only this app's account-bound drafts and transient map selections are removable. */
export function privateStorageKey(key: string, mode: 'demo' | 'live', userId: string) {
  if (!userId) return false
  return (
    key.startsWith(`dyj.${mode}.draft.${userId}.`) ||
    key.startsWith(`dyj.${mode}.draft.guest.`) ||
    key.startsWith(`dyj.${mode}.chat.${userId}.`) ||
    key === `dyj.${mode}.spot-draft.${userId}` ||
    key === `dyj.${mode}.spot-draft.guest` ||
    key.startsWith('dyj.map.selection.')
  )
}
