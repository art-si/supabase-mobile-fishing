<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import MobileField from '@mobile-core/components/MobileField.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import { revealControl, nativeFieldOf, type ElementTarget } from '@mobile-core/form-focus'
import { normalizePhone, errorText } from '@/domain/rules'
import { maskPhone } from '@/domain/account-security'
import { ApiError } from '@/services/http'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
const props = defineProps<{
  readonlyPhone?: boolean
  send: (phone: string) => Promise<void>
  verify: (phone: string, code: string) => Promise<void>
  submitLabel?: string
}>()
const phone = defineModel<string>({ default: '' })
const phoneControl = ref<ElementTarget>(), codeControl = ref<ElementTarget>()
const emit = defineEmits<{ verified: []; busy: [value: boolean] }>()
const code = ref(''),
  phoneError = ref(''),
  codeError = ref(''),
  error = ref('')
const activity = ref(''),
  sentTo = ref(''),
  until = ref(0),
  verifyUntil = ref(0),
  now = ref(Date.now()),
  focused = ref('')
const busy = computed(() => Boolean(activity.value))
const remaining = computed(() => Math.max(0, Math.ceil((until.value - now.value) / 1000)))
const verifyRemaining = computed(() =>
  Math.max(0, Math.ceil((verifyUntil.value - now.value) / 1000))
)
let active = true
const timer = setInterval(() => {
  now.value = Date.now()
}, 1000)
onUnmounted(() => {
  active = false
  code.value = ''
  clearInterval(timer)
})
watch(phone, () => {
  code.value = ''
  phoneError.value = ''
  error.value = ''
  sentTo.value = ''
})
watch(code, () => {
  codeError.value = ''
  error.value = ''
})
async function focus(field: string) {
  focused.value = ''
  await nextTick()
  focused.value = field
  await revealControl(field)
}
function validate(visible: { phone: string; code: string }, withCode = false) {
  phoneError.value = ''
  codeError.value = ''
  error.value = ''
  try {
    normalizePhone(visible.phone)
  } catch {
    phoneError.value = '请输入正确的中国大陆手机号'
  }
  if (withCode && !/^\d{6}$/.test(visible.code.trim()))
    codeError.value = '请输入短信中的 6 位验证码'
  if (phoneError.value || codeError.value) {
    void focus(phoneError.value ? 'account-phone' : 'account-code')
    return false
  }
  return true
}
async function run(kind: 'send' | 'verify') {
  const visible = { phone: phone.value, code: code.value }
  // #ifdef H5
  visible.phone = nativeFieldOf(phoneControl.value)?.value ?? visible.phone
  visible.code = nativeFieldOf(codeControl.value)?.value ?? visible.code
  // #endif
  if (
    busy.value ||
    (kind === 'send' ? remaining.value : verifyRemaining.value) ||
    !validate(visible, kind === 'verify')
  )
    return
  activity.value = kind
  emit('busy', true)
  try {
    if (kind === 'send') {
      await props.send(visible.phone)
      if (!active) return
      sentTo.value = maskPhone(visible.phone)
      until.value = Date.now() + 60_000
      now.value = Date.now()
      void focus('account-code')
    } else {
      await props.verify(visible.phone, visible.code)
      if (active) {
        code.value = ''
        emit('verified')
      }
    }
  } catch (e) {
    if (
      !active ||
      (e instanceof ApiError && ['AUTH_CANCELLED', 'SESSION_CHANGED'].includes(e.code))
    )
      return
    if (e instanceof ApiError && e.status === 429) {
      const deadline = Date.now() + Math.max(1, e.retryAfter ?? 60) * 1000
      if (kind === 'send') until.value = deadline
      else verifyUntil.value = deadline
      now.value = Date.now()
    }
    if (e instanceof ApiError && ['otp_expired', 'invalid_credentials'].includes(e.code)) {
      codeError.value = '验证码错误或已过期，请重新获取'
      void focus('account-code')
    } else error.value = errorText(e)
  } finally {
    activity.value = ''
    if (active) emit('busy', false)
  }
}
</script>
<template>
  <view class="account-form">
    <view v-if="readonlyPhone" class="account-number">
      <text class="account-label">当前手机号</text
      ><text class="account-phone-value">{{ maskPhone(phone) }}</text>
    </view>
    <MobileField
      v-else
      ref="phoneControl"
      v-model="phone"
      field="account-phone"
      label="手机号码"
      inputmode="tel"
      autocomplete="tel"
      :maxlength="16"
      placeholder="中国大陆手机号"
      :error="phoneError"
      :focus="focused === 'account-phone'"
      :disabled="busy"
      required
    />
    <view class="account-code-block">
      <label class="account-label" for="account-code-input" @click="focus('account-code')"
        >短信验证码</label
      >
      <view class="account-code-row">
        <MobileField
          ref="codeControl"
          v-model="code"
          field="account-code"
          label="短信验证码"
          inputmode="numeric"
          autocomplete="one-time-code"
          :maxlength="6"
          placeholder="6 位验证码"
          :error="codeError"
          :focus="focused === 'account-code'"
          :disabled="busy"
          @confirm="run('verify')"
          required
        />
        <MobileAction
          class="secondary account-send"
          :disabled="busy || remaining > 0"
          @click="run('send')"
          >{{
            activity === 'send' ? '正在发送…' : remaining ? `${remaining} 秒后重发` : '获取验证码'
          }}</MobileAction
        >
      </view>
    </view>
    <text v-if="sentTo" class="caption" role="status"
      >验证码已发送至 {{ sentTo }}，请留意短信。</text
    >
    <text v-if="error" class="error" role="alert">{{ error }}</text>
    <MobileAction class="primary" :disabled="busy || verifyRemaining > 0" @click="run('verify')">{{
      activity === 'verify'
        ? '正在验证…'
        : verifyRemaining
          ? `${verifyRemaining} 秒后重试`
          : submitLabel || '验证并继续'
    }}</MobileAction>
  </view>
</template>
