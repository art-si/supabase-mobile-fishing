<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileConfirmDialog from '@mobile-core/components/MobileConfirmDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { useMutation } from '@/composables/useMutation'
import { write } from '@/services/repository'

defineOptions({ options: { styleIsolation: 'apply-shared' } })
const props = defineProps<{ id: string; owner: string; compact?: boolean }>()
const auth = useAuthStore(),
  mutation = useMutation(),
  confirm = ref(false)
let version = 0
watch(
  () => [props.id, props.owner, auth.context],
  () => {
    version++
    confirm.value = false
    mutation.error.value = ''
  }
)
onUnmounted(() => {
  version++
})
async function remove() {
  if (props.owner !== auth.userId || mutation.busy.value) return
  const current = version,
    target = props.id
  await mutation.run(async () => {
    await write('delete_content', { type: 'spot', id: target })
    if (current !== version) return
    uni.showToast({ title: '已删除钓位', icon: 'none' })
    uni.reLaunch({ url: '/pages/home/index?tab=spots' })
  })
}
</script>
<template>
  <view v-if="owner === auth.userId" class="stack stack--tight spot-delete">
    <MobileAction
      class="text-action spot-delete__action"
      :disabled="mutation.busy.value"
      @click="confirm = true"
      ><MobileIcon name="close" :size="18" />{{ compact ? '删除' : '删除钓位' }}</MobileAction
    >
    <text v-if="mutation.error.value" class="error" role="alert">{{ mutation.error.value }}</text>
    <MobileConfirmDialog
      v-model="confirm"
      title="删除这个钓位？"
      message="删除后将从钓位列表和收藏中移除。"
      confirm-text="删除钓位"
      cancel-text="保留钓位"
      destructive
      @confirm="remove"
    />
  </view>
</template>
<style scoped>
.spot-delete__action.mobile-action {
  color: var(--danger);
}
</style>
