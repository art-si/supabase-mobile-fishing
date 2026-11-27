<script setup lang="ts">
import MobileAction from '@mobile-core/components/MobileAction.vue'

import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { onHide, onShow } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import FishMark from '@/components/FishMark.vue'
import MobileField from '@mobile-core/components/MobileField.vue'
import MobileCheckbox from '@mobile-core/components/MobileCheckbox.vue'
import { revealControl, nativeFieldOf, type ElementTarget } from '@mobile-core/form-focus'
import { useAuthStore } from '@/stores/auth'
import { config, backendReady } from '@/config'
import { errorText, normalizePhone } from '@/domain/rules'
import { ApiError } from '@/services/http'
import { operatorPhoneLogin, operatorEntryAvailable } from '@/services/phone-login'
import { accountPasswordConfigured, passwordLogin } from '@/services/account-security'
import { normalizeLoginIdentifier } from '@/domain/account-security'
import {
  rememberedLogin,
  rememberLoginLabel,
  preferPasswordLogin,
  prefersPasswordLogin,
  saveLoginMemory,
  displayLoginIdentifier
} from '@/services/login-memory'
import { sessionNotice } from '@/services/session'
const canPasswordLogin = backendReady && !config.captcha
const rememberLabel = rememberLoginLabel()
const canSendSms = canPasswordLogin && config.phoneAuth
const initialMemory = canPasswordLogin ? rememberedLogin.preference() : null
const initialPasswordPreference = Boolean(initialMemory) || prefersPasswordLogin()
const remember = ref(Boolean(initialMemory)),
  restoringMemory = ref(false),
  memoryError = ref('')
const passwordFieldVersion = ref(0)
const passwordMode = ref(!canSendSms || initialPasswordPreference),
  password = ref(''),
  passwordError = ref('')
const phoneControl = ref<ElementTarget>(),
  codeControl = ref<ElementTarget>(),
  passwordControl = ref<ElementTarget>()
const auth = useAuthStore(),
  phone = ref(initialMemory ? displayLoginIdentifier(initialMemory.identifier) : ''),
  code = ref(''),
  agreed = ref(true),
  sentTo = ref(''),
  until = ref(0),
  now = ref(Date.now())
const operatorEntry = computed(() => operatorEntryAvailable())
const hasOnlineLogin = computed(() => canPasswordLogin || operatorEntry.value)
const credentialsSelected = ref(initialPasswordPreference)
const showCredentials = computed(
  () => canPasswordLogin && (!operatorEntry.value || credentialsSelected.value)
)
const activity = ref<'' | 'send' | 'login' | 'other'>('')
const busy = computed(() => Boolean(activity.value) || restoringMemory.value)
const error = ref('')
const phoneError = ref('')
const codeError = ref('')
const consentError = ref('')
const focusedField = ref('')
const phoneLoginScope = ref<number | null>(null)
const verifyUntil = ref(0)
const remaining = computed(() => Math.max(0, Math.ceil((until.value - now.value) / 1000)))
const verifyRemaining = computed(() =>
  Math.max(0, Math.ceil((verifyUntil.value - now.value) / 1000))
)
const sentMessage = computed(() => {
  if (!sentTo.value) return ''
  try {
    if (normalizePhone(phone.value) !== sentTo.value)
      return '手机号已修改，请填写新号码收到的验证码。'
  } catch {
    return ''
  }
  const number = sentTo.value.slice(3)
  return `验证码已发送至 ${number.slice(0, 3)} **** ${number.slice(-4)}，请留意短信。`
})
let active = true
let pageVersion = 0
let memoryVersion = 0
let restoredFor = '',
  restoredPassword = ''
