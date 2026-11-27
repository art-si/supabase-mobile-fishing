<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onLoad, onShow, onHide, onReachBottom } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import MobileSkeleton from '@mobile-core/components/MobileSkeleton.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileAvatar from '@mobile-core/components/MobileAvatar.vue'
import MobileConfirmDialog from '@mobile-core/components/MobileConfirmDialog.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileListFooter from '@mobile-core/components/MobileListFooter.vue'
import PostCard from '@/components/PostCard.vue'
import { useResource } from '@/composables/useResource'
import { useListRefresh } from '@/composables/useListRefresh'
import { useMutation } from '@/composables/useMutation'
import { useAuthStore } from '@/stores/auth'
import { read, write } from '@/services/repository'
import { onContentDeleted } from '@/services/content-deletion'
import type { PersonDetail, Post } from '@/domain/models'
const id = ref(''),
  auth = useAuthStore(),
  mutation = useMutation()
type ProfilePage = PersonDetail & { posts_next?: string | null }
const { data, error, loading, load, invalidate } = useResource(
  () => read<ProfilePage>('profile', { id: id.value, cursor: null }),
  null as ProfilePage | null
)
let active = true
onContentDeleted(value => {
  if (value.type !== 'post') return
  const reload = loading.value
  invalidate()
  if (data.value) data.value = { ...data.value, posts: data.value.posts.filter(post => post.id !== value.id) }
  if (reload && active && id.value) void load()
})
const more = useMutation()
async function loadMore() {
  const previous = data.value, scope = auth.context
  if (!previous?.posts_next || loading.value || error.value) return
  await more.run(async () => {
    try {
      const page = await read<ProfilePage>('profile', { id: id.value, cursor: previous.posts_next })
      if (data.value !== previous || auth.context !== scope || loading.value) return
      const ids = new Set(previous.posts.map(post => post.id))
      data.value = { ...page, posts: [...previous.posts, ...page.posts.filter(post => !ids.has(post.id))] }
    } catch (cause) {
      if (data.value === previous && auth.context === scope) throw cause
    }
  })
}
onReachBottom(() => { if (!more.error.value) void loadMore() })
useListRefresh(async () => { more.error.value = ''; await load() }, () => !mutation.busy.value)
onLoad((options) => {
  id.value = options?.id || ''
  void load()
})
onShow(() => {
  active = true
  if (id.value) void load()
})
async function follow() {
  if (!auth.requireLogin()) return
  await mutation.run(async () => {
    await write('follow', { id: id.value, enabled: !data.value?.following })
    await load()
  })
}
const confirmOpen = ref(false),
  relationshipAction = ref<'block' | 'unblock'>('block')
const relationshipPrompt = computed(
  () =>
    ({
      block: {
        title: '拉黑这位钓友？',
        message: '解除双方关注，并隐藏彼此的社区内容。',
        confirm: '拉黑'
      },
      unblock: { title: '解除拉黑？', message: '解除后可以重新查看对方的公开内容。', confirm: '解除' }
    })[relationshipAction.value]
)
onHide(() => {
  active = false
  confirmOpen.value = false
})
watch(
  () => auth.context,
  () => {
    confirmOpen.value = false
    more.error.value = ''
  },
  { flush: 'sync' }
)
function block() {
  if (!auth.requireLogin()) return
  if (mutation.busy.value) return
  relationshipAction.value = data.value?.blocked ? 'unblock' : 'block'
  confirmOpen.value = true
}
async function confirmRelationship() {
  const action = relationshipAction.value
  await mutation.run(async () => {
    await write('block', {
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
      <MobileSkeleton v-if="loading && !data" label="正在读取这位钓友的鱼情…" />
      <template v-if="data"
        ><view class="panel stack"
          ><view class="row people-profile__header"
            ><MobileAvatar :src="data.profile.avatar?.url" :name="data.profile.nickname" :size="64" />
            <view class="grow stack stack--tight people-profile__copy"
              ><text class="heading">{{ data.profile.nickname }}</text
              ><text class="caption">{{ data.profile.handle }}</text
              ><text v-if="data.profile.city || data.profile.method" class="muted">{{ [data.profile.city, data.profile.method].filter(Boolean).join(' · ') }}</text></view
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
              ></view></template
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
        <MobileListFooter :loading="more.busy.value" :error="more.error.value"
          :can-load-more="!!data.posts_next && !loading && !error"
          :finished="!data.posts_next && !loading && !error" :count="data.posts.length"
          loading-label="正在加载更多鱼情…" @more="loadMore" />
        <text v-if="!data.posts.length && !data.posts_next" class="muted">暂时没有你可查看的公开记录。</text>
        <template v-if="id !== auth.userId && auth.signedIn"
          ><MobileAction class="text-action" @click="block">{{
            data.blocked ? '解除拉黑' : '拉黑这位钓友'
          }}</MobileAction></template
        > </template
      ><text v-if="mutation.error.value" class="error" role="alert">{{
        mutation.error.value
      }}</text> </view
    ><MobileConfirmDialog
      v-model="confirmOpen"
      :title="relationshipPrompt.title"
      :message="relationshipPrompt.message"
      :confirm-text="relationshipPrompt.confirm"
      :destructive="relationshipAction !== 'unblock'"
      @confirm="confirmRelationship"
  /></FishingShell>
</template>
<style scoped>
.people-profile__header { align-items: flex-start; }
.people-profile__copy { overflow-wrap: anywhere; }
</style>
