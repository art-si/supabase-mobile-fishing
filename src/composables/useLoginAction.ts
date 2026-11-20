import { onScopeDispose, watch } from 'vue'
import { onShow, onUnload } from '@dcloudio/uni-app'
import { createLoginReturnIntent } from '@mobile-core/login-return-intent'
import { useAuthStore } from '@/stores/auth'

/** Callers handle the resumed mutation with their normal busy/error UI. */
export function useLoginAction<T>(resume: (intent: T) => Promise<void>) {
  const auth = useAuthStore()
  const intent = createLoginReturnIntent<T>()
  watch(
    () => auth.userId,
    (user) => intent.observeUser(user),
    { flush: 'sync' }
  )
  onShow(() => {
    // Returning without a session consumes/cancels it too; a later login must not replay it.
    const action = intent.take(auth.userId)
    if (action !== undefined) void resume(action)
  })
  onUnload(intent.cancel)
  onScopeDispose(intent.cancel)
  return {
    requireLogin(action: T) {
      if (auth.signedIn) return true
      if (intent.begin(action)) auth.requireLogin()
      return false
    }
  }
}
