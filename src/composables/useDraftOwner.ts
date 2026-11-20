import { computed, nextTick, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'

/** Private editors always restore from the signed-in owner's storage, never a guest key. */
export function useDraftOwner(resetForAccount: () => void) {
  const auth = useAuthStore()
  const owner = ref(auth.userId)
  const resetting = ref(false)
  const available = computed(() => Boolean(auth.userId) && owner.value === auth.userId)
  watch(
    () => auth.context,
    () => {
      if (!auth.userId) return
      // Restore even for the same owner: explicit logout may have cleared their draft.
      // Expiration leaves the owned storage intact, so reauthentication recovers it.
      resetting.value = true
      owner.value = auth.userId
      resetForAccount()
      void nextTick(() => {
        resetting.value = false
      })
    },
    { flush: 'sync' }
  )
  return { owner, available, resetting }
}
