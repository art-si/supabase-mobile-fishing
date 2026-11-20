<script setup lang="ts">
defineOptions({ options: { styleIsolation: 'apply-shared' } })
import MobileWorkspace from '@mobile-core/components/MobileWorkspace.vue'
import MobileTopBar from '@mobile-core/components/MobileTopBar.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import { isDemo } from '@/config'
import FishMark from './FishMark.vue'
import { useAppearanceStore } from '@/stores/appearance'
import { useAuthStore } from '@/stores/auth'
import { sessionNotice, sessionReady } from '@/services/session'
const theme = useAppearanceStore()
const auth = useAuthStore()
defineProps<{
  title: string
  subtitle?: string
  back?: boolean
  tabbed?: boolean
  edgeToBottom?: boolean
  action?: string
  actionIcon?: string
  confirmBack?: () => Promise<boolean>
}>()
defineEmits<{ action: [] }>()
</script>
<template>
  <wd-config-provider :theme="theme.dark ? 'dark' : 'light'" :theme-vars="theme.variables">
    <MobileWorkspace
      :container-class="[
        'page',
        'fishing-page',
        `fishing-skin-${theme.skin}`,
        edgeToBottom ? 'fishing-page--edge-to-bottom' : '',
        tabbed ? 'fishing-page--tabbed' : ''
      ]"
    >
      <MobileTopBar
        :title="title"
        :subtitle="subtitle"
        :show-back="back"
        capsule="always"
        back-fallback="/pages/home/index"
        :confirm-back="confirmBack"
        :show-menu="!!action"
        :menu-label="action"
        :menu-icon="actionIcon || 'add'"
        @menu="$emit('action')"
      >
        <template #title>
          <view v-if="title === '钓友集'" class="fishing-wordmark" role="heading" aria-level="1">
            <FishMark :size="32" /><text>钓友集</text>
          </view>
          <text v-else class="fishing-shell-title" role="heading" aria-level="1">{{ title }}</text>
        </template>
      </MobileTopBar>
      <view v-if="isDemo && tabbed" class="mode-strip">
        <text>本机体验 · 示例内容，不连接线上</text>
        <MobileAction
          variant="link"
          aria-label="查看体验说明"
          @click="uni.navigateTo({ url: '/pages/settings/index' })"
          >体验说明</MobileAction
        >
      </view>
      <view v-if="sessionNotice" class="session-notice notice stack stack--tight" role="status">
        <text>{{ sessionNotice }}</text>
        <view class="mobile-action-group">
          <MobileAction v-if="!auth.signedIn" class="text-action" @click="auth.requireLogin()"
            >重新登录</MobileAction
          >
          <MobileAction class="text-action" @click="sessionNotice = ''">知道了</MobileAction>
        </view>
      </view>
      <view v-if="!sessionReady" class="fishing-content stack" role="status">
        <FishMark :size="48" /><text class="caption">正在恢复登录…</text>
      </view>
      <slot v-else />
    </MobileWorkspace>
  </wd-config-provider>
</template>
<style scoped>
.session-notice {
  margin: 16px var(--mobile-workspace-inset) 0;
}
.fishing-wordmark {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--ink);
  font-size: var(--mobile-header-title-size, 1.75rem);
  font-weight: 750;
  line-height: 1.3;
}
.fishing-shell-title {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  color: var(--ink);
  font-size: var(--mobile-header-title-size, 1.75rem);
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: var(--mobile-header-title-spacing, normal);
}
.mode-strip {
  margin: 8px var(--mobile-workspace-inset) 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0 8px;
  align-items: center;
  justify-content: space-between;
  color: var(--reed);
  font-size: 0.75rem;
  border-bottom: 1px solid var(--line);
}
.mode-strip .mobile-action {
  min-height: 44px;
  font-size: 0.75rem;
}
</style>
