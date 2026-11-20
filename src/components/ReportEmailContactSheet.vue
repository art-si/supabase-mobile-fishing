<script setup lang="ts">
import { getCurrentInstance, nextTick, reactive, ref, watch } from 'vue'
import { onHide } from '@dcloudio/uni-app'
import MobileBottomSheet from '@mobile-core/components/MobileBottomSheet.vue'
import MobileField from '@mobile-core/components/MobileField.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import { revealControl } from '@mobile-core/form-focus'
import { useAuthStore } from '@/stores/auth'
import { validateReportEmailContact, type ReportEmailContact } from '@/domain/report-email'
import { readReportEmailContact, saveReportEmailContact, clearReportEmailContact } from '@/services/report-email-contact'

const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ saved: [contact: ReportEmailContact]; cleared: [] }>()
const auth = useAuthStore(), form = reactive<ReportEmailContact>({ name: '', email: '' })
const errors = ref<Partial<Record<keyof ReportEmailContact, string>>>({}), error = ref(''), hasSaved = ref(false)
const nativeScope = getCurrentInstance()?.proxy
let openedOwner = ''
watch(visible, open => {
  if (!open) return
  if (!auth.signedIn) { visible.value = false; auth.requireLogin(); return }
  openedOwner = auth.userId
  errors.value = {}; error.value = ''
  Object.assign(form, { name: '', email: '' }); hasSaved.value = false
  try {
    const saved = readReportEmailContact(openedOwner)
    if (saved) { Object.assign(form, saved); hasSaved.value = true }
  } catch { error.value = '暂时无法读取本机邮箱资料，可以重新填写并保存。' }
})
watch(() => [form.name, form.email], () => {
  const next = validateReportEmailContact(form)
  for (const field of ['name', 'email'] as const) if (!next[field]) delete errors.value[field]
})
watch(() => auth.context, () => { visible.value = false; openedOwner = ''; Object.assign(form, { name: '', email: '' }) })
onHide(() => { visible.value = false })
async function save() {
  if (!openedOwner || openedOwner !== auth.userId || !auth.signedIn) { visible.value = false; return }
  errors.value = validateReportEmailContact(form); error.value = ''
  const invalid = errors.value.name ? 'report-email-name' : errors.value.email ? 'report-email-address' : ''
  if (invalid) { await nextTick(); await revealControl(invalid, { nativeScope }); return }
  try {
    const contact = saveReportEmailContact(openedOwner, form)
    visible.value = false; emit('saved', contact)
  } catch { error.value = '邮箱资料未能保存，请检查设备空间后重试。输入的内容已保留。' }
}
function clear() {
  if (!openedOwner || openedOwner !== auth.userId) return
  try {
    clearReportEmailContact(openedOwner); Object.assign(form, { name: '', email: '' }); hasSaved.value = false
    visible.value = false; emit('cleared')
  } catch { error.value = '暂时无法清除邮箱资料，请重试。' }
}
</script>
<template>
  <MobileBottomSheet v-model="visible" title="我的邮箱资料" close-label="关闭邮箱资料" initial-focus="#report-email-name-input">
    <view class="stack fishing-sheet-content">
      <text class="caption">用于官方邮件中的联系与回信，仅保存在当前账号的本机，退出登录时清除，不公开到个人主页。</text>
      <MobileField v-model="form.name" field="report-email-name" label="称呼" :maxlength="40" :error="errors.name" autocomplete="name" required />
      <MobileField v-model="form.email" field="report-email-address" label="联系邮箱" :maxlength="254" :error="errors.email" inputmode="email" autocomplete="email" placeholder="name@example.com" required />
      <text class="caption">请先在设备的邮件应用中登录自己的邮箱。发件账号由邮件应用选择；这里填写的邮箱用于联系回信。</text>
      <text v-if="error" class="error" role="alert">{{ error }}</text>
      <MobileAction v-if="hasSaved" class="text-action" @click="clear">清除本机邮箱资料</MobileAction>
    </view>
    <template #footer>
      <view class="mobile-action-group">
        <MobileAction class="secondary" @click="visible = false">取消</MobileAction>
        <MobileAction class="primary" @click="save">保存邮箱资料</MobileAction>
      </view>
    </template>
  </MobileBottomSheet>
</template>
