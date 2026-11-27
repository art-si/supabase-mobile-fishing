<script setup lang="ts">
import MobileAction from '@mobile-core/components/MobileAction.vue'
import { computed, onUnmounted, ref, watch } from 'vue'
import { onHide, onShow } from '@dcloudio/uni-app'

import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileConfirmDialog from '@mobile-core/components/MobileConfirmDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { useMutation } from '@/composables/useMutation'
import { write } from '@/services/repository'
import { notifyContentDeleted, type ContentDeletion } from '@/services/content-deletion'

defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
const props = withDefaults(defineProps<{ id: string; type: ContentDeletion['type']; owner: string; title?: string; compact?: boolean; disabled?: boolean; showButton?: boolean }>(), { showButton: true })
const emit = defineEmits<{ deleted: [id: string] }>()
const auth = useAuthStore(), mutation = useMutation(), confirm = ref(false)
const owned = computed(() => Boolean(props.owner) && props.owner === auth.userId)
const label = computed(() => ({ post: '鱼情', spot: '钓位', trip: '日志' })[props.type])
const confirmationTitle = computed(() => props.type === 'spot' ? '删除这个钓位？' : `删除这条${label.value}？`)
const prompt = computed(() => props.type === 'post' ? '删除后将从钓友圈、个人记录和收藏中移除，无法恢复。' : props.type === 'spot' ? '删除后将从钓位列表和收藏中移除，无法恢复。' : '删除后无法恢复。')
let version = 0, active = true
let pending: { id: string; owner: string; type: ContentDeletion['type']; scope: number; version: number } | undefined
function close() { version++; confirm.value = false; pending = undefined; mutation.error.value = '' }
watch(() => [props.id, props.type, props.owner, auth.context], close, { flush: 'sync' })
onHide(() => { active = false; close() })
onShow(() => { active = true })
onUnmounted(() => { active = false; version++; pending = undefined })
function open() {
  if (!owned.value || !props.id || props.disabled || mutation.busy.value || !active || confirm.value) return
  mutation.error.value = ''
  pending = { id: props.id, owner: props.owner, type: props.type, scope: auth.context, version }
  confirm.value = true
}
async function remove() {
  const target = pending
  if (!target || !active || !owned.value || props.disabled || mutation.busy.value || target.id !== props.id || target.owner !== props.owner || target.scope !== auth.context || target.version !== version) return
  await mutation.run(async () => {
    await write('delete_content', { type: target.type, id: target.id })
    if (target.scope !== auth.context) return
    // Even a page hidden during the write must invalidate other lists in this account.
    notifyContentDeleted({ type: target.type, id: target.id, scope: target.scope })
    if (!active || target.version !== version) return
    pending = undefined; confirm.value = false
    uni.showToast({ title: `已删除${label.value}`, icon: 'none' })
    emit('deleted', target.id)
  })
}
defineExpose({ open })
</script>
<template>
  <view v-if="owned" class="content-delete stack stack--tight" data-longpress-ignore>
    <MobileAction v-if="showButton !== false" class="text-action content-delete__action"
      :aria-label="`删除${label}${title ? `：${title}` : ''}`" :disabled="disabled || mutation.busy.value"
      @click="open">
      <MobileIcon name="close" :size="18" />{{ compact ? '删除' : `删除${label}` }}
    </MobileAction>
    <MobileConfirmDialog v-model="confirm" :title="confirmationTitle" :message="mutation.error.value || prompt"
      :confirm-text="`删除${label}`" :cancel-text="`保留${label}`" destructive keep-open-on-confirm
      :busy="mutation.busy.value" @confirm="remove" @cancel="close" />
  </view>
</template>
<style scoped>
.content-delete__action.mobile-action { color: var(--danger); }
</style>