async function restoreMemory() {
  if (!remember.value || !passwordMode.value || activity.value) return
  const preference = rememberedLogin.preference()
  if (!preference) return
  try {
    if (normalizeLoginIdentifier(phone.value) !== preference.identifier) return
  } catch {
    return
  }
  const current = ++memoryVersion
  restoringMemory.value = true
  try {
    const saved = await rememberedLogin.load()
    if (!active || current !== memoryVersion || !saved || !remember.value || !passwordMode.value)
      return
    if (normalizeLoginIdentifier(phone.value) !== saved.identifier) return
    password.value = saved.password
    restoredFor = saved.identifier
    restoredPassword = saved.password
  } finally {
    if (current === memoryVersion) restoringMemory.value = false
  }
}
async function toggleRemember() {
  if (busy.value) return
  remember.value = !remember.value
  memoryError.value = ''
  memoryVersion++
  if (!remember.value) {
    try {
      await rememberedLogin.forget()
    } catch {
      memoryError.value = '未能完全清除已记住的密码，请再次勾选后取消重试'
    }
  }
}
const timer = setInterval(() => (now.value = Date.now()), 1000)
onUnmounted(() => {
  active = false
  clearInterval(timer)
})
onShow(() => {
  active = true
  void restoreMemory()
})
onHide(() => {
  active = false
  pageVersion++
  memoryVersion++
  restoringMemory.value = false
  password.value = ''
  passwordFieldVersion.value++
  restoredFor = ''
  restoredPassword = ''
})
watch(password, () => {
  passwordError.value = ''
  error.value = ''
})
watch(phone, () => {
  phoneError.value = ''
  codeError.value = ''
  code.value = ''
  error.value = ''
  if (restoredFor) {
    let matches = false
    try {
      matches = normalizeLoginIdentifier(phone.value) === restoredFor
    } catch {
      /* user editing */
    }
    if (!matches) {
      let visiblePassword = password.value
      // #ifdef H5
      visiblePassword = nativeFieldOf(passwordControl.value)?.value ?? visiblePassword
      // #endif
      if (visiblePassword === restoredPassword) password.value = ''
      restoredFor = ''
      restoredPassword = ''
    }
  }
})
watch(code, () => {
  codeError.value = ''
  error.value = ''
})
watch(agreed, () => {
  consentError.value = ''
})
async function focusField(field: string) {
  focusedField.value = ''
  await nextTick()
  focusedField.value = field
  await revealControl(field)
}
function validate(withCode: boolean) {
  const visible = { phone: phone.value, code: code.value, password: password.value }
  // Read system/password-manager AutoFill before Uni's throttled model update.
  // #ifdef H5
  visible.phone = nativeFieldOf(phoneControl.value)?.value ?? visible.phone
  visible.code = nativeFieldOf(codeControl.value)?.value ?? visible.code
  visible.password = nativeFieldOf(passwordControl.value)?.value ?? visible.password
  // #endif
  phoneError.value = ''
  codeError.value = ''
  consentError.value = ''
  error.value = ''
  let normalized = ''
  try {
    normalized = passwordMode.value
      ? normalizeLoginIdentifier(visible.phone)
      : normalizePhone(visible.phone)
  } catch {
    phoneError.value = passwordMode.value
      ? '请输入正确的钓友号或中国大陆手机号'
      : visible.phone.trim()
        ? '请输入正确的中国大陆手机号'
        : '请输入手机号码'
  }
  passwordError.value = ''
  if (withCode && passwordMode.value && !visible.password) passwordError.value = '请输入登录密码'
  if (withCode && !passwordMode.value && !/^\d{6}$/.test(visible.code.trim()))
    codeError.value = '请输入短信中的 6 位验证码'
  if (!agreed.value) consentError.value = '请先阅读并同意用户协议与隐私说明'
  const invalid = phoneError.value
    ? 'phone'
    : passwordError.value
      ? 'login-password'
      : codeError.value
        ? 'code'
        : consentError.value
          ? 'login-consent'
          : ''
  if (invalid) {
    void focusField(invalid)
    return null
  }
  return { phone: normalized, code: visible.code.trim(), password: visible.password }
}
function consent() {
  if (agreed.value) return true
  consentError.value = '请先阅读并同意用户协议与隐私说明'
  void focusField('login-consent')
  return false
}
async function run(kind: 'send' | 'login' | 'other', task: () => Promise<void>) {
  if (busy.value) return
  activity.value = kind
  error.value = ''
  try {
    await task()
  } catch (e) {
    if (
      !active ||
      (e instanceof ApiError && ['SESSION_CHANGED', 'AUTH_CANCELLED'].includes(e.code))
    )
      return
    if (passwordMode.value && e instanceof ApiError && e.code === 'PASSWORD_INCORRECT') {
      passwordError.value = canSendSms ? e.message : '账号、手机号或密码不正确，请重新填写'
      void focusField('login-password')
      return
    }
    if (e instanceof ApiError && e.status === 429) {
      const deadline = Date.now() + Math.max(1, e.retryAfter ?? 60) * 1000
      if (kind === 'send') until.value = deadline
      if (kind === 'login') verifyUntil.value = deadline
      now.value = Date.now()
    }
    if (
      kind === 'login' &&
      e instanceof ApiError &&
      ['otp_expired', 'invalid_credentials'].includes(e.code)
    ) {
      codeError.value = e.message
      void focusField('code')
    } else error.value = errorText(e)
  } finally {
    activity.value = ''
  }
}
function done() {
  if (getCurrentPages().length > 1) uni.navigateBack()
  else uni.reLaunch({ url: '/pages/home/index' })
}
async function send() {
  if (
    busy.value ||
    phoneLoginScope.value !== null ||
    remaining.value ||
    !canSendSms ||
    passwordMode.value
  )
    return
  const normalized = validate(false)
  if (!normalized) return
  await run('send', async () => {
    await auth.sendCode(normalized.phone)
    if (!active) return
    sentTo.value = normalized.phone
    until.value = Date.now() + 60000
    now.value = Date.now()
    void focusField('code')
  })
}
async function finishPhoneLogin(started: number) {
  const scope = phoneLoginScope.value
  if (scope === null || auth.context !== scope)
    throw new ApiError('账号状态已变化，请重新登录', 409, 'SESSION_CHANGED')
  const configured = await accountPasswordConfigured()
  if (!active || started !== pageVersion || auth.context !== scope) return
  if (configured) {
    try {
      preferPasswordLogin()
    } catch {
      sessionNotice.value = '已登录，设备暂时无法记住登录方式。'
    }
    done()
  } else uni.redirectTo({ url: '/pages/account/password?mode=set&from=login' })
}
async function login() {
  if (busy.value || verifyRemaining.value || !showCredentials.value) return
  if (phoneLoginScope.value !== null) {
    if (auth.context === phoneLoginScope.value) {
      await run('login', () => finishPhoneLogin(pageVersion))
      return
    }
    phoneLoginScope.value = null
  }
  const normalized = validate(true)
  if (!normalized) return
  const token = normalized.code
  const started = pageVersion
  await run('login', async () => {
    // The server validates the OTP. A page refresh or lost send response must not block it.
    if (passwordMode.value)
      await passwordLogin(
        normalized.phone,
        normalized.password,
        () => active && started === pageVersion
      )
    else
      await auth.verify(normalized.phone, token, {
        isActive: () => active && started === pageVersion
      })
    const signedInScope = auth.context
    if (passwordMode.value) {
      await saveLoginMemory(
        { identifier: normalized.phone, password: normalized.password, owner: auth.userId },
        remember.value,
        () => active && started === pageVersion && auth.context === signedInScope
      )
    } else {
      try {
        await rememberedLogin.forgetOtherOwners(auth.userId)
      } catch {
        if (auth.context === signedInScope)
          sessionNotice.value = '本次已登录，设备未能记住登录信息。'
      }
    }
    password.value = ''
    if (active && started === pageVersion && auth.context === signedInScope) {
      if (passwordMode.value) done()
      else {
        phoneLoginScope.value = signedInScope
        code.value = ''
        await finishPhoneLogin(started)
      }
    }
  })
}
async function native() {
  if (!consent()) return
  await run('other', async () => {
    await operatorPhoneLogin({ consent: agreed.value, isActive: () => active })
    if (active) done()
  })
}
function switchLoginMethod(credentials: boolean) {
  if (busy.value) return
  credentialsSelected.value = credentials
  error.value = ''
  consentError.value = ''
}
function switchPassword() {
  if (busy.value || phoneLoginScope.value !== null || !canSendSms) return
  let identifier = phone.value
  // #ifdef H5
  identifier = nativeFieldOf(phoneControl.value)?.value ?? identifier
  // #endif
  passwordMode.value = !passwordMode.value
  phone.value = !passwordMode.value && /^dy/i.test(identifier.trim()) ? '' : identifier
  password.value = ''
  code.value = ''
  passwordError.value = ''
  phoneError.value = ''
  codeError.value = ''
  error.value = ''
  if (passwordMode.value) void restoreMemory()
}
</script>
<template>
  <view class="login-page">
    <FishingShell title="" back narrow without-location hide-session-notice>
      <view class="fishing-content login-content">
        <view class="login-brand">
          <FishMark :size="36" />
          <text class="login-brand-name">钓友集</text>
        </view>

        <view v-if="!hasOnlineLogin" class="login-main login-unavailable">
          <view class="login-heading-group" role="status">
            <text class="login-title" role="heading" aria-level="1">登录暂未开放</text>
            <text class="login-description"
              >可以先浏览钓友圈。登录开放后，即可保存记录、与钓友交流。</text
            >
          </view>
          <MobileAction class="primary" @click="done">先逛逛</MobileAction>
        </view>

        <view v-else class="login-main">
          <view class="login-heading-group">
            <text class="login-title" role="heading" aria-level="1">{{
              showCredentials ? (passwordMode ? '密码登录' : '手机号登录') : '使用本机号码登录'
            }}</text>
            <text class="login-description">{{
              sessionNotice && !auth.signedIn ? sessionNotice : showCredentials
                ? passwordMode
                  ? '使用钓友号或手机号和登录密码。'
                  : '首次验证自动注册，已有账号直接登录。'
                : '授权后验证本机号码，首次登录自动注册。'
            }}</text>
          </view>

          <view class="login-form-stack">
            <view v-if="showCredentials" class="login-fields">
              <MobileField
                :key="passwordMode ? 'password-identifier' : 'sms-phone'"
                ref="phoneControl"
                v-model="phone"
                field="phone"
                :label="passwordMode ? '账号或手机号' : '手机号码'"
                :inputmode="passwordMode ? 'text' : 'tel'"
                :autocomplete="passwordMode ? 'username' : 'tel'"
                :maxlength="passwordMode ? 32 : 16"
                :placeholder="passwordMode ? '钓友号或手机号' : '中国大陆手机号'"
                :disabled="busy || phoneLoginScope !== null"
                :error="phoneError"
                :focus="focusedField === 'phone'"
                required
              />
              <view v-if="!passwordMode" class="login-code-block">
                <label class="login-code-label" for="code-input" @click="focusField('code')"
                  >短信验证码</label
                >
                <view class="login-code-row">
                  <MobileField
                    ref="codeControl"
                    v-model="code"
                    field="code"
                    label="短信验证码"
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    :maxlength="6"
                    placeholder="6 位验证码"
                    :disabled="busy || phoneLoginScope !== null"
                    :error="codeError"
                    :focus="focusedField === 'code'"
                    @confirm="login"
                    required
                  />
                  <MobileAction
                    class="secondary login-send"
                    :disabled="busy || phoneLoginScope !== null || remaining > 0"
                    @click="send"
                    >{{
                      activity === 'send'
                        ? '正在发送…'
                        : remaining
                          ? `${remaining} 秒后重发`
                          : sentTo
                            ? '重新获取'
                            : '获取验证码'
                    }}</MobileAction>
                </view>
              </view>
              <view v-if="passwordMode" class="login-password-block">
                <MobileField
                  :key="passwordFieldVersion"
                  ref="passwordControl"
                  v-model="password"
                  field="login-password"
                  label="登录密码"
                  autocomplete="current-password"
                  placeholder="请输入密码"
                  :maxlength="128"
                  password
                  allow-password-reveal
                  :disabled="busy"
                  :error="passwordError"
                  :focus="focusedField === 'login-password'"
                  @confirm="login"
                  required
                />
                <view class="login-password-options">
                  <MobileCheckbox
                    class="login-remember"
                    :aria-label="rememberLabel"
                    :model-value="remember"
                    checked-color="var(--lake)"
                    unchecked-color="var(--reed)"
                    :disabled="busy"
                    @update:model-value="toggleRemember"
                  >
                    <text class="caption login-choice-label">{{ rememberLabel }}</text>
                  </MobileCheckbox>
                  <MobileAction
                    v-if="canSendSms"
                    class="text-action login-forgot"
                    :disabled="busy"
                    @click="uni.navigateTo({ url: '/pages/account/password?mode=reset' })"
                    >忘记密码</MobileAction>
                </view>
                <text v-if="restoringMemory" class="caption" role="status"
                  >正在读取已记住的登录信息…</text
                >
                <text v-if="memoryError" class="error" role="alert">{{ memoryError }}</text>
              </view>
              <text
                v-if="sentMessage && !passwordMode"
                class="caption"
                role="status"
                aria-live="polite"
                >{{ sentMessage }}</text
              >
            </view>

            <view class="login-agreement">
              <view class="login-consent-row">
                <MobileCheckbox
                  id="login-consent"
                  class="login-consent"
                  v-model="agreed"
                  :aria-describedby="consentError ? 'consent-error' : undefined"
                  :aria-invalid="Boolean(consentError)"
                  aria-label="同意用户协议与隐私说明"
                  checked-color="var(--lake)"
                  unchecked-color="var(--reed)"
                  :disabled="busy"
                >
                  <text class="caption login-consent-label">我已阅读并同意</text>
                </MobileCheckbox>
                <view class="login-consent-copy">
                  <MobileAction
                    class="text-action"
                    :disabled="busy"
                    @click="uni.navigateTo({ url: '/pages/settings/legal?type=terms' })"
                    >用户协议</MobileAction>
                  <MobileAction
                    class="text-action"
                    :disabled="busy"
                    @click="uni.navigateTo({ url: '/pages/settings/legal?type=privacy' })"
                    >隐私说明</MobileAction>
                </view>
              </view>
              <text v-if="consentError" id="consent-error" class="error" role="alert">{{
                consentError
              }}</text>
            </view>
          </view>

          <view class="login-actions">
            <text v-if="error" class="error" role="alert">{{ error }}</text>
            <MobileAction
              v-if="showCredentials"
              class="primary"
              :disabled="busy || verifyRemaining > 0"
              :loading="activity === 'login'"
              :aria-busy="activity === 'login' || undefined"
              @click="login"
              >{{
                activity === 'login'
                  ? '正在登录…'
                  : verifyRemaining
                    ? `${verifyRemaining} 秒后重试`
                    : phoneLoginScope !== null
                      ? '继续登录'
                      : passwordMode
                        ? '登录'
                        : '登录 / 注册'
              }}</MobileAction>
            <text v-if="showCredentials" class="caption login-privacy-note">{{
              canSendSms ? '手机号仅用于登录，不公开展示' : '短信注册和找回密码暂不可用。'
            }}</text>
            <MobileAction
              v-if="showCredentials && canSendSms && phoneLoginScope === null"
              class="text-action login-switch"
              :disabled="busy"
              @click="switchPassword"
              >{{ passwordMode ? '使用短信验证码登录' : '使用密码登录' }}</MobileAction>
            <MobileAction
              v-if="!showCredentials"
              class="primary"
              :disabled="busy"
              @click="native"
              >{{ activity === 'other' ? '正在验证…' : '本机号码一键登录' }}</MobileAction>
            <MobileAction
              v-if="operatorEntry && canPasswordLogin"
              class="text-action login-switch"
              :disabled="busy"
              @click="switchLoginMethod(!showCredentials)"
              >{{
                showCredentials
                  ? '使用本机号码登录'
                  : canSendSms
                    ? '改用短信验证码'
                    : '使用密码登录'
              }}</MobileAction>
          </view>
        </view>

        <view class="login-support">
          <view class="login-support-actions">
            <MobileAction
              v-if="hasOnlineLogin"
              class="text-action"
              :disabled="busy"
              @click="done"
              >先逛逛</MobileAction>
            <MobileAction
              class="text-action"
              @click="uni.navigateTo({ url: '/pages/contact/index' })"
              >联系客服</MobileAction>
          </view>
          <view
            v-if="!hasOnlineLogin"
            class="login-legal-links login-legal-links--standalone"
          >
            <MobileAction
              class="text-action"
              @click="uni.navigateTo({ url: '/pages/settings/legal?type=terms' })"
              >用户协议</MobileAction>
            <MobileAction
              class="text-action"
              @click="uni.navigateTo({ url: '/pages/settings/legal?type=privacy' })"
              >隐私说明</MobileAction>
          </view>
        </view>
      </view>
    </FishingShell>
  </view>
