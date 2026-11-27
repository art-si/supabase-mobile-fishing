<script setup lang="ts">
import { nextTick, onScopeDispose, ref, watch } from 'vue'
import { onHide } from '@dcloudio/uni-app'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileBottomSheet from '@mobile-core/components/MobileBottomSheet.vue'
import MobileField from '@mobile-core/components/MobileField.vue'
import { useAuthStore } from '@/stores/auth'
import { contentReports } from '@/services/content-reports'
import { errorText } from '@/domain/rules'
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
const props = defineProps<{
  id: string
  type: 'post' | 'spot' | 'comment'
  owner: string
  hideTrigger?: boolean
}>()
const auth = useAuthStore(),
  open = ref(false),
  reason = ref(''),
  busy = ref(false),
  error = ref(''),
  fieldError = ref(''),
  focus = ref(false),
  notice = ref('')
let version = 0
function clear() {
  version++
  open.value = false
  reason.value = ''
  busy.value = false
  error.value = ''
  fieldError.value = ''
  notice.value = ''
  focus.value = false
}
watch(() => [props.id, props.type, props.owner, auth.context], clear, { flush: 'sync' })
watch(reason, (value) => {
  if (value.trim()) fieldError.value = ''
})
onHide(clear)
onScopeDispose(clear)
function prepare() {
  if (props.owner !== auth.userId && auth.requireLogin()) open.value = true
}
defineExpose({ prepare })
async function submit() {
  if (busy.value) return
  fieldError.value = ''
  if (!reason.value.trim()) {
    fieldError.value = '请说明具体问题，方便审核员核查'
    focus.value = false
    await nextTick()
    focus.value = true
    return
  }
  const current = version
  busy.value = true
  error.value = ''
  try {
    const result = await contentReports<{ duplicate: boolean }>('submit', {
      id: props.id,
      type: props.type,
      reason: reason.value.trim()
    })
    if (current !== version) return
    open.value = false
    reason.value = ''
    notice.value = result.duplicate
      ? '你已提交过这条内容，可在我的社区举报查看进度。'
      : '举报已提交，可在我的社区举报查看进度。'
    uni.showToast({
      title: result.duplicate ? '已提交过此举报' : '举报已提交',
      icon: result.duplicate ? 'none' : 'success'
    })
  } catch (e) {
    if (current === version) error.value = errorText(e)
  } finally {
    if (current === version) busy.value = false
  }
}
</script>
<template>
  <view v-if="owner !== auth.userId" class="stack stack--tight">
    <MobileAction v-if="!hideTrigger" class="text-action" @click="prepare">{{
      type === 'spot' ? '信息失效 / 提交纠错' : type === 'comment' ? '举报评论' : '举报这条内容'
    }}</MobileAction>
    <template v-if="notice">
      <text class="caption" role="status">{{ notice }}</text>
      <MobileAction
        class="text-action"
        @click="uni.navigateTo({ url: '/pages/content-report/index' })"
        >查看社区举报记录</MobileAction
      >
    </template>
    <MobileBottomSheet
      v-model="open"
      :title="type === 'spot' ? '钓位纠错' : type === 'comment' ? '举报评论' : '举报内容'"
      close-label="关闭举报表单"
      :busy="busy"
    >
      <view class="stack fishing-sheet-content">
        <text class="caption"
          >仅向社区审核员提交，不是向政府部门报案。请勿填写手机号等私人信息。</text
        >
        <MobileField
          v-model="reason"
          :field="`content-report-reason-${type}-${id}`"
          label="问题说明"
          multiline
          :maxlength="500"
          :error="fieldError"
          :focus="focus"
          required
          show-count
          :placeholder="
            type === 'comment'
              ? '例如广告骚扰、人身攻击，请说明具体问题'
              : '例如信息不实、广告骚扰，或钓位开放情况有误'
          "
        />
        <text v-if="error" class="error" role="alert">{{ error }}</text>
        <MobileAction class="primary" :disabled="busy" @click="submit">{{
          busy ? '正在提交…' : '提交举报'
        }}</MobileAction>
      </view>
    </MobileBottomSheet>
  </view>
</template>
