<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { onLoad, onShow, onHide, onUnload } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import AccountPhoneVerification from '@/components/AccountPhoneVerification.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileCheckbox from '@mobile-core/components/MobileCheckbox.vue'
import MobileField from '@mobile-core/components/MobileField.vue'
import { revealControl, nativeFieldOf, type ElementTarget } from '@mobile-core/form-focus'
import { useAuthStore } from '@/stores/auth'
import { accountIdentity, createAccountSecurityFlow } from '@/services/account-security'
import { hydrateSession } from '@/services/session'
import { rememberedLogin, rememberLoginLabel, saveLoginMemory } from '@/services/login-memory'
import { passwordIssue } from '@/domain/account-security'
import { errorText } from '@/domain/rules'
import { ApiError } from '@/services/http'
const auth = useAuthStore()
const rememberLabel = rememberLoginLabel()
const passwordControl = ref<ElementTarget>(),
  confirmationControl = ref<ElementTarget>()
const mode = ref('reset'),
  step = ref(1),
  phone = ref(''),
  password = ref(''),
  confirmation = ref('')
const fromLogin = ref(false),
  remember = ref(false)
const passwordError = ref(''),
  confirmationError = ref(''),
  error = ref(''),
  focused = ref('')
const loading = ref(true),
  busy = ref(false),
  active = ref(false)
let owner = '',
  flow: ReturnType<typeof createAccountSecurityFlow> | undefined,
  version = 0
let verifiedOwner = '',
  savingPassword = false
