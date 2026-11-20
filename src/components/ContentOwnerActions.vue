<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileConfirmDialog from '@mobile-core/components/MobileConfirmDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { useMutation } from '@/composables/useMutation'
import { read, write } from '@/services/repository'
import { createId } from '@/domain/rules'
import { editRoute, type EditSnapshot } from '@/domain/content-edit'
import { ApiError } from '@/services/http'
import type { Audience, ContentUpdateInfo, Payload } from '@/domain/models'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
const props = defineProps<{
  id: string
  type: 'post' | 'spot'
  owner: string
  audience: Audience
  revision?: number
  update?: ContentUpdateInfo | null
  compact?: boolean
}>()
const emit = defineEmits<{ changed: [] }>()
const auth = useAuthStore(),
  mutation = useMutation(),
  confirm = ref(false),
  conflict = ref(false),
  operation = ref<'withdraw_content' | 'discard_content_update'>('withdraw_content')
let generation = 0
let pending: Payload | undefined
onUnmounted(() => {
  generation++
})
watch(
  () => [
    props.id,
    props.type,
    props.owner,
    props.revision,
    props.audience,
    props.update,
    auth.context
  ],
  () => {
    generation++
    confirm.value = false
    conflict.value = false
    pending = undefined
    mutation.error.value = ''
  }
)
async function prepare(action: typeof operation.value) {
  if (!auth.requireLogin() || props.owner !== auth.userId || conflict.value) return
  if (action === 'discard_content_update' && !props.update) return
  if (action !== operation.value) pending = undefined
  operation.value = action
  const current = generation
  await mutation.run(async () => {
    if (!pending) {
      const snapshot = await read<EditSnapshot>('edit_content', { id: props.id, type: props.type })
      if (current !== generation) return
      if (props.type !== 'spot' && props.revision && props.revision !== snapshot.revision) {
        conflict.value = true
        throw new Error('这条记录已更新，请重新读取后再操作')
      }
      pending = {
        id: props.id,
        type: props.type,
        revision: snapshot.revision,
        request_id: createId()
      }
    }
    confirm.value = true
  })
}
async function submit() {
  if (!pending || props.owner !== auth.userId || conflict.value) return
  const current = generation,
    action = operation.value
  await mutation.run(async () => {
    try {
      await write(action, pending)
    } catch (e) {
      if (current === generation && e instanceof ApiError && e.code === 'EDIT_CONFLICT')
        conflict.value = true
      throw e
    }
    if (current !== generation) return
    pending = undefined
    uni.showToast({
      title: action === 'discard_content_update' ? '已取消这次修改' : '已改为仅自己可见',
      icon: 'none'
    })
    emit('changed')
  })
}
</script>
<template>
  <view
    v-if="owner === auth.userId"
    :class="['stack stack--tight', { 'content-owner-actions--compact': compact }]"
  >
    <view class="mobile-action-group">
      <MobileAction
        class="text-action"
        :disabled="mutation.busy.value"
        @click="uni.navigateTo({ url: editRoute(type, id) })"
        ><MobileIcon v-if="compact" name="document" :size="18" />{{
          compact ? '编辑' : type === 'spot' ? '编辑与分享设置' : '编辑这条鱼情'
        }}</MobileAction
      >
      <MobileAction
        v-if="type === 'spot' && update"
        class="text-action"
        :disabled="mutation.busy.value || conflict"
        @click="prepare('discard_content_update')"
        >取消这次修改</MobileAction
      >
      <MobileAction
        v-if="audience !== 'private'"
        class="text-action"
        :disabled="mutation.busy.value || conflict"
        @click="prepare('withdraw_content')"
        ><MobileIcon v-if="compact" name="back" :size="18" />{{
          compact ? '撤回' : '撤回分享'
        }}</MobileAction
      >
    </view>
    <text v-if="mutation.error.value" class="error" role="alert">{{ mutation.error.value }}</text>
    <MobileAction v-if="conflict" class="secondary" @click="emit('changed')"
      >重新读取记录</MobileAction
    >
    <MobileConfirmDialog
      v-model="confirm"
      :title="operation === 'discard_content_update' ? '取消这次修改？' : '改为仅自己可见？'"
      :message="
        operation === 'discard_content_update'
          ? '这会移除已提交的修改稿，保留当前展示版本。已收紧的分享范围和位置精度不会放宽；本机未保存的草稿不受影响。'
          : update
            ? '最新修改会保存为仅自己可见，其他钓友将不能继续访问这条分享。互动会保留，已下载或缓存的内容无法收回。'
            : '原记录、照片和互动会为你保留，其他钓友将不能继续访问。已经下载或缓存的内容无法收回。'
      "
      :confirm-text="operation === 'discard_content_update' ? '取消这次修改' : '撤回分享'"
      :cancel-text="operation === 'discard_content_update' ? '保留修改' : '继续分享'"
      :destructive="operation === 'discard_content_update'"
      @confirm="submit"
    />
  </view>
</template>
