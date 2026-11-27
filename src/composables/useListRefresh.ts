import { usePullDownRefresh } from '@mobile-core/pull-down-refresh'
import { entryLocationReady } from '@/services/entry-location'
import { sessionReady } from '@/services/session'
// #ifdef MP-WEIXIN
import { watch, ref, readonly, provide, onScopeDispose, nextTick } from 'vue'
import { onShow, onHide } from '@dcloudio/uni-app'
import { useAppearanceStore } from '@/stores/appearance'
import { listRefreshingKey } from './list-refresh-state'
// #endif

/** List refreshes obey the same location/session gate as the page content. */
export function useListRefresh(refresh: () => unknown | Promise<unknown>, enabled: () => boolean = () => true) {
  // Native pull-down reveals the page background outside the CSS webview.
  // #ifdef MP-WEIXIN
  const theme = useAppearanceStore()
  const refreshing = ref(false)
  provide(listRefreshingKey, readonly(refreshing))
  let version = 0
  const reset = () => { version++; refreshing.value = false }
  const load = refresh
  refresh = async () => {
    const current = ++version
    refreshing.value = true
    try { await nextTick(); await load() }
    finally { if (current === version) refreshing.value = false }
  }
  let shown = false
  const paint = () => {
    if (!shown) return
    const backgroundColor = theme.palette.mist
    if (typeof uni.setBackgroundColor === 'function')
      uni.setBackgroundColor({ backgroundColor, backgroundColorTop: backgroundColor, backgroundColorBottom: backgroundColor, fail: () => {} })
    if (typeof uni.setBackgroundTextStyle === 'function')
      uni.setBackgroundTextStyle({ textStyle: theme.dark ? 'light' : 'dark', fail: () => {} })
  }
  onShow(() => { shown = true; paint() })
  onHide(() => { shown = false; reset() })
  onScopeDispose(reset)
  watch(() => [theme.dark, theme.palette.mist], paint)
  // #endif
  return usePullDownRefresh(refresh, () => entryLocationReady.value && sessionReady.value && enabled())
}
