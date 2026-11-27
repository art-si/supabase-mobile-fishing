<script setup lang="ts">
import { computed } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import { entryLocationStatus, retryEntryLocation } from '@/services/entry-location'

let deniedMessage = '在浏览器的网站设置中允许位置访问，返回后重新检查。'
let actionAfterDenial = '重新检查'
// #ifdef H5
import { Capacitor } from '@capacitor/core'
if (Capacitor.isNativePlatform()) deniedMessage = '在系统设置中允许钓友集访问位置，返回后重新检查。'
// #endif
// #ifdef MP-WEIXIN
deniedMessage = '在小程序设置中允许使用大致位置。'
actionAfterDenial = '打开小程序设置'
// #endif

const messages: Partial<Record<typeof entryLocationStatus.value, string>> = {
  checking: '定位成功后会自动显示附近内容。',
  denied: deniedMessage,
  insecure: '请用安全链接（HTTPS）重新打开钓友集。',
  unsupported: '请在支持位置权限的设备上重新打开钓友集。',
  'not-enabled': '附近钓位与水域查询暂时无法使用，请稍后重新检查。',
  'devtools-unavailable': '电脑调试器未能提供位置，请使用手机微信扫描预览码验证定位。',
  unavailable: '位置获取失败，请稍后重新尝试。'
}
const titles: Partial<Record<typeof entryLocationStatus.value, string>> = {
  checking: '正在获取位置',
  insecure: '当前链接无法定位',
  unsupported: '当前环境无法定位',
  'not-enabled': '位置服务暂未开放',
  'devtools-unavailable': '请使用手机验证定位',
  unavailable: '暂时无法获取位置'
}
const feedback = computed(
  () => messages[entryLocationStatus.value] || '使用位置查找附近钓位和水域。'
)
const title = computed(() => titles[entryLocationStatus.value] || '请先开启位置')
const canRetry = computed(() => !['insecure', 'unsupported'].includes(entryLocationStatus.value))
const action = computed(() => {
  switch (entryLocationStatus.value) {
    case 'checking':
      return '正在定位…'
    case 'denied':
      return actionAfterDenial
    case 'prompt':
      return '请求位置权限'
    case 'unavailable':
      return '重新定位'
    default:
      return '重新检查'
  }
})
</script>

<template>
  <view class="location-gate">
    <view class="location-gate__content stack">
      <MobileIcon name="location" class="location-gate__icon" :size="28" aria-hidden="true" />
      <view class="stack stack--tight" role="status">
        <text class="location-gate__title" role="heading" aria-level="2">{{ title }}</text>
        <text class="body muted">{{ feedback }}</text>
      </view>
      <MobileAction
        v-if="canRetry"
        class="primary"
        :disabled="entryLocationStatus === 'checking'"
        @click="retryEntryLocation"
        >{{ action }}</MobileAction
      >
      <MobileAction
        class="text-action"
        @click="uni.navigateTo({ url: '/pages/settings/legal?type=privacy' })"
        >查看隐私说明</MobileAction
      >
    </view>
  </view>
</template>

<style scoped>
.location-gate {
  flex: 1;
  display: grid;
  place-items: center;
  padding: var(--fishing-page-top) var(--fishing-page-end);
  box-sizing: border-box;
  min-width: 0;
}
.location-gate__content {
  width: 100%;
  max-width: 24rem;
  padding: 16px 0;
  overflow-wrap: anywhere;
}
.location-gate__title {
  font-size: var(--fishing-title-size);
  font-weight: var(--fishing-title-weight);
  line-height: 1.3;
}
.location-gate__icon {
  color: var(--lake);
}
</style>
