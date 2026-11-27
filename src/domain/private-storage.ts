/** Only this app's account-bound drafts and transient map selections are removable. */
export function privateStorageKey(key: string, userId: string) {
  if (!userId) return false
  return (
    key.startsWith(`dyj.live.draft.${userId}.`) ||
    key.startsWith(`dyj.live.draft.guest.`) ||
    key.startsWith(`dyj.live.chat.${userId}.`) ||
    key === `dyj.live.spot-draft.${userId}` ||
    key === `dyj.live.spot-draft.guest` ||
    key.startsWith('dyj.map.selection.')
  )
}
