<script setup lang="ts">
import MobileAction from '@mobile-core/components/MobileAction.vue'

import DiscussionAvatar from './DiscussionAvatar.vue'
import FishingPhotos from './FishingPhotos.vue'
import { relativeTime } from '@/domain/rules'
import type { DiscussionPerson, Media } from '@/domain/models'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
defineProps<{
  item: { author: DiscussionPerson | null; created_at: string; body: string; media?: Media[];
    reply_to_id?: string | null; reply_to?: { author: DiscussionPerson | null } | null }
  replyLabel: string; mediaLabel: string; disabled?: boolean; canReply?: boolean
}>()
defineEmits<{ reply: [] }>()
</script>
<template>
  <view class="discussion-comment post-comments__item">
    <DiscussionAvatar :person="item.author" />
    <view class="discussion-comment__content">
      <view class="discussion-comment__header">
        <view class="discussion-comment__identity">
          <text class="discussion-comment__name">{{ item.author?.nickname || '钓友' }}</text>
          <text class="discussion-comment__time">{{ relativeTime(item.created_at) }}</text>
        </view>
        <view v-if="$slots.management" class="discussion-comment__management"><slot name="management" /></view>
      </view>
      <MobileAction v-if="canReply" class="discussion-comment__message" :aria-label="replyLabel" :disabled="disabled" @click="$emit('reply')">
        <text class="discussion-comment__text"><text v-if="item.reply_to_id" class="post-comments__quote"><template v-if="item.reply_to">回复<text class="discussion-comment__mention">{{ item.reply_to.author?.nickname || '钓友' }}</text>：</template><text v-else class="discussion-comment__time">原评论已删除或不可见 · </text></text>{{ item.body || (item.media?.length ? (item.media.some(asset => asset.kind === 'video') ? '[附件]' : '[图片]') : '') }}</text>
      </MobileAction>
      <text v-else-if="item.body" class="discussion-comment__text">{{ item.body }}</text>
      <FishingPhotos v-if="item.media?.length" :media="item.media" :label="mediaLabel" compact />
      <slot />
    </view>
  </view>
</template>
<style scoped>
.discussion-comment { display: grid; grid-template-columns: 36px minmax(0,1fr); gap: 10px; align-items: start; padding-block: 8px; }
.discussion-comment__content { min-width: 0; }
.discussion-comment__header { display: flex; align-items: center; gap: 8px; min-width: 0; }
.discussion-comment__identity { display: flex; flex: 1; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; min-width: 0; }
.discussion-comment__management { flex: none; align-self: flex-start; }
.discussion-comment__name, .discussion-comment__mention { color: var(--discussion-name); font-weight: 600; }
.discussion-comment__name { flex: 1 1 5em; min-width: 0; overflow-wrap: anywhere; font-size: var(--fishing-name-size); line-height: 1.5; }
.discussion-comment__time { flex: none; max-width: 100%; overflow-wrap: anywhere; font-size: var(--fishing-caption-size); line-height: 1.5; color: var(--reed); font-weight: 400; }
.discussion-comment__message.mobile-action { display: block; text-align: left; width: 100%; min-width: 0; min-height: var(--fishing-target); padding: 2px 0 4px; border: 0; border-radius: 3px; background: transparent; }
.discussion-comment__text { display: block; color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--fishing-text-size); font-weight: 400; line-height: 1.5; }
.discussion-comment__content :deep(.mobile-media-gallery) { margin-top: 4px; }
.discussion-comment__content :deep(.mobile-media-gallery__grid) { max-width: 290px; }
.discussion-comment__header :deep(.text-action) { min-width: var(--fishing-target); min-height: var(--fishing-target); padding: 0; font-size: var(--fishing-caption-size); color: var(--reed); }
</style>
