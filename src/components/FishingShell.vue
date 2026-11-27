<script setup lang="ts">
import MobileAction from '@mobile-core/components/MobileAction.vue'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
import { computed } from 'vue'
// #ifdef MP-WEIXIN
import { inject, ref } from 'vue'
import MobileLoadingStatus from '@mobile-core/components/MobileLoadingStatus.vue'
import { listRefreshingKey } from '@/composables/list-refresh-state'
const listRefreshing = inject(listRefreshingKey, ref(false))
// #endif
import MobileWorkspace from '@mobile-core/components/MobileWorkspace.vue'
import MobileTopBar from '@mobile-core/components/MobileTopBar.vue'

import FishMark from './FishMark.vue'
import MobileSkeleton from '@mobile-core/components/MobileSkeleton.vue'
import FishingLocationGate from './FishingLocationGate.vue'
import { entryLocationReady } from '@/services/entry-location'
import { useAppearanceStore } from '@/stores/appearance'
import { useAuthStore } from '@/stores/auth'
import { sessionNotice, sessionReady } from '@/services/session'
const theme = useAppearanceStore()
const auth = useAuthStore()
const props = defineProps<{
  title: string
  subtitle?: string
  back?: boolean
  tabbed?: boolean
  narrow?: boolean
  edgeToBottom?: boolean
  action?: string
  actionIcon?: string
  confirmBack?: () => Promise<boolean>
  withoutLocation?: boolean
  hideSessionNotice?: boolean
}>()
const locationBlocked = computed(() => !entryLocationReady.value && !props.withoutLocation)
defineEmits<{ action: [] }>()
</script>
<template>
  <wd-config-provider :theme="theme.dark ? 'dark' : 'light'" :theme-vars="theme.variables">
    <MobileWorkspace
      :container-class="[
        'page',
        'fishing-page',
        `fishing-skin-${theme.skin}`,
        narrow ? 'fishing-page--narrow' : '',
        edgeToBottom ? 'fishing-page--edge-to-bottom' : '',
        tabbed && !locationBlocked ? 'fishing-page--tabbed' : ''
      ]"
    >
      <MobileTopBar
        :title="locationBlocked ? '钓友集' : title"
        :subtitle="locationBlocked ? undefined : subtitle"
        :show-back="!locationBlocked && back"
        capsule="always"
        back-fallback="/pages/home/index"
        :confirm-back="confirmBack"
        :show-menu="!locationBlocked && !!action"
        :menu-label="action"
        :menu-icon="actionIcon || 'add'"
        @menu="$emit('action')"
      >
        <template #title>
          <view v-if="locationBlocked || title === '钓友集'" class="fishing-wordmark" role="heading" aria-level="1">
            <FishMark :size="28" /><text>钓友集</text>
          </view>
          <text v-else-if="title" class="fishing-shell-title" role="heading" aria-level="1">{{
            title
          }}</text>
          <view v-else aria-hidden="true" />
        </template>
      </MobileTopBar>
      <!-- #ifdef MP-WEIXIN -->
      <view v-if="listRefreshing && !locationBlocked" class="fishing-refresh-indicator" role="status" aria-label="正在刷新列表">
        <MobileLoadingStatus label="" />
      </view>
      <!-- #endif -->
      <FishingLocationGate v-if="locationBlocked" />
      <template v-else>
        <view v-if="!hideSessionNotice && entryLocationReady && sessionNotice" class="session-notice notice stack stack--tight" role="status">
          <text>{{ sessionNotice }}</text>
          <view class="session-notice__actions">
            <MobileAction v-if="!auth.signedIn" class="text-action"
              @click="auth.requireLogin()"
             >重新登录</MobileAction>
            <MobileAction class="text-action"
              @click="sessionNotice = ''"
             >知道了</MobileAction>
          </view>
        </view>
        <view v-if="!sessionReady && !withoutLocation" class="fishing-content">
          <MobileSkeleton label="正在恢复登录…" />
        </view>
        <slot v-else />
      </template>
    </MobileWorkspace>
  </wd-config-provider>
</template>
<style scoped>
/* #ifdef MP-WEIXIN */
.fishing-refresh-indicator {
  --mobile-loading-gap: 0px;
  position: fixed;
  top: calc(var(--mobile-capsule-top, 88px) + 8px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 140;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--paper);
  color: var(--lake);
  box-shadow: 0 2px 6px #0002;
  pointer-events: none;
}
/* #endif */
.session-notice {
  flex: none;
  margin: var(--fishing-page-top) var(--fishing-page-end) 0 var(--fishing-page-start);
}
.session-notice__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0 12px;
}
.fishing-wordmark {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--ink);
  font-size: var(--mobile-header-title-size);
  font-weight: var(--fishing-title-weight);
  line-height: 1.25;
}
.fishing-shell-title {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  text-wrap: balance;
  color: var(--ink);
  font-size: var(--mobile-header-title-size);
  font-weight: var(--fishing-title-weight);
  line-height: 1.25;
  letter-spacing: var(--mobile-header-title-spacing, normal);
}
</style>
