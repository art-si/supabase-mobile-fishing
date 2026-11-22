<script setup lang="ts">
import { ref, watch } from 'vue'
import { onShow, onHide } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import { useAuthStore } from '@/stores/auth'
import { isDemo } from '@/config'
import { accountIdentity } from '@/services/account-security'
import { maskPhone } from '@/domain/account-security'
import { errorText } from '@/domain/rules'
import { hydrateSession } from '@/services/session'
import { read } from '@/services/repository'
import type { PersonDetail } from '@/domain/models'
const auth = useAuthStore()
const phone = ref(''),
  handle = ref(''),
  copyFeedback = ref(''),
  loading = ref(true),
  error = ref('')
let version = 0
let active = false
async function load() {
  if (isDemo) return
  const current = ++version
  loading.value = true
  error.value = ''
  phone.value = ''
  handle.value = ''
  copyFeedback.value = ''
  try {
    await hydrateSession()
    if (!auth.signedIn) return
    const identity = await accountIdentity()
    if (current !== version) return
    const detail = await read<PersonDetail>('profile', { id: identity.id })
    if (current === version && auth.userId === identity.id) {
      phone.value = identity.phone
      if (detail?.profile?.id === identity.id) handle.value = detail.profile.handle
    }
  } catch (e) {
    if (current === version) error.value = errorText(e)
  } finally {
    if (current === version) loading.value = false
  }
}
onShow(() => {
  active = true
  void load()
})
onHide(() => {
  active = false
  version++
  phone.value = ''
  handle.value = ''
  copyFeedback.value = ''
})
function copyHandle() {
  if (!handle.value) return
  const current = version
  uni.setClipboardData({
    data: handle.value,
    showToast: false,
    success() {
      if (current === version) copyFeedback.value = '钓友号已复制'
    },
    fail() {
      if (current === version) copyFeedback.value = '复制未完成，请长按钓友号复制'
    }
  })
}
watch(
  () => auth.context,
  () => {
    version++
    phone.value = ''
    handle.value = ''
    copyFeedback.value = ''
    error.value = ''
    if (active) void load()
  }
)
</script>
<template>
  <FishingShell title="账号与安全" back narrow>
    <view class="fishing-content account-content">
      <text v-if="isDemo" class="notice">体验记录仅保存于这台设备。账号安全设置在正式环境中使用。</text>
      <text v-else-if="loading" class="caption" role="status">正在读取账号…</text>
      <template v-else-if="auth.signedIn">
        <view class="account-heading"
          ><text class="account-title" role="heading" aria-level="1">登录方式</text
          ><text class="account-description">手机号、钓友号都登录同一个账号。</text></view
        >
        <view v-if="phone" class="account-list">
          <view v-if="handle" class="list-row account-handle-row">
            <view class="account-row-copy"
              ><text class="name">钓友号</text
              ><text class="caption" selectable>{{ handle }}</text></view
            >
            <MobileAction class="text-action" aria-label="复制钓友号" @click="copyHandle"
              >复制</MobileAction
            >
          </view>
          <MobileAction class="list-row" @click="uni.navigateTo({ url: '/pages/account/phone' })"
            ><view class="account-row-copy"
              ><text class="name">绑定手机号</text
              ><text class="caption">{{ maskPhone(phone) }}</text></view
            ><text class="caption">更换</text><MobileIcon name="chevron" :size="18"
          /></MobileAction>
          <MobileAction
            class="list-row"
            @click="uni.navigateTo({ url: '/pages/account/password?mode=set' })"
            ><view class="account-row-copy"
              ><text class="name">登录密码</text
              ><text class="caption">通过短信验证设置或重置</text></view
            ><MobileIcon name="chevron" :size="18"
          /></MobileAction>
        </view>
        <text v-if="copyFeedback" class="caption" role="status">{{ copyFeedback }}</text>
        <text class="caption"
          >设置密码后，可用钓友号或手机号登录。钓友号固定，昵称可在个人资料中修改。更换手机号后，记录、收藏和关注关系都会保留。</text
        >
        <text class="caption"
          >登录状态会自动保存。主动退出、登录失效或更换设备后，需要重新登录。</text
        >
        <view class="account-list">
          <MobileAction class="list-row" @click="uni.navigateTo({ url: '/pages/account/connections' })">
            <text class="name">第三方账号</text>
            <MobileIcon name="chevron" :size="18" aria-hidden="true" />
          </MobileAction>
        </view>
        <text v-if="error" class="error" role="alert">{{ error }}</text>
        <MobileAction v-if="error" class="secondary" @click="load">重新读取</MobileAction>
      </template>
      <MobileAction v-else class="primary" @click="auth.requireLogin()"
        >登录后管理账号</MobileAction
      >
    </view>
  </FishingShell>
</template>
<style scoped>
.account-handle-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.account-handle-row .account-row-copy {
  flex: 1;
  min-inline-size: 0;
}
.account-handle-row .caption {
  overflow-wrap: anywhere;
}
</style>
