<script setup lang="ts">
import MobileAvatar from '@mobile-core/components/MobileAvatar.vue'
import type { DiscussionPerson } from '@/domain/models'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
withDefaults(defineProps<{ person?: DiscussionPerson | null; size?: number; decorative?: boolean }>(), { size: 36, decorative: true })
</script>
<template>
  <view class="discussion-avatar">
    <MobileAvatar :src="person?.avatar?.url" :name="person?.nickname || '钓友'" :size="size" :decorative="decorative" />
  </view>
</template>
<style scoped>
.discussion-avatar { display: inline-flex; flex: none; align-self: start; }
.discussion-avatar :deep(.mobile-avatar) { border-radius: 5px; color: var(--discussion-name); font-size: .95rem; }
</style>
