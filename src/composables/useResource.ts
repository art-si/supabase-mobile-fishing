import { ref, shallowRef, watch, onScopeDispose } from 'vue'
import { createLatestRequest } from '@mobile-core/latest-request'
import { errorText } from '@/domain/rules'
import { sessionScope } from '@/services/session'
import { ApiError } from '@/services/http'
export function useResource<T>(loader: () => Promise<T>, initial: T) {
  const data = shallowRef(initial)
  const loading = ref(false)
  const error = ref('')
  const request = createLatestRequest()
  async function load() {
    const isCurrent = request.start()
    loading.value = true
    error.value = ''
    try {
      const result = await loader()
      if (isCurrent()) data.value = result
    } catch (e) {
      if (isCurrent()) {
        error.value = errorText(e)
        if (e instanceof ApiError && [401, 403, 404].includes(e.status)) data.value = initial
      }
    } finally {
      if (isCurrent()) loading.value = false
    }
  }
  function invalidate() {
    request.invalidate()
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
