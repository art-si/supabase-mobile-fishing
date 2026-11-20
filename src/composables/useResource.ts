import { ref, shallowRef, watch, onScopeDispose } from 'vue'
import { errorText } from '@/domain/rules'
import { sessionScope } from '@/services/session'
import { ApiError } from '@/services/http'
export function useResource<T>(loader: () => Promise<T>, initial: T) {
  const data = shallowRef(initial)
  const loading = ref(false)
  const error = ref('')
  let version = 0
  async function load() {
    const current = ++version
    loading.value = true
    error.value = ''
    try {
      const result = await loader()
      if (current === version) data.value = result
    } catch (e) {
      if (current === version) {
        error.value = errorText(e)
        if (e instanceof ApiError && [401, 403, 404].includes(e.status)) data.value = initial
      }
    } finally {
      if (current === version) loading.value = false
    }
  }
  function invalidate() {
    version++
    loading.value = false
  }
  watch(
    sessionScope,
    () => {
      invalidate()
      data.value = initial
      error.value = ''
      void load()
    },
    { flush: 'sync' }
  )
  onScopeDispose(invalidate)
  return { data, loading, error, load, invalidate }
}
