<script setup lang="ts">
defineOptions({ options: { styleIsolation: 'apply-shared' } })
import MobileAction from '@mobile-core/components/MobileAction.vue'
import { activateActionKey, preventActionKey } from '@mobile-core/action-keyboard'
import MobileAvatar from '@mobile-core/components/MobileAvatar.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import FishFacts from './FishFacts.vue'
import FishingPhotos from './FishingPhotos.vue'
import FishingPlaceLink from './FishingPlaceLink.vue'
import type { Post } from '@/domain/models'
import { audienceLabels, relativeTime } from '@/domain/rules'
import { postCaption } from '@/domain/composition'
const props = defineProps<{ post: Post; busy?: boolean; full?: boolean }>()
defineEmits<{ react: [kind: 'like' | 'bookmark']; open: [] }>()
function person() {
  uni.navigateTo({ url: `/pages/people/detail?id=${props.post.author.id}` })
}
</script>
<template>
  <view class="panel post-card">
    <view class="row">
      <MobileAction :aria-label="`查看${post.author.nickname}的主页`" @click="person"
        ><MobileAvatar :src="post.author.avatar?.url" :name="post.author.nickname"
      /></MobileAction>
      <view class="grow stack stack--tight"
        ><text class="name">{{ post.author.nickname }}</text
        ><text class="caption"
          >{{ relativeTime(post.created_at)
          }}<template v-if="post.author.city"> · {{ post.author.city }}</template></text
        ></view
      >
      <text class="badge">{{ post.kind === 'catch' ? '渔获' : '心得' }}</text>
    </view>
    <text v-if="full && post.title.trim()" class="heading">{{ post.title }}</text>
    <text v-if="full && post.body.trim()" class="body">{{ post.body }}</text>
    <button
      v-else-if="!full && (post.title.trim() || post.body.trim())"
      class="mobile-action post-content"
      role="button"
      :tabindex="0"
      hover-class="mobile-action--pressed"
      :aria-label="`${post.body.trim() ? '阅读全文' : '阅读'}：${postCaption(post)}`"
      @click="$emit('open')"
      @keydown="preventActionKey"
      @keyup="activateActionKey($event, () => $emit('open'))"
    >
      <text v-if="post.title.trim()" class="heading">{{ post.title }}</text>
      <text v-if="post.body.trim()" class="body post-card__summary">{{ post.body }}</text>
    </button>
    <FishingPhotos
      v-if="post.media.length"
      :media="post.media"
      :label="`${postCaption(post)}的附件`"
      compact
    />
    <FishFacts
      v-if="post.kind === 'catch'"
      :species="post.species"
      :method="post.method"
      :bait="post.bait"
      :additives="post.additives"
      :weight="post.weight_kg"
      :count="post.count"
      :length="post.length_cm"
    />
    <text v-if="post.kind === 'experience' && post.topic" class="badge">{{ post.topic }}</text>
    <FishingPlaceLink
      v-if="post.location_label"
      :label="post.location_label"
      :longitude="post.location_longitude"
      :latitude="post.location_latitude"
    />
    <view v-if="post.audience !== 'public' || post.status === 'hidden'" class="row row--wrap">
      <text v-if="post.audience !== 'public'" class="badge">{{
        audienceLabels[post.audience]
      }}</text>
      <text v-if="post.status === 'hidden'" class="badge badge--warm">暂不可见</text>
    </view>
    <view class="post-actions">
      <MobileAction
        :aria-label="`${post.liked ? '取消点赞' : '点赞'}：${postCaption(post)}`"
        :aria-pressed="post.liked"
        :class="{ 'is-active': post.liked }"
        :disabled="busy"
        @click="$emit('react', 'like')"
        ><MobileIcon :name="post.liked ? 'like-fill' : 'like'" :size="18" /><text>{{
          post.like_count || '点赞'
        }}</text></MobileAction
      >
      <MobileAction :aria-label="`查看评论：${postCaption(post)}`" @click="$emit('open')"
        ><MobileIcon name="message" :size="18" /><text>{{
          post.comment_count || '评论'
        }}</text></MobileAction
      >
      <MobileAction
        :aria-label="`${post.saved ? '取消收藏' : '收藏'}：${postCaption(post)}`"
        :aria-pressed="post.saved"
        :class="{ 'is-active': post.saved }"
        :disabled="busy"
        @click="$emit('react', 'bookmark')"
        ><MobileIcon name="flag" :size="18" /><text>{{
          post.saved ? '已收藏' : '收藏'
        }}</text></MobileAction
      >
    </view>
    <slot name="management" />
  </view>
</template>
<style scoped>
.post-content.mobile-action {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 0;
}
.post-card > .badge {
  align-self: flex-start;
}
</style>
