import { readonly, ref } from 'vue'

const foreground = ref(false)
export const appForeground = readonly(foreground)
// Only the root app's combined native/framework lifecycle writes this state.
export function setAppForeground(value: boolean) {
  foreground.value = value
}
