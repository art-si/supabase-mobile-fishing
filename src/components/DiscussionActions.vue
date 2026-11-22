<script setup lang="ts">
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
defineProps<{ title: string; liked?: boolean; likes?: number; comments?: number; saved?: boolean; busy?: boolean }>()
defineEmits<{ react: [kind: 'like' | 'bookmark']; comments: [] }>()
</script>
<template>
  <view class="post-actions">
    <MobileAction :aria-label="`${liked ? '取消点赞' : '点赞'}：${title}`" :aria-pressed="!!liked"
      :class="{ 'is-active': liked }" :disabled="busy" @click="$emit('react', 'like')">
      <view class="discussion-action__icon" aria-hidden="true"><wd-icon :name="liked ? 'heart-fill' : 'heart'" size="20px" /></view><text>{{ likes || '点赞' }}</text>
    </MobileAction>
    <MobileAction :aria-label="`查看评论：${title}`" @click="$emit('comments')">
      <view class="discussion-action__icon"><MobileIcon name="message" :size="19" /></view><text>{{ comments || '评论' }}</text>
    </MobileAction>
    <MobileAction :aria-label="`${saved ? '取消收藏' : '收藏'}：${title}`" :aria-pressed="!!saved"
      :class="{ 'is-active': saved }" :disabled="busy" @click="$emit('react', 'bookmark')">
      <view class="discussion-action__icon"><MobileIcon name="flag" :size="18" /></view><text>{{ saved ? '已收藏' : '收藏' }}</text>
    </MobileAction>
  </view>
</template>
<style scoped>
.discussion-action__icon { display: inline-flex; flex: 0 0 20px; width: 20px; height: 20px; align-items: center; justify-content: center; line-height: 1; }
.post-actions .mobile-action { font-variant-numeric: tabular-nums; line-height: 1.35; }
</style>
