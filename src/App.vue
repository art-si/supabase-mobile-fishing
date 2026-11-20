<script setup lang="ts">
import { onUnmounted } from 'vue'
import { onLaunch, onShow, onHide } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { resumeSession, watchExternalSessions } from '@/services/session'
import { useAppearanceStore, watchSystemAppearance } from '@/stores/appearance'
import { initializeLiveUpdates, setLiveForeground } from '@/services/live-updates'
import { setAppForeground } from '@/services/app-activity'
import { createAppForeground, type NativeAppStateSource } from '@mobile-core/app-foreground'
// #ifdef H5
import { App as NativeApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { registerAndroidBackHandler } from '@mobile-core/android-back'
// #endif
let activity: ReturnType<typeof createAppForeground> | undefined
onLaunch(() => {
  watchSystemAppearance()
  void useAuthStore().hydrate()
  watchExternalSessions()
  initializeLiveUpdates()
  let native: NativeAppStateSource | undefined
  // #ifdef H5
  if (Capacitor.isNativePlatform()) native = NativeApp
  registerAndroidBackHandler(NativeApp)
  // #endif
  activity = createAppForeground(
    (foreground) => {
      setLiveForeground(foreground)
      setAppForeground(foreground)
      if (foreground) {
        useAppearanceStore().refreshSystem()
        void resumeSession()
      }
    },
    { native }
  )
})
onShow(() => activity?.setVisible(true))
onHide(() => activity?.setVisible(false))
onUnmounted(() => activity?.dispose())
</script>
<style lang="scss">
@use '@mobile-core/styles/global.scss' as mobile;
@use '@mobile-core/styles/workspace.scss' as workspace;
@use '@mobile-core/styles/grouped-list.scss' as grouped;
@use './styles/fishing.scss';
@use './styles/fish-identity.css';
@use './styles/account.scss';
/* #ifndef MP-WEIXIN */
@include mobile.apply('tms');
/* #endif */
/* #ifdef MP-WEIXIN */
@include mobile.apply('tms', $embed-body-font: false);
/* #endif */
@include workspace.apply('fishing');
@include grouped.styles();
@include fishing.tokens();
@include fishing.components();
</style>
