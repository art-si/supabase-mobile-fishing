<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import { useAuthStore } from '@/stores/auth'
import { moderation } from '@/services/moderation'
import type { ContentStatus, ContentUpdateInfo } from '@/domain/models'
import { reviewLabels, type ReviewType, type OwnReviewStatus } from '@/domain/moderation'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
const props = defineProps<{
  id: string
  type: ReviewType
  status?: ContentStatus
  owner: string
  update?: ContentUpdateInfo | null
}>()
const auth = useAuthStore(),
  reason = ref(''),
  failed = ref(false),
  loading = ref(false)
const baseShown = computed(
  () =>
    props.owner === auth.userId &&
    props.status &&
    ['pending', 'rejected', 'hidden'].includes(props.status)
)
const updateShown = computed(
  () => props.owner === auth.userId && props.status === 'published' && Boolean(props.update)
)
let version = 0
async function load() {
  const current = ++version
  reason.value = ''
  failed.value = false
  loading.value = false
  if (!baseShown.value) return
  loading.value = true
  try {
    const result = await moderation<OwnReviewStatus>('own_status', {
      type: props.type,
      id: props.id
    })
    if (current === version && result.status === props.status) reason.value = result.reason
  } catch {
    if (current === version) failed.value = true
  } finally {
    if (current === version) loading.value = false
  }
}
watch(
  () => [props.id, props.type, props.status, props.owner, auth.context],
  () => {
    void load()
  },
  { immediate: true }
)
onUnmounted(() => {
  version++
})
</script>
<template>
  <view v-if="baseShown" class="notice stack stack--tight" role="status">
    <text class="name">{{ reviewLabels[status!] }}</text>
    <text class="caption">{{
      reason ||
      (status === 'pending' ? '通过后，按你选择的分享范围展示。' : '这条内容暂不向其他钓友展示。')
    }}</text>
    <MobileAction v-if="failed" class="text-action" :disabled="loading" @click="load"
      >重新读取处理说明</MobileAction
    >
  </view>
  <view v-else-if="updateShown" class="notice stack stack--tight" role="status">
    <text class="name">{{
      update?.status === 'pending' ? '修改待审核' : '这次修改未通过审核'
    }}</text>
    <text v-if="update?.status === 'rejected' && update.reason" class="caption">{{
      update.reason
    }}</text>
    <text class="caption">{{
      update?.status === 'pending'
        ? '通过后替换当前版本，其他钓友暂时看到的仍是当前版本。'
        : '当前版本仍按当前分享范围展示。你可以继续编辑，也可以取消这次修改。'
    }}</text>
  </view>
</template>
