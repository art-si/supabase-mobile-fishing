import { ref } from 'vue'
import { errorText } from '@/domain/rules'
import { ApiError } from '@/services/http'
export function useMutation() {
  const busy = ref(false)
  const error = ref('')
  async function run(task: () => Promise<void>) {
    if (busy.value) return
    busy.value = true
    error.value = ''
    try {
      await task()
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'SESSION_CHANGED')) error.value = errorText(e)
    } finally {
      busy.value = false
    }
  }
  return { busy, error, run }
}
