<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onLoad, onShow, onHide } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import FishingLoadingStatus from '@/components/FishingLoadingStatus.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileAvatar from '@mobile-core/components/MobileAvatar.vue'
import MobileField from '@mobile-core/components/MobileField.vue'
import MobileBottomSheet from '@mobile-core/components/MobileBottomSheet.vue'
import MobileConfirmDialog from '@mobile-core/components/MobileConfirmDialog.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import PostCard from '@/components/PostCard.vue'
import { useResource } from '@/composables/useResource'
import { useMutation } from '@/composables/useMutation'
import { useAuthStore } from '@/stores/auth'
import { read, write } from '@/services/repository'
import type { PersonDetail, Post } from '@/domain/models'
const id = ref(''),
  auth = useAuthStore(),
  mutation = useMutation(),
  requestOpen = ref(false),
  note = ref(''),
  sent = ref(false)
const { data, error, loading, load } = useResource(
  () => read<PersonDetail>('profile', { id: id.value }),
  null as PersonDetail | null
)
onLoad((options) => {
  id.value = options?.id || ''
  void load()
})
onShow(() => {
  if (id.value) void load()
})
async function follow() {
  if (!auth.requireLogin()) return
  await mutation.run(async () => {
    await write('follow', { id: id.value, enabled: !data.value?.following })
    await load()
  })
}
async function chat() {
  if (!auth.requireLogin()) return
  await mutation.run(async () => {
    const conversation = await write<string>('conversation', { id: id.value })
    uni.navigateTo({ url: `/pages/chat/index?id=${conversation}` })
  })
}
function requestFriend() {
  if (auth.requireLogin()) requestOpen.value = true
}
async function sendRequest() {
  await mutation.run(async () => {
    await write('friend_request', { id: id.value, note: note.value })
    sent.value = true
    requestOpen.value = false
  })
}
const confirmOpen = ref(false),
  relationshipAction = ref<'block' | 'unblock' | 'remove'>('block')
const relationshipPrompt = computed(
  () =>
    ({
      block: {
        title: '拉黑这位钓友？',
        message: '停止新消息和好友申请，并解除好友关系。已有聊天记录保留。',
        confirm: '拉黑'
      },
      unblock: { title: '解除拉黑？', message: '解除后不会自动恢复好友关系。', confirm: '解除' },
      remove: {
        title: '删除好友？',
        message: '删除后停止新消息，保留已有聊天记录。',
        confirm: '删除好友'
      }
    })[relationshipAction.value]
)
onHide(() => {
  confirmOpen.value = false
})
watch(
  () => auth.context,
  () => {
    note.value = ''
    sent.value = false
    requestOpen.value = false
    confirmOpen.value = false
  },
  { flush: 'sync' }
)
function block() {
  if (!auth.requireLogin()) return
  if (mutation.busy.value) return
  relationshipAction.value = data.value?.blocked ? 'unblock' : 'block'
  confirmOpen.value = true
}
function removeFriend() {
  if (!auth.requireLogin() || mutation.busy.value) return
  relationshipAction.value = 'remove'
  confirmOpen.value = true
}
async function confirmRelationship() {
  const action = relationshipAction.value
  await mutation.run(async () => {
    await write(action === 'remove' ? 'unfriend' : 'block', {
      id: id.value,
      enabled: action === 'block'
    })
    await load()
  })
}
async function react(post: Post, kind: 'like' | 'bookmark') {
  if (!auth.requireLogin()) return
  await mutation.run(async () => {
    await write('reaction', {
      id: post.id,
      kind,
      enabled: kind === 'like' ? !post.liked : !post.saved
    })
    await load()
  })
}
</script>
<template>
  <FishingShell title="钓友主页" back
    ><view class="fishing-content stack"
      ><MobileLoadError v-if="error" :message="error" @retry="load" />
      <FishingLoadingStatus v-if="loading && !data" label="正在读取这位钓友的鱼情…" />
      <template v-if="data"
        ><view class="panel stack"
          ><view class="row"
            ><MobileAvatar :src="data.profile.avatar?.url" :name="data.profile.nickname" :size="64" />
            <view class="stack stack--tight"
              ><text class="heading">{{ data.profile.nickname }}</text
              ><text class="caption">{{ data.profile.handle }}</text
              ><text class="muted">{{ data.profile.city }} · {{ data.profile.method }}</text></view
            ></view
          ><text class="body">{{ data.profile.bio || '这位钓友还没写简介。' }}</text
          ><template v-if="id !== auth.userId"
            ><view class="mobile-action-group"
              ><MobileAction
                class="secondary grow"
                :disabled="mutation.busy.value || data.blocked"
                :aria-pressed="data.following"
                @click="follow"
                >{{ data.following ? '已关注' : '关注鱼情' }}</MobileAction
              ><MobileAction
                class="primary grow"
                :disabled="mutation.busy.value || data.blocked"
                @click="data.friend ? chat() : requestFriend()"
                >{{ data.friend ? '发消息' : sent ? '申请已发送' : '加好友' }}</MobileAction
              ></view
            ><text v-if="sent" class="caption">申请已发送，等待对方同意。</text></template
          ></view
        >
        <text class="heading">TA 的鱼情</text
        ><PostCard
          v-for="post in data.posts"
          :key="post.id"
          :post="post"
          :busy="mutation.busy.value"
          @react="react(post, $event)"
          @open="uni.navigateTo({ url: `/pages/post/detail?id=${post.id}` })"
        />
        <text v-if="!data.posts.length" class="muted">暂时没有你可查看的公开记录。</text>
        <template v-if="id !== auth.userId && auth.signedIn"
          ><MobileAction v-if="data.friend" class="text-action" @click="removeFriend"
            >删除好友</MobileAction
          ><MobileAction class="text-action" @click="block">{{
            data.blocked ? '解除拉黑' : '拉黑这位钓友'
          }}</MobileAction></template
        > </template
      ><text v-if="mutation.error.value" class="error" role="alert">{{
        mutation.error.value
      }}</text> </view
    ><MobileBottomSheet
      v-model="requestOpen"
      title="和钓友打个招呼"
      close-label="关闭好友申请"
      :busy="mutation.busy.value"
      ><view class="stack fishing-sheet-content"
        ><MobileField
          v-model="note"
          field="friend-note"
          label="申请留言"
          multiline
          :maxlength="200"
          placeholder="说说共同的钓法或想交流的话题"
        /><text class="caption">接受申请后才能私聊。你的手机号不会发给对方。</text
        ><text v-if="mutation.error.value" class="error">{{ mutation.error.value }}</text
        ><MobileAction class="primary" :disabled="mutation.busy.value" @click="sendRequest"
          >发送好友申请</MobileAction
        ></view
      ></MobileBottomSheet
    ><MobileConfirmDialog
      v-model="confirmOpen"
      :title="relationshipPrompt.title"
      :message="relationshipPrompt.message"
      :confirm-text="relationshipPrompt.confirm"
      :destructive="relationshipAction !== 'unblock'"
      @confirm="confirmRelationship"
  /></FishingShell>
</template>
