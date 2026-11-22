<script setup lang="ts">
import { ref, watch } from 'vue'
import { onHide, onLoad, onReachBottom, onShow } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import PostCard from '@/components/PostCard.vue'
import ContentReviewStatus from '@/components/ContentReviewStatus.vue'
import ContentOwnerActions from '@/components/ContentOwnerActions.vue'
import ContentReportAction from '@/components/ContentReportAction.vue'
import PostComments from './components/PostComments.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileLoadingStatus from '@/components/FishingLoadingStatus.vue'
import { useResource } from '@/composables/useResource'
import { useMutation } from '@/composables/useMutation'
import { useLoginAction } from '@/composables/useLoginAction'
import { useAuthStore } from '@/stores/auth'
import { read, write } from '@/services/repository'
import type { Post, Comment } from '@/domain/models'
const id = ref(''),
  auth = useAuthStore()
const commentList = ref<InstanceType<typeof PostComments>>()
onReachBottom(() => commentList.value?.reachBottom())
type PostDetail = { post: Post; comments: Comment[]; comments_next?: string | null }
const { data, loading, error, load, invalidate } = useResource(
  () => read<PostDetail>('post', { id: id.value }),
  null as PostDetail | null
)
const mutation = useMutation()
onHide(invalidate)
// A failed permission/read must not reappear from stale state when the user retries.
watch(
  error,
  (message) => {
    if (message) data.value = null
  },
  { flush: 'sync' }
)
onLoad((options) => {
  id.value = options?.id || ''
  void load()
})
onShow(() => {
  if (id.value) void load()
})
type Reaction = { id: string; kind: 'like' | 'bookmark'; enabled: boolean }
const loginAction = useLoginAction<Reaction>((intent) => applyReaction(intent, true))
async function react(kind: 'like' | 'bookmark') {
  if (!data.value || mutation.busy.value) return
  const p = data.value.post
  const intent = {
    id: p.id,
    kind,
    enabled: auth.signedIn ? !(kind === 'like' ? p.liked : p.saved) : true
  }
  if (!loginAction.requireLogin(intent)) return
  await applyReaction(intent)
}
async function applyReaction(intent: Reaction, resumed = false) {
  if (id.value !== intent.id) return
  await mutation.run(async () => {
    const scope = auth.context
    invalidate()
    let result: Post
    try {
      result = await write<Post>('reaction', intent)
    } catch (failure) {
      if (resumed && auth.context === scope) await load()
      throw failure
    }
    if (id.value !== intent.id) return
    if (data.value?.post.id === intent.id) data.value = { ...data.value, post: result }
    else await load()
    if (resumed && auth.context === scope)
      uni.showToast({ title: intent.kind === 'like' ? '已点赞' : '已收藏', icon: 'none' })
  })
}
function updateCommentCount(count: number) {
  if (data.value) data.value = { ...data.value, post: { ...data.value.post, comment_count: count } }
}
function unavailable() {
  data.value = null
  void load()
}
function showComments() {
  // #ifdef H5
  const heading = document.getElementById('comments-heading')
  if (!heading) return
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  heading.focus({ preventScroll: true })
  heading.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'instant' : 'smooth' })
  // #endif
  // #ifndef H5
  uni.pageScrollTo({ selector: '#comments', duration: 0 })
  // #endif
}
</script>
<template>
  <FishingShell title="鱼情详情" back>
    <view class="fishing-content stack">
      <MobileLoadingStatus v-if="loading" label="正在读取这份鱼情…" /><MobileLoadError
        v-if="error"
        :message="error"
        @retry="load"
      />
      <template v-if="data && !error">
        <ContentReviewStatus
          v-if="data.post.status === 'hidden'"
          :id="data.post.id"
          type="post"
          :status="data.post.status"
          :owner="data.post.author.id"
        />
        <PostCard
          :post="data.post"
          full
          :busy="mutation.busy.value"
          @react="react"
          @open="showComments"
        />
        <ContentOwnerActions
          :id="data.post.id"
          type="post"
          :owner="data.post.author.id"
          :audience="data.post.audience"
          :revision="data.post.review_revision"
          :update="data.post.content_update"
          @changed="load"
        />
        <PostComments
          ref="commentList"
          :post="data.post.id"
          :likes="data.post.like_count"
          :initial="data.comments"
          :next="data.comments_next"
          :total="data.post.comment_count"
          @count="updateCommentCount"
          @unavailable="unavailable"
        />
        <ContentReportAction :id="data.post.id" type="post" :owner="data.post.author.id" />
      </template>
      <text v-if="mutation.error.value && !error" class="error" role="alert">{{
        mutation.error.value
      }}</text>
    </view>
  </FishingShell>
</template>
