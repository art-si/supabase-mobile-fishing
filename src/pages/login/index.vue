<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { onHide, onShow } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import FishMark from '@/components/FishMark.vue'
import MobileField from '@mobile-core/components/MobileField.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import { revealControl, nativeFieldOf, type ElementTarget } from '@mobile-core/form-focus'
import { useAuthStore } from '@/stores/auth'
import { config, isDemo, backendReady } from '@/config'
import { errorText, normalizePhone } from '@/domain/rules'
import { ApiError } from '@/services/http'
import { operatorPhoneLogin, operatorEntryAvailable } from '@/services/phone-login'
import { LEGAL_CONTACT } from '@/domain/legal'
import { passwordLogin } from '@/services/account-security'
import { normalizeLoginIdentifier } from '@/domain/account-security'
import {
  rememberedLogin,
  rememberLoginLabel,
  displayLoginIdentifier
} from '@/services/login-memory'
import { sessionNotice } from '@/services/session'
const initialMemory = isDemo ? null : rememberedLogin.preference()
const remember = ref(Boolean(initialMemory)),
  restoringMemory = ref(false),
  memoryError = ref('')
const passwordFieldVersion = ref(0)
const passwordMode = ref(Boolean(initialMemory)),
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
const canSendSms = computed(() => backendReady && config.phoneAuth && !config.captcha)
const operatorEntry = computed(() => operatorEntryAvailable())
const hasOnlineLogin = computed(() => canSendSms.value || operatorEntry.value)
const smsSelected = ref(Boolean(initialMemory))
const showSms = computed(() => canSendSms.value && (!operatorEntry.value || smsSelected.value))
const contactOpen = ref(false)
const contactFeedback = ref('')
const activity = ref<'' | 'send' | 'login' | 'other'>('')
const busy = computed(() => Boolean(activity.value) || restoringMemory.value)
const error = ref('')
const phoneError = ref('')
const codeError = ref('')
const consentError = ref('')
const focusedField = ref('')
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
  if (isDemo || !remember.value || !passwordMode.value || activity.value) return
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
      passwordError.value = e.message
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
  if (busy.value || remaining.value || !canSendSms.value) return
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
async function login() {
  if (busy.value || verifyRemaining.value || !canSendSms.value) return
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
    try {
      if (passwordMode.value && remember.value) {
        const saved = await rememberedLogin.save(
          { identifier: normalized.phone, password: normalized.password, owner: auth.userId },
          () => active && started === pageVersion && auth.context === signedInScope
        )
        if (saved.saved && !saved.passwordSaved && rememberedLogin.canSavePassword())
          sessionNotice.value = '已记住账号；密码可通过系统密码管理器保存和填充。'
      } else if (passwordMode.value) await rememberedLogin.forget()
      else await rememberedLogin.forgetOtherOwners(auth.userId)
    } catch {
      if (auth.context === signedInScope) sessionNotice.value = '本次已登录，设备未能记住登录信息。'
    }
    password.value = ''
    if (active && started === pageVersion && auth.context === signedInScope) done()
  })
}
async function demo() {
  await run('other', async () => {
    auth.enterDemo()
    done()
  })
}
async function native() {
  if (!consent()) return
  await run('other', async () => {
    await operatorPhoneLogin({ consent: agreed.value, isActive: () => active })
    if (active) done()
  })
}
function switchLoginMethod(sms: boolean) {
  if (busy.value) return
  smsSelected.value = sms
  error.value = ''
  consentError.value = ''
}
function switchPassword() {
  if (busy.value) return
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
function copyContact(channel: 'wechat' | 'qq') {
  contactFeedback.value = ''
  uni.setClipboardData({
    data: LEGAL_CONTACT[channel],
    showToast: false,
    success: () => {
      contactFeedback.value = channel === 'wechat' ? '微信号已复制' : 'QQ号已复制'
    },
    fail: () => {
      contactFeedback.value = '未能复制，请长按号码手动复制'
    }
  })
}
</script>
<template>
  <view class="login-page">
    <FishingShell title="" back>
      <view class="fishing-content login-content">
        <view class="login-brand">
          <FishMark :size="48" />
          <text class="login-brand-name">钓友集</text>
        </view>

        <view v-if="isDemo" class="login-main">
          <view class="login-heading-group">
            <text class="login-title" role="heading" aria-level="1">本机体验</text>
            <text class="login-description">体验记录与浏览，不注册线上账号。</text>
          </view>
          <view class="login-actions">
            <MobileAction class="primary" :disabled="busy" @click="demo">进入本机体验</MobileAction>
            <text class="caption">体验内容仅保存在这台设备，不发送短信。</text>
          </view>
          <text v-if="error" class="error" role="alert">{{ error }}</text>
        </view>

        <view v-else-if="!hasOnlineLogin" class="login-main login-unavailable">
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
              showSms ? (passwordMode ? '密码登录' : '手机号登录') : '使用本机号码登录'
            }}</text>
            <text class="login-description">{{
              showSms
                ? passwordMode
                  ? '使用钓友号或手机号和登录密码。'
                  : '首次验证自动注册，已有账号直接登录。'
                : '授权后验证本机号码，首次登录自动注册。'
            }}</text>
          </view>

          <view class="login-form-stack" :class="{ 'login-form-stack--password': passwordMode }">
            <view v-if="showSms" class="login-fields">
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
                :disabled="busy"
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
                    :disabled="busy"
                    :error="codeError"
                    :focus="focusedField === 'code'"
                    @confirm="login"
                    required
                  />
                  <MobileAction
                    class="secondary login-send"
                    :disabled="busy || remaining > 0"
                    @click="send"
                    >{{
                      activity === 'send'
                        ? '正在发送…'
                        : remaining
                          ? `${remaining} 秒后重发`
                          : sentTo
                            ? '重新获取'
                            : '获取验证码'
                    }}</MobileAction
                  >
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
                  placeholder="请输入登录密码"
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
                  <MobileAction
                    class="login-choice login-remember"
                    role="checkbox"
                    :aria-label="rememberLoginLabel()"
                    :aria-checked="remember"
                    :disabled="busy"
                    @click="toggleRemember"
                  >
                    <view class="login-checkbox-component" aria-hidden="true"
                      ><wd-checkbox
                        :model-value="remember"
                        type="circle"
                        :readonly="true"
                        checked-color="var(--lake)"
                        unchecked-color="var(--reed)"
                        custom-style="--wot-checkbox-icon-size:22px;pointer-events:none;"
                    /></view>
                    <text class="caption login-choice-label">{{ rememberLoginLabel() }}</text>
                  </MobileAction>
                  <MobileAction
                    class="text-action login-forgot"
                    :disabled="busy"
                    @click="uni.navigateTo({ url: '/pages/account/password?mode=reset' })"
                    >忘记密码</MobileAction
                  >
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
                <MobileAction
                  id="login-consent"
                  class="login-choice login-consent"
                  role="checkbox"
                  :aria-checked="agreed"
                  :aria-describedby="consentError ? 'consent-error' : undefined"
                  :aria-invalid="Boolean(consentError)"
                  aria-label="同意用户协议与隐私说明"
                  :disabled="busy"
                  @click="agreed = !agreed"
                >
                  <view class="login-checkbox-component" aria-hidden="true">
                    <wd-checkbox
                      :model-value="agreed"
                      type="circle"
                      :readonly="true"
                      checked-color="var(--lake)"
                      unchecked-color="var(--reed)"
                      custom-style="--wot-checkbox-icon-size:22px;pointer-events:none;"
                    />
                  </view>
                  <text class="caption login-consent-label">我已阅读并同意</text>
                </MobileAction>
                <view class="login-consent-copy">
                  <MobileAction
                    class="text-action"
                    :disabled="busy"
                    @click="uni.navigateTo({ url: '/pages/settings/legal?type=terms' })"
                    >用户协议</MobileAction
                  >
                  <MobileAction
                    class="text-action"
                    :disabled="busy"
                    @click="uni.navigateTo({ url: '/pages/settings/legal?type=privacy' })"
                    >隐私说明</MobileAction
                  >
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
              v-if="showSms"
              class="primary"
              :disabled="busy || verifyRemaining > 0"
              @click="login"
              >{{
                activity === 'login'
                  ? '正在登录…'
                  : verifyRemaining
                    ? `${verifyRemaining} 秒后重试`
                    : passwordMode
                      ? '登录'
                      : '登录 / 注册'
              }}</MobileAction
            >
            <text v-if="showSms" class="caption login-privacy-note"
              >手机号仅用于登录，不公开展示</text
            >
            <MobileAction
              v-if="showSms"
              class="text-action login-switch"
              :disabled="busy"
              @click="switchPassword"
              >{{ passwordMode ? '使用短信验证码登录' : '使用密码登录' }}</MobileAction
            >
            <MobileAction v-else class="primary" :disabled="busy" @click="native">{{
              activity === 'other' ? '正在验证…' : '本机号码一键登录'
            }}</MobileAction>
            <MobileAction
              v-if="operatorEntry && canSendSms"
              class="text-action login-switch"
              :disabled="busy"
              @click="switchLoginMethod(!showSms)"
              >{{ showSms ? '使用本机号码登录' : '改用短信验证码' }}</MobileAction
            >
          </view>
        </view>

        <view class="login-support">
          <view class="login-support-actions">
            <MobileAction
              v-if="isDemo || hasOnlineLogin"
              class="text-action"
              :disabled="busy"
              @click="done"
              >先逛逛</MobileAction
            >
            <MobileAction
              class="text-action"
              :aria-expanded="contactOpen"
              aria-controls="login-contact"
              @click="contactOpen = !contactOpen"
              >联系客服</MobileAction
            >
          </view>
          <view v-if="contactOpen" id="login-contact" class="login-contact">
            <text class="body-strong">运营者：{{ LEGAL_CONTACT.operator }}</text>
            <view class="login-contact-row">
              <text class="caption" selectable>微信：{{ LEGAL_CONTACT.wechat }}</text>
              <MobileAction
                class="text-action"
                aria-label="复制运营者微信号"
                @click="copyContact('wechat')"
                >复制微信号</MobileAction
              >
            </view>
            <view class="login-contact-row">
              <text class="caption" selectable>QQ：{{ LEGAL_CONTACT.qq }}</text>
              <MobileAction
                class="text-action"
                aria-label="复制运营者QQ号"
                @click="copyContact('qq')"
                >复制QQ号</MobileAction
              >
            </view>
            <text class="caption login-contact-feedback" role="status" aria-live="polite">{{
              contactFeedback
            }}</text>
          </view>
          <view
            v-if="isDemo || !hasOnlineLogin"
            class="login-legal-links login-legal-links--standalone"
          >
            <MobileAction
              class="text-action"
              @click="uni.navigateTo({ url: '/pages/settings/legal?type=terms' })"
              >用户协议</MobileAction
            >
            <MobileAction
              class="text-action"
              @click="uni.navigateTo({ url: '/pages/settings/legal?type=privacy' })"
              >隐私说明</MobileAction
            >
          </view>
        </view>
      </view>
    </FishingShell>
  </view>
