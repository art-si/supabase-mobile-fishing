<script setup lang="ts">
defineOptions({ options: { styleIsolation: 'apply-shared' } })
import { computed } from 'vue'
import MobileWorkspace from '@mobile-core/components/MobileWorkspace.vue'
import MobileTopBar from '@mobile-core/components/MobileTopBar.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import { isDemo } from '@/config'
import FishMark from './FishMark.vue'
import FishingLoadingStatus from './FishingLoadingStatus.vue'
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
      <FishingLocationGate v-if="locationBlocked" />
      <template v-else>
        <view v-if="isDemo && tabbed" class="mode-strip">
          <text>本机体验 · 示例内容，不连接线上</text>
          <MobileAction
            variant="link"
            aria-label="查看体验说明"
            @click="uni.navigateTo({ url: '/pages/settings/index' })"
            >体验说明</MobileAction
          >
        </view>
        <view v-if="entryLocationReady && sessionNotice" class="session-notice notice stack stack--tight" role="status">
          <text>{{ sessionNotice }}</text>
          <view class="mobile-action-group">
            <MobileAction v-if="!auth.signedIn" class="text-action" @click="auth.requireLogin()"
              >重新登录</MobileAction
            >
            <MobileAction class="text-action" @click="sessionNotice = ''">知道了</MobileAction>
          </view>
        </view>
        <view v-if="!sessionReady && !withoutLocation" class="fishing-content">
          <FishingLoadingStatus label="正在恢复登录…" />
        </view>
        <slot v-else />
      </template>
    </MobileWorkspace>
  </wd-config-provider>
</template>
<style scoped>
.session-notice {
  flex: none;
  margin: var(--fishing-page-top) var(--fishing-page-end) 0 var(--fishing-page-start);
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
.mode-strip {
  margin: var(--fishing-gap-small) var(--fishing-page-end) 0 var(--fishing-page-start);
  display: flex;
  flex-wrap: wrap;
  gap: 0 8px;
  align-items: center;
  justify-content: space-between;
  color: var(--reed);
  font-size: var(--fishing-small-size);
  border-bottom: 1px solid var(--line);
}
.mode-strip .mobile-action {
  min-height: 44px;
  font-size: var(--fishing-small-size);
}
</style>
