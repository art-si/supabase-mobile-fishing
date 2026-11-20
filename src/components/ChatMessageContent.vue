<script setup lang="ts">
import { activateActionKey, preventActionKey } from '@mobile-core/action-keyboard'
import FishingPhotos from './FishingPhotos.vue'
import type { Message } from '@/domain/models'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
const props = defineProps<{ message: Message; mine?: boolean }>()
function openCard() {
  const card = props.message.card
  if (card) uni.navigateTo({ url: `/pages/${card.type}/detail?id=${encodeURIComponent(card.id)}` })
}
</script>
<template>
  <view v-if="message.kind === 'image'" class="chat-image">
    <FishingPhotos
      v-if="message.media?.length"
      :media="message.media"
      label="聊天照片"
      full
      compact
    />
    <image
      v-else-if="message.localPhoto && message.delivery"
      class="chat-photo-pending"
      :src="message.localPhoto"
      mode="aspectFit"
      aria-label="待发送照片"
    />
    <text v-else class="caption">图片暂不可用，请重新读取聊天</text>
  </view>
  <button
    v-else-if="message.kind === 'post' || message.kind === 'spot'"
    class="mobile-action chat-card stack stack--tight"
    role="button"
    :tabindex="message.card ? 0 : -1"
    :aria-disabled="!message.card || undefined"
    hover-class="mobile-action--pressed"
    :class="{ 'chat-content--mine': mine }"
    :disabled="!message.card"
    :aria-label="
      message.card
        ? `查看${message.kind === 'post' ? '鱼情' : '钓位'}：${message.card.title}`
        : '分享内容已不可用'
    "
    @click="openCard"
    @keydown="preventActionKey"
    @keyup="activateActionKey($event, openCard)"
  >
    <text class="caption">{{ message.kind === 'post' ? '鱼情分享' : '钓位分享' }}</text>
    <text class="name">{{ message.card?.title || '内容已不可用' }}</text>
    <text class="caption">{{ message.card?.detail || '内容已撤回或可见范围改变' }}</text>
  </button>
  <text v-else class="chat-bubble" :class="{ 'chat-content--mine': mine }" user-select>{{
    message.body
  }}</text>
</template>
<style scoped>
.chat-bubble,
.chat-card.mobile-action,
.chat-image {
  box-sizing: border-box;
  max-width: 88%;
  padding: 12px 16px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 18px 18px 18px 4px;
  color: var(--ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.6;
  font-size: max(16px, 1rem);
}
.chat-card.mobile-action {
  width: min(320px, 88%);
  align-items: stretch;
  text-align: left;
}
.chat-card .name {
  font-size: max(16px, 1rem);
}
.caption {
  font-size: max(14px, 0.875rem);
}
.chat-card.mobile-action[aria-disabled='true'] {
  opacity: 1;
}
.chat-image {
  width: min(280px, 88%);
  padding: 6px;
}
.chat-photo-pending {
  width: 100%;
  height: 200px;
  display: block;
}
.chat-bubble.chat-content--mine,
.chat-card.mobile-action.chat-content--mine {
  background: var(--lake-soft);
  border-color: var(--lake-soft);
  border-radius: 18px 18px 4px 18px;
}
</style>