</template>

<style scoped>
.login-content {
  --tms-control-font-size: max(18px, 1.125rem);
  --tms-control-height: max(56px, 3.5rem);
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 480px;
  margin-inline: auto;
  padding: 28px 24px 32px;
  gap: 36px;
}
.login-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}
.login-brand-name {
  color: var(--ink);
  font-size: max(20px, 1.25rem);
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
  gap: 28px;
}
.login-heading-group {
  gap: 10px;
}
.login-title {
  color: var(--ink);
  font-size: max(30px, 1.875rem);
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: -0.025em;
  overflow-wrap: anywhere;
}
.login-description {
  color: var(--reed);
  font-size: max(16px, 1rem);
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.login-fields {
  --tms-line: var(--reed);
  gap: 24px;
}
.login-fields :deep(.mobile-field) {
  gap: 10px;
}
.login-fields :deep(.mobile-field__control) {
  background: var(--paper);
  border-radius: 14px;
  padding-inline: 16px;
  font-size: max(18px, 1.125rem);
}
.login-fields :deep(.mobile-field__input-wrap--secret .mobile-field__control) {
  padding-inline-end: 56px;
}
.login-forgot {
  padding-inline: 0;
  margin-inline-start: auto;
}
.login-form-stack {
  display: flex;
  flex-direction: column;
  gap: 28px;
  min-width: 0;
}
.login-form-stack--password {
  gap: 8px;
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
.login-fields :deep(.mobile-field__control:focus-within) {
  border-color: var(--lake);
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
  gap: 10px;
}
.login-code-label {
  color: var(--ink);
  font-size: max(14px, 0.875rem);
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
  min-height: max(56px, 3.5rem);
  margin-top: 0;
  padding-inline: 12px;
  border-radius: 14px;
  background: var(--lake-soft);
  font-weight: 600;
}
.login-actions {
  gap: 12px;
}
.login-actions :deep(.login-switch) {
  align-self: center;
  min-inline-size: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.login-actions :deep(.primary) {
  min-height: max(56px, 3.5rem);
  border-radius: 14px;
  font-weight: 650;
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
.login-choice {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  flex: 0 1 auto;
  min-width: 48px;
  min-height: 48px;
  padding: 0;
  background: transparent;
}
.login-checkbox-component {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  pointer-events: none;
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
.login-consent-label,
.login-choice-label,
.login-consent-copy :deep(.text-action) {
  display: inline-flex;
  align-items: center;
  min-height: 48px;
  padding: 0;
  font-size: max(14px, 0.875rem);
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
.login-contact {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border-radius: 16px;
  background: var(--paper);
  min-width: 0;
}
.login-contact-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0 8px;
}
.login-contact-feedback {
  min-height: 1.5em;
}
.login-content :deep(.mobile-action) {
  white-space: normal;
  overflow-wrap: anywhere;
}
.login-content :deep(.primary),
.login-content :deep(.secondary) {
  font-size: max(16px, 1rem);
}
.login-content .caption,
.login-content :deep(.text-action) {
  font-size: max(14px, 0.875rem);
}
.login-content .error,
.login-content :deep(.mobile-field__error) {
  font-size: max(13px, 0.8125rem);
}
@media (max-width: 359px) {
  .login-content {
    padding-inline: 20px;
  }
}
@media (max-height: 500px) {
  .login-content {
    padding-top: 8px;
    gap: 24px;
  }
}
</style>
