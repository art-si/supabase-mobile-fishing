<script setup lang="ts">
import MobileAction from '@mobile-core/components/MobileAction.vue'
defineOptions({ options: { styleIsolation: 'apply-shared' } })

import { ref, watch } from 'vue'
import { onHide } from '@dcloudio/uni-app'
import { useLongPressAction } from '@mobile-core/long-press-action'
import MobileAvatar from '@mobile-core/components/MobileAvatar.vue'
import DiscussionActions from './DiscussionActions.vue'
import FishFacts from './FishFacts.vue'
import FishingPhotos from './FishingPhotos.vue'
import FishingPlaceLink from './FishingPlaceLink.vue'
import ContentDeleteAction from './ContentDeleteAction.vue'
import { useAuthStore } from '@/stores/auth'
import type { Post } from '@/domain/models'
import { audienceLabels, relativeTime } from '@/domain/rules'
import { postCaption } from '@/domain/composition'
const props = defineProps<{ post: Post; busy?: boolean; full?: boolean }>()
const emit = defineEmits<{ react: [kind: 'like' | 'bookmark']; open: []; deleted: [id: string] }>()
const auth = useAuthStore(), card = ref<unknown>(), deletion = ref<InstanceType<typeof ContentDeleteAction>>()
const longPress = useLongPressAction(() => deletion.value?.open(), () => Boolean(auth.userId) && props.post.author.id === auth.userId && !props.busy, card)
watch(() => [props.post.id, auth.context], longPress.reset, { flush: 'sync' })
onHide(longPress.reset)
function person() {
  if (!longPress.allowClick()) return
  uni.navigateTo({ url: `/pages/people/detail?id=${props.post.author.id}` })
}
function open() { if (longPress.allowClick()) emit('open') }
function react(kind: 'like' | 'bookmark') { if (longPress.allowClick()) emit('react', kind) }
</script>
<template>
  <view ref="card" class="panel post-card" @longpress="longPress.hold" @touchend="longPress.release" @touchcancel="longPress.release">
    <view class="row post-card__header">
      <MobileAction class="post-card__author"
        :aria-label="`查看${post.author.nickname}的主页`"
        @click="person"
        ><MobileAvatar :src="post.author.avatar?.url" :name="post.author.nickname"
      /></MobileAction>
      <view class="grow stack post-card__identity"
        ><text class="name">{{ post.author.nickname }}</text
        ><text class="caption"
          >{{ relativeTime(post.created_at)
          }}<text v-if="post.author.city" class="post-card__city"> · {{ post.author.city }}</text></text
        ></view
      >
      <text class="badge">{{ post.kind === 'catch' ? '渔获' : '心得' }}</text>
    </view>
    <text v-if="full && post.title.trim()" class="heading">{{ post.title }}</text>
    <text v-if="full && post.body.trim()" class="body">{{ post.body }}</text>
    <MobileAction
      v-else-if="!full && (post.title.trim() || post.body.trim())"
      class="post-content"
      :aria-label="`${post.body.trim() ? '阅读全文' : '阅读'}：${postCaption(post)}`"
      @click="open"
    >
      <text v-if="post.title.trim()" class="heading">{{ post.title }}</text>
      <text v-if="post.body.trim()" class="body post-card__summary">{{ post.body }}</text>
    </MobileAction>
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
    <DiscussionActions :title="postCaption(post)" :likes="post.like_count" :comments="post.comment_count"
      :liked="post.liked" :saved="post.saved" :busy="busy" @react="react" @comments="open" />
    <slot name="management" />
    <ContentDeleteAction ref="deletion" :id="post.id" type="post" :owner="post.author.id" :title="postCaption(post)" compact :show-button="false" :disabled="busy" @deleted="$emit('deleted',$event)" />
  </view>
</template>
<style scoped>
.post-card__header {
  align-items: flex-start;
}
.post-card__author.mobile-action {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: var(--fishing-target);
  min-height: var(--fishing-target);
  border-radius: 50%;
}
.post-card__identity {
  gap: 4px;
}
.post-card__header > .badge {
  flex: none;
  white-space: nowrap;
}
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
.post-card__city {
  display: inline-block;
  max-width: 100%;
  overflow-wrap: anywhere;
}
</style>
