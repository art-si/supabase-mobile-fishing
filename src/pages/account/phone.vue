<script setup lang="ts">
import { ref, watch } from 'vue'
import { onShow, onHide, onUnload } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import AccountPhoneVerification from '@/components/AccountPhoneVerification.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import { accountIdentity, createAccountSecurityFlow } from '@/services/account-security'
import { hydrateSession } from '@/services/session'
import { maskPhone } from '@/domain/account-security'
import { errorText } from '@/domain/rules'
import { ApiError } from '@/services/http'
import { useAuthStore } from '@/stores/auth'
const auth = useAuthStore()
const step = ref(1),
  phone = ref(''),
  oldPhone = ref(''),
  error = ref(''),
  busy = ref(false),
  loading = ref(true),
  active = ref(false)
let flow: ReturnType<typeof createAccountSecurityFlow> | undefined,
  version = 0
let alive = true
watch(
  () => auth.context,
  () => {
    if (!alive || loading.value) return
    version++
    flow?.cancel()
    flow = undefined
    phone.value = ''
    oldPhone.value = ''
    step.value = 1
    busy.value = false
    error.value = '账号状态已变化，请重新打开页面'
  }
)
async function open() {
  const current = ++version
  active.value = true
  step.value = 1
  loading.value = true
  error.value = ''
  phone.value = ''
  busy.value = false
  try {
    await hydrateSession()
    const identity = await accountIdentity()
    if (current !== version) return
    oldPhone.value = identity.phone
    phone.value = identity.phone
    flow = createAccountSecurityFlow(identity.id, () => alive && current === version)
  } catch (e) {
    if (current === version) error.value = errorText(e)
  } finally {
    if (current === version) loading.value = false
  }
}
onShow(() => {
  active.value = true
  if (!flow && step.value !== 3) void open()
})
onHide(() => {
  active.value = false
})
onUnload(() => {
  alive = false
  version++
  flow?.cancel()
  flow = undefined
  phone.value = ''
  oldPhone.value = ''
  step.value = 1
})
async function send(number: string) {
  if (!flow) throw new ApiError('请重新打开页面后重试', 0, 'ACCOUNT_FLOW_EXPIRED')
  if (step.value === 1) await flow.send(oldPhone.value)
  else await flow.sendNew(number)
}
async function verify(number: string, token: string) {
  if (!flow) throw new ApiError('请重新打开页面后重试', 0, 'ACCOUNT_FLOW_EXPIRED')
  if (step.value === 1) await flow.verify(oldPhone.value, token)
  else await flow.verifyNew(number, token)
}
function verified() {
  busy.value = false
  if (step.value === 1) {
    step.value = 2
    phone.value = ''
  } else step.value = 3
}
function restart() {
  flow?.cancel()
  flow = undefined
  void open()
}
</script>
<template>
  <FishingShell title="更换手机号" back narrow :confirm-back="async () => !busy">
    <view class="fishing-content account-content">
      <text v-if="loading" class="caption" role="status">正在读取手机号…</text>
      <template v-else-if="step === 3">
        <view class="account-heading" role="status"
          ><text class="account-title" role="heading" aria-level="1">手机号已换绑</text
          ><text class="account-description"
            >新手机号 {{ maskPhone(phone) }} 已生效。资料、记录、收藏和关注关系均已保留。</text
          ></view
        >
        <text class="caption">以后请使用新手机号登录，原手机号将无法进入此账号。</text>
        <MobileAction class="primary" @click="uni.navigateBack()">完成</MobileAction>
      </template>
      <template v-else>
        <view class="account-heading"
          ><text class="account-step">{{
            step === 1 ? '1 / 2 · 验证原手机号' : '2 / 2 · 绑定新手机号'
          }}</text
          ><text class="account-title" role="heading" aria-level="1">{{
            step === 1 ? '确认是你本人' : '验证新手机号'
          }}</text
          ><text class="account-description">{{
            step === 1
              ? '先验证当前绑定的手机号，保护你的账号。'
              : '请在 5 分钟内完成。新手机号生效后，原手机号不再用于登录。'
          }}</text></view
        >
        <AccountPhoneVerification
          v-if="flow"
          :key="step"
          v-model="phone"
          :readonly-phone="step === 1"
          :send="send"
          :verify="verify"
          :submit-label="step === 2 ? '确认换绑' : '验证并继续'"
          @verified="verified"
          @busy="busy = $event"
        />
        <text v-if="error" class="error" role="alert">{{ error }}</text>
        <MobileAction v-if="!flow" class="secondary" @click="open">重新读取</MobileAction>
        <view v-if="step === 2" class="account-links"
          ><MobileAction class="text-action" :disabled="busy" @click="restart"
            >重新验证原手机号</MobileAction
          ></view
        >
        <MobileAction
          v-if="step === 1"
          class="text-action"
          :disabled="busy"
          @click="uni.navigateTo({ url: '/pages/contact/index' })"
          >原手机号无法接收短信？联系运营者</MobileAction
        >
      </template>
    </view>
  </FishingShell>
</template>