let alive = true
watch(
  () => auth.context,
  () => {
    if (!alive || loading.value || (savingPassword && auth.userId === verifiedOwner)) return
    version++
    flow?.cancel()
    flow = undefined
    password.value = ''
    confirmation.value = ''
    phone.value = ''
    step.value = 1
    busy.value = false
    error.value = '账号状态已变化，请重新打开页面'
  }
)
onLoad((query) => {
  mode.value = query?.mode === 'set' ? 'set' : 'reset'
  fromLogin.value = mode.value === 'set' && query?.from === 'login'
})
async function open() {
  const current = ++version
  active.value = true
  loading.value = true
  step.value = 1
  error.value = ''
  busy.value = false
  password.value = ''
  confirmation.value = ''
  passwordError.value = ''
  confirmationError.value = ''
  try {
    await hydrateSession()
    if (current !== version) return
    owner = mode.value === 'set' ? auth.userId : ''
    remember.value = Boolean(owner && rememberedLogin.preference()?.owner === owner)
    if (mode.value === 'set') {
      if (!owner) throw new ApiError('请重新登录后再管理账号', 401, 'ACCOUNT_IDENTITY_INVALID')
      phone.value = (await accountIdentity()).phone
    }
    if (current !== version) return
    flow = createAccountSecurityFlow(owner, () => alive && current === version)
    if (mode.value === 'set' && flow.useRecentVerification()) {
      verifiedOwner = owner
      step.value = 2
    }
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
  password.value = ''
  confirmation.value = ''
})
onUnload(() => {
  alive = false
  version++
  flow?.cancel()
  flow = undefined
  password.value = ''
  confirmation.value = ''
  phone.value = ''
  step.value = 1
})
async function send(number: string) {
  if (flow) await flow.send(number)
}
async function verify(number: string, token: string) {
  if (!flow) throw new ApiError('请重新打开页面后重试', 0, 'ACCOUNT_FLOW_EXPIRED')
  verifiedOwner = await flow.verify(number, token)
}
async function verified() {
  busy.value = false
  step.value = 2
  if (!active.value) return
  await nextTick()
  focused.value = 'new-password'
  await revealControl('new-password')
}
async function save() {
  if (busy.value || !flow) return
  let secret = password.value,
    repeated = confirmation.value
  // #ifdef H5
  secret = nativeFieldOf(passwordControl.value)?.value ?? secret
  repeated = nativeFieldOf(confirmationControl.value)?.value ?? repeated
  // #endif
  passwordError.value = passwordIssue(secret)
  confirmationError.value = secret === repeated ? '' : '两次输入的密码不一致'
  const invalid = passwordError.value
    ? 'new-password'
    : confirmationError.value
      ? 'confirm-password'
      : ''
  if (invalid) {
    focused.value = invalid
    await revealControl(invalid)
    return
  }
  busy.value = true
  error.value = ''
  savingPassword = true
  const current = version,
    identifier = phone.value
  const isCurrent = () => alive && current === version && auth.userId === verifiedOwner
  try {
    await flow.setPassword(secret)
    if (isCurrent()) {
      await saveLoginMemory(
        { identifier, password: secret, owner: verifiedOwner },
        remember.value,
        isCurrent
      )
    }
    if (isCurrent()) {
      password.value = ''
      confirmation.value = ''
      step.value = 3
    }
  } catch (e) {
    if (alive) {
      error.value = errorText(e)
      if (e instanceof ApiError && e.code === 'PHONE_PROOF_EXPIRED') {
        flow.cancel()
        flow = undefined
        step.value = 1
      }
    }
  } finally {
    savingPassword = false
    if (alive) busy.value = false
  }
}
function done() {
  if (mode.value === 'set' && getCurrentPages().length > 1) uni.navigateBack()
  else uni.reLaunch({ url: '/pages/home/index?tab=mine' })
}
</script>
<template>
  <FishingShell
    narrow
    :title="fromLogin ? '' : mode === 'set' ? '设置登录密码' : '找回密码'"
    back
    :confirm-back="async () => !busy"
  >
    <view class="fishing-content account-content">
      <text v-if="loading" class="caption" role="status">正在准备验证…</text>
      <template v-else-if="step === 3">
        <view class="account-heading" role="status"
          ><text class="account-title" role="heading" aria-level="1">密码已设置</text
          ><text class="account-description"
            >已登录当前账号。下次可使用手机号和新密码，也可继续用短信登录。</text
          ></view
        >
        <text class="caption">为保护账号，其他设备需要重新登录。</text>
        <MobileAction class="primary" @click="done">完成</MobileAction>
      </template>
      <template v-else>
        <view class="account-heading"
          ><text v-if="!fromLogin" class="account-step">{{
            step === 1 ? '1 / 2 · 确认本人' : '2 / 2 · 设置密码'
          }}</text
          ><text class="account-title" role="heading" aria-level="1">{{
            step === 1 ? '验证手机号' : fromLogin ? '设置登录密码' : '设置新密码'
          }}</text
          ><text class="account-description">{{
            step === 1
              ? '验证已绑定的手机号后，即可设置新密码。'
              : fromLogin
                ? '手机号已注册成功。设置密码后，下次可直接使用账号或手机号登录。'
                : '设置后可用手机号和密码登录，无需每次获取短信。'
          }}</text></view
        >
        <AccountPhoneVerification
          v-if="step === 1 && flow"
          v-model="phone"
          :readonly-phone="mode === 'set'"
          :send="send"
          :verify="verify"
          @verified="verified"
          @busy="busy = $event"
        />
        <view v-if="step === 2" class="account-form">
          <MobileField
            ref="passwordControl"
            v-model="password"
            field="new-password"
            label="新密码"
            placeholder="请输入新密码"
            hint="8–64 位，包含字母和数字"
            :maxlength="128"
            autocomplete="new-password"
            password
            allow-password-reveal
            :error="passwordError"
            :focus="focused === 'new-password'"
            :disabled="busy"
            @confirm="focused = 'confirm-password'"
            required
          />
          <MobileField
            ref="confirmationControl"
            v-model="confirmation"
            field="confirm-password"
            label="确认新密码"
            placeholder="再次输入新密码"
            :maxlength="128"
            autocomplete="new-password"
            password
            allow-password-reveal
            :error="confirmationError"
            :focus="focused === 'confirm-password'"
            :disabled="busy"
            @confirm="save"
            required
          />
          <MobileCheckbox
            v-model="remember"
            :aria-label="rememberLabel"
            :disabled="busy"
            checked-color="var(--lake)"
            unchecked-color="var(--reed)"
          ><text class="caption">{{ rememberLabel }}</text></MobileCheckbox>
          <MobileAction class="primary" :disabled="busy" @click="save">{{
            busy
              ? '正在保存…'
              : fromLogin
                ? '保存密码'
                : mode === 'set'
                  ? '保存新密码'
                  : '保存密码并登录'
          }}</MobileAction>
        </view>
        <text v-if="error" class="error" role="alert">{{ error }}</text>
        <MobileAction v-if="!flow" class="secondary" @click="open">重新验证</MobileAction>
        <text v-if="step === 1" class="caption">{{
          mode === 'set'
            ? '验证码仅用于确认本人身份。'
            : '仅用于验证已有账号。首次使用，请返回短信登录。'
        }}</text>
      </template>
    </view>
  </FishingShell>
</template>