</template>

<style scoped>
.login-content {
  --tms-control-radius: var(--fishing-auth-control-radius);
  display: flex;
  flex-direction: column;
  width: 100%;
  padding-block: 12px 20px;
  gap: 16px;
}
.login-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.login-brand-name {
  color: var(--ink);
  font-size: var(--fishing-heading-size);
  font-weight: 700;
  line-height: 1.4;
  letter-spacing: 0.02em;
}
.login-main,
.login-fields,
.login-heading-group,
.login-actions,
.login-agreement,
.login-support {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.login-main {
  gap: 16px;
}
.login-heading-group {
  gap: 4px;
}
.login-title {
  color: var(--ink);
  font-size: var(--mobile-header-title-size);
  font-weight: var(--fishing-title-weight);
  line-height: 1.3;
  letter-spacing: -0.025em;
  overflow-wrap: anywhere;
}
.login-description {
  color: var(--reed);
  font-size: var(--fishing-text-size);
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.login-fields {
  --tms-line: var(--reed);
  gap: 14px;
}
.login-fields :deep(.mobile-field) {
  gap: 6px;
}
.login-fields :deep(.mobile-field__control) {
  background: var(--paper);
  font-size: var(--fishing-input-size);
}
.login-password-options .login-forgot {
  min-height: var(--fishing-target);
  padding-inline: 0;
  margin-inline-start: auto;
}
.login-form-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.login-password-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.login-password-options {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0 12px;
}
.login-fields :deep(.mobile-field__required) {
  display: none;
}
.login-fields :deep(.mobile-field__control:not(.mobile-field__control--error):focus-within) {
  outline-offset: -1px;
}
.login-fields :deep(#code-input) {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.16em;
}
.login-fields :deep(#code-input::placeholder) {
  letter-spacing: normal;
}
.login-code-row {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 12px;
  min-width: 0;
}
.login-code-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.login-code-label {
  color: var(--ink);
  font-size: var(--fishing-label-size);
  font-weight: 650;
  line-height: 1.4;
}
.login-code-row :deep(.mobile-field__label) {
  display: none;
}
.login-code-row > :deep(.mobile-field) {
  flex: 3 1 max(128px, 8rem);
}
.login-send {
  flex: 1 1 max(120px, 7.5rem);
  margin-top: 0;
  padding-inline: 12px;
  background: var(--lake-soft);
  font-weight: 600;
}
.login-actions {
  gap: 8px;
}
.login-actions :deep(.login-switch) {
  align-self: center;
  min-inline-size: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.login-privacy-note {
  text-align: center;
}
.login-agreement {
  gap: 4px;
}
.login-consent-row {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 0 8px;
  min-width: 0;
}
.login-consent-copy {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  min-width: 0;
  min-height: 48px;
  gap: 0 8px;
}
.login-legal-links,
.login-support-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0 8px;
  min-width: 0;
}
.login-consent-copy :deep(.text-action) {
  display: inline-flex;
  align-items: center;
  min-height: 48px;
  padding: 0;
  font-size: var(--fishing-label-size);
  font-weight: 400;
  line-height: 1.5;
}
.login-legal-links .text-action {
  padding-inline: 0;
}
.login-support {
  gap: 16px;
}
.login-support-actions,
.login-legal-links--standalone {
  justify-content: center;
}
.login-content :deep(.mobile-action) {
  white-space: normal;
  overflow-wrap: anywhere;
}
.login-content :deep(.primary),
.login-content :deep(.secondary) {
  border-radius: var(--tms-control-radius);
  font-size: var(--fishing-action-size);
}
.login-content .caption,
.login-content :deep(.text-action) {
  font-size: var(--fishing-label-size);
}
.login-content .error,
.login-content :deep(.mobile-field__error) {
  font-size: var(--fishing-caption-size);
}
@media (max-height: 500px) {
  .login-content {
    padding-top: 8px;
  }
}
</style>
