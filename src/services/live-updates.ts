import { watch } from 'vue'
import { RealtimeClient, type RealtimeClientOptions } from '@supabase/realtime-js'
import { createLiveUpdates } from '@/domain/live-updates'
import { config, isDemo, backendReady } from '@/config'
import { accessToken, session, sessionScope } from '@/services/session'
// #ifdef MP-WEIXIN
import 'core-js/actual/url'
import { createUniWebSocket } from '@mobile-core/uni-websocket'
// #endif

const updates = createLiveUpdates((userId, current, notify) => {
  let client: RealtimeClient | undefined
  let stopped = false
  const valid = () => !stopped && current() && session.value?.user.id === userId
  const close = () => {
    stopped = true
    // Callback guards take effect immediately, even while the SDK finishes its close handshake.
    if (client) {
      void client.removeAllChannels().catch(() => {})
      void client.disconnect().catch(() => {})
    }
  }
  void (async () => {
    try {
      const token = await accessToken()
      if (!valid() || !token) return
      const options: RealtimeClientOptions = {
        params: { apikey: config.supabaseKey },
        vsn: '1.0.0', // JSON wire format also works without TextEncoder/Decoder in mini programs.
        timeout: 10000,
        heartbeatIntervalMs: 25000,
        reconnectAfterMs: (attempt) => Math.min(30000, 1000 * 2 ** Math.min(attempt - 1, 5)),
        accessToken: async () => {
          if (!valid()) return null
          try {
            const next = await accessToken()
            return valid() ? next || null : null
          } catch {
            close()
            return null
          }
        },
        // Receive-only: never fall back to HTTP broadcast or transmit a Presence state.
        fetch: async () => {
          throw new Error('Realtime client is receive-only')
        }
      }
      // #ifdef MP-WEIXIN
      options.transport = createUniWebSocket((options) => uni.connectSocket(options))
      // #endif
      client = new RealtimeClient(`${config.supabaseUrl}/realtime/v1`, options)
      await client.setAuth(token)
      if (!valid()) {
        close()
        return
      }
      client
        .channel(`fishing:user:${userId}`, {
          config: { private: true, presence: { enabled: false } }
        })
        .on('broadcast', { event: 'invalidate' }, () => {
          if (valid()) notify()
        })
        .subscribe((status) => {
          // Every (re)join catches up through authorized reads. No payload is used as business data.
          if (status === 'SUBSCRIBED' && valid()) notify()
        })
    } catch {
      close()
    } // Existing polling/error recovery remains available without noisy banners.
  })()
  return close
})
let installed = false
let appForeground = false
function updateForeground() {
  let visible = appForeground
  // #ifdef H5
  visible = visible && document.visibilityState !== 'hidden'
  // #endif
  updates.setForeground(visible)
}
export function initializeLiveUpdates() {
  if (installed || isDemo || !backendReady) return
  installed = true
  watch(
    [sessionScope, () => session.value?.access_token],
    () => {
      updates.setIdentity(
        session.value ? { userId: session.value.user.id, scope: sessionScope.value } : null,
        true
      )
    },
    { immediate: true, flush: 'sync' }
  )
  // #ifdef H5
  document.addEventListener('visibilitychange', updateForeground)
  // #endif
}
export function setLiveForeground(value: boolean) {
  appForeground = value
  updateForeground()
}
export const onSocialUpdate = updates.subscribe
