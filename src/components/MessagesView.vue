<script setup lang="ts">
defineOptions({ options: { styleIsolation: 'apply-shared' } })
import { computed, watch } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileAvatar from '@mobile-core/components/MobileAvatar.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileEmptyState from '@/components/FishingEmptyState.vue'
import MobileLoadingStatus from '@/components/FishingLoadingStatus.vue'
import { useResource } from '@/composables/useResource'
import { useAuthStore } from '@/stores/auth'
import { read } from '@/services/repository'
import { relativeTime } from '@/domain/rules'
import type { SocialSnapshot } from '@/domain/models'
import { notificationCount } from '@/domain/notifications'
const auth = useAuthStore()
const empty: SocialSnapshot = { friends: [], requests: [], conversations: [] }
const { data, loading, error, load } = useResource(
  () => (auth.signedIn ? read<SocialSnapshot>('social') : Promise.resolve(empty)),
  empty
)
const unreadNotices = computed(
  () => (data.value.notifications?.interaction || 0) + (data.value.notifications?.system || 0)
)
watch(
  () => auth.userId,
  () => void load(),
  { immediate: true }
)
defineExpose({ refresh: load })
</script>
<template>
  <view class="stack">
    <view class="row"
      ><MobileAction class="text-action" @click="uni.navigateTo({ url: '/pages/people/index' })"
        >找钓友</MobileAction
      ></view
    >
    <MobileEmptyState
      v-if="!auth.signedIn"
      icon="message"
      title="让鱼情有来有往"
      description="登录后可以添加好友，交流钓法与出钓安排。"
      ><MobileAction class="primary" @click="auth.requireLogin()"
        >手机号登录</MobileAction
      ></MobileEmptyState
    >
    <template v-else>
      <MobileAction
        class="panel list-row"
        @click="uni.navigateTo({ url: '/pages/people/index?tab=requests' })"
        ><MobileIcon name="user" :size="24" /><view class="grow"
          ><text class="name">好友申请</text
          ><text class="muted" style="display: block">{{
            data.requests.length ? `${data.requests.length} 条待处理申请` : '先认识，再成为好友'
          }}</text></view
        ><MobileIcon name="chevron" :size="16"
      /></MobileAction>
      <MobileAction
        class="panel list-row"
        @click="uni.navigateTo({ url: '/pages/notifications/index' })"
      >
        <MobileIcon name="message" :size="24" />
        <view class="grow"
          ><text class="name">互动与系统通知</text
          ><text class="muted" style="display: block">{{
            unreadNotices
              ? `${notificationCount(unreadNotices)} 条未读通知`
              : '点赞、回复与处理结果'
          }}</text></view
        >
        <MobileIcon name="chevron" :size="16" />
      </MobileAction>
      <MobileLoadError v-if="error" :message="error" @retry="load" />
      <MobileLoadingStatus v-if="loading" label="正在读取会话…" />
      <view class="panel" v-if="data.conversations.length">
        <MobileAction
          v-for="conversation in data.conversations"
          :key="conversation.id"
          class="list-row"
          :aria-label="`与${conversation.peer.nickname}聊天`"
          @click="uni.navigateTo({ url: `/pages/chat/index?id=${conversation.id}` })"
        >
          <MobileAvatar :src="conversation.peer.avatar?.url" :name="conversation.peer.nickname" />
          <view class="grow stack stack--tight"
            ><view class="row row--between row--wrap"
              ><text class="name">{{ conversation.peer.nickname }}</text
              ><text class="caption">{{ relativeTime(conversation.last_at) }}</text></view
            ><text class="muted">{{ conversation.last_message.slice(0, 45) }}</text></view
          ><text v-if="conversation.unread" class="badge">{{ conversation.unread }}</text>
        </MobileAction>
      </view>
      <MobileEmptyState
        v-else-if="!loading && !error"
        icon="message"
        title="还没有聊天"
        description="从好友主页发起一次交流吧。"
      />
      <text class="caption">仅好友可以发消息。打开消息页可查看新消息，暂不提供离线提醒。</text>
    </template>
  </view>
</template>
