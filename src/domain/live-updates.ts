/** Account-scoped invalidation lifecycle, independent of SDK, Vue, and auth implementation. */
export function createLiveUpdates(
  open: (userId: string, current: () => boolean, notify: () => void) => () => void
) {
  const listeners = new Set<() => void>()
  let identity: { userId: string; scope: number } | null = null
  let foreground = false,
    generation = 0,
    close: (() => void) | undefined
  let pending: ReturnType<typeof setTimeout> | undefined
  function stop() {
    generation++
    clearTimeout(pending)
    pending = undefined
    const old = close
    close = undefined
    old?.()
  }
  function start() {
    if (close || !identity || !foreground || !listeners.size) return
    const currentGeneration = ++generation
    const current = () =>
      currentGeneration === generation && foreground && !!identity && !!listeners.size
    close = open(identity.userId, current, () => {
      if (!current() || pending) return
      pending = setTimeout(() => {
        pending = undefined
        if (current()) for (const listener of listeners) listener()
      }, 120)
    })
  }
  return {
    setIdentity(value: typeof identity, refresh = false) {
      if (!refresh && identity?.userId === value?.userId && identity?.scope === value?.scope) return
      stop()
      identity = value
      start()
    },
    setForeground(value: boolean) {
      if (foreground === value) return
      foreground = value
      if (value) start()
      else stop()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      start()
      return () => {
        listeners.delete(listener)
        if (!listeners.size) stop()
      }
    }
  }
}
