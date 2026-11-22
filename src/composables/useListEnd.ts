import { getCurrentInstance, ref, watchEffect } from 'vue'

/** Observe the end of a list inside a sheet independently of page scrolling. */
export function useListEnd(selector: string, enabled: () => boolean, load: () => void) {
  const element = ref<HTMLElement>()
  const scope = getCurrentInstance()?.proxy
  watchEffect(cleanup => {
    if (!enabled()) return
    // #ifdef H5
    if (!element.value || typeof IntersectionObserver === 'undefined') return
    const browser = new IntersectionObserver(entries => {
      if (enabled() && entries.some(entry => entry.isIntersecting)) load()
    })
    browser.observe(element.value)
    cleanup(() => browser.disconnect())
    // #endif
    // #ifdef MP-WEIXIN
    if (!scope) return
    const native = uni.createIntersectionObserver(scope)
    native.relativeToViewport().observe(selector, entry => {
      if (enabled() && entry.intersectionRatio > 0) load()
    })
    cleanup(() => native.disconnect())
    // #endif
  }, { flush: 'post' })
  return element
}
