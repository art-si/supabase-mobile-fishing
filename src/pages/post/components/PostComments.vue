<script setup lang="ts">
import MobileAction from '@mobile-core/components/MobileAction.vue'

import { computed, getCurrentInstance, nextTick, onScopeDispose, ref, watch } from 'vue'
import { onHide, onShow } from '@dcloudio/uni-app'
import MobileField from '@mobile-core/components/MobileField.vue'
import MobileConfirmDialog from '@mobile-core/components/MobileConfirmDialog.vue'
import MobileMediaUploader from '@mobile-core/components/MobileMediaUploader.vue'
import MobileEmojiPicker from '@mobile-core/components/MobileEmojiPicker.vue'
import MobileCommentComposer from '@mobile-core/components/MobileCommentComposer.vue'
import MobileListFooter from '@mobile-core/components/MobileListFooter.vue'
import type { MediaUploadEntry } from '@mobile-core/media-upload'
import DiscussionComment from '@/components/DiscussionComment.vue'
import DiscussionLikes from '@/components/DiscussionLikes.vue'
import { canRetryPhoto, uploadPhoto, uploadVideo } from '@/services/media'
import { canUseCamera, chooseCommentMedia, preserveCommentCameraPage } from '@/platforms/comment-camera'
import { revealControl } from '@mobile-core/form-focus'
// #ifdef MP-WEIXIN
import { getCapsuleClearance } from '@mobile-core/system-insets'
// #endif
import { useAuthStore } from '@/stores/auth'
import { read, write } from '@/services/repository'
import { createId, errorText } from '@/domain/rules'
import { commentAttempt, mergeComments, type CommentAttempt } from '@/domain/comments'
import type { Comment, CommentPage } from '@/domain/models'
import { ApiError } from '@/services/http'
import ContentReportAction from '@/components/ContentReportAction.vue'
import ContentReviewStatus from '@/components/ContentReviewStatus.vue'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
const props = defineProps<{
  post: string
  likes: number
  initial: Comment[]
  next?: string | null
  total: number
}>()
const emit = defineEmits<{ count: [value: number]; unavailable: [] }>()
const auth = useAuthStore(),
  nativeScope = getCurrentInstance()?.proxy
const items = ref<Comment[]>([]),
  next = ref<string | null>(null),
  total = ref(0)
const body = ref(''),
  replyId = ref<string | null>(null),
  reply = ref<Comment>(),
  focus = ref(false)
const media=ref<MediaUploadEntry[]>([]), active=ref(true), emojiOpen=ref(false)
const keyboardHeight = ref(0)
let keyboardRevision = 0
// #ifdef MP-WEIXIN
let layoutHeight = uni.getWindowInfo().windowHeight
// #endif
const uploader=ref<InstanceType<typeof MobileMediaUploader>>()
const showCamera=computed(()=>canUseCamera())
let selection={start:0,end:0}
const incompleteMedia=computed(()=>media.value.some(item=>!item.asset))
const hasContent=computed(()=>Boolean(body.value.trim()||media.value.length))
const uploadRecovery=(failure:unknown)=>canRetryPhoto(failure)?'retry' as const:'remove' as const
function clearMedia(){media.value.forEach(item=>item.release?.());media.value=[]}
const busy = ref(false),
  loading = ref(false),
  error = ref(''),
  pageError = ref('')
const confirming = ref(false),
  deleting = ref<Comment>(),
  notice = ref('')
const reporting = ref<Comment>(),
  reportAction = ref<InstanceType<typeof ContentReportAction>>()
let generation = 0,
  attempt: CommentAttempt | undefined
function invalidate() {
  generation++
  keyboardRevision++
  busy.value = loading.value = false
  confirming.value = false
  deleting.value = reply.value = undefined
  reporting.value = undefined
  emojiOpen.value=false
  items.value = []
  next.value = null
  error.value = pageError.value = notice.value = ''
}
watch(
  () => props.initial,
  () => {
    const previousReply = reply.value
    invalidate()
    items.value = props.initial
    next.value = props.next || null
    total.value = props.total
    const refreshedReply = items.value.find((item) => item.id === replyId.value)
    reply.value = refreshedReply
      ? refreshedReply.status !== 'hidden' ? refreshedReply : undefined
      : previousReply?.id === replyId.value ? previousReply : undefined
    if (keyboardHeight.value) void moveAboveKeyboard(keyboardHeight.value)
  },
  { immediate: true }
)
watch(
  () => [props.post, auth.context],
  () => {
    invalidate()
    keyboardHeight.value = 0
    body.value = ''
    clearMedia()
    replyId.value = null
    attempt = undefined
  },
  { flush: 'sync' }
)
onHide(()=>{
  keyboardRevision++
  keyboardHeight.value=0
  focus.value=false
  // #ifdef MP-WEIXIN
  if(preserveCommentCameraPage())return
  // #endif
  // #ifdef H5
  // The native camera temporarily backgrounds the web view; route exits still invalidate.
  if(document.visibilityState==='hidden' && preserveCommentCameraPage())return
  // #endif
  active.value=false;keyboardHeight.value=0;invalidate()
})
onShow(()=>{
  active.value=true
  // #ifdef MP-WEIXIN
  layoutHeight = uni.getWindowInfo().windowHeight
  // #endif
})
onScopeDispose(()=>{invalidate();clearMedia()})
function inaccessible(e: unknown) {
  if (
    e instanceof ApiError &&
    (['NOT_FOUND', 'FORBIDDEN'].includes(e.code) || [401, 403, 404].includes(e.status))
  ) {
    invalidate()
    emit('unavailable')
    return true
  }
  return false
}
async function moveAboveKeyboard(height: number) {
  // #ifdef MP-WEIXIN
  const revision = ++keyboardRevision
  keyboardHeight.value = Math.max(0, height)
  if (!height || !active.value || !nativeScope) return
  await nextTick()
  const query = uni.createSelectorQuery().in(nativeScope)
  query.select('#post-comment-composer').boundingClientRect()
  query.selectViewport().scrollOffset(() => {})
  query.exec(([box, viewport]: [UniApp.NodeInfo | null, UniApp.NodeInfo | null]) => {
    if (revision !== keyboardRevision || !active.value ||
        typeof box?.bottom !== 'number' || typeof viewport?.scrollTop !== 'number') return
    const overflow = box.bottom - (layoutHeight - height - 8)
    const top = typeof box.top === 'number' ? box.top : 0
    const clearance = getCapsuleClearance() + 12
    const delta = overflow > 0 ? overflow : top < clearance ? top - clearance : 0
    if (Math.abs(delta) > 1) uni.pageScrollTo({ scrollTop: Math.max(0, viewport.scrollTop + delta), duration: 0 })
  })
  // #endif
}
async function focusComposer() {
  focus.value = false
  await nextTick()
  focus.value = true
  void revealControl('comment', { nativeScope })
}
function showEmoji(){
 if(busy.value)return
 selection={start:body.value.length,end:body.value.length}
 // #ifdef H5
 const input=document.getElementById('comment-input') as HTMLTextAreaElement|null
 if(input)selection={start:input.selectionStart??body.value.length,end:input.selectionEnd??body.value.length}
 // #endif
 emojiOpen.value=true
}
function chooseMedia(source: 'camera' | 'album') {
  if (busy.value || !active.value || uploader.value?.choosing || media.value.length >= 6 || !auth.requireLogin()) return
  void uploader.value?.choose(source)
}
async function insertEmoji(value:string){
 const next=body.value.slice(0,selection.start)+value+body.value.slice(selection.end)
 if(next.length>500){error.value='评论最多 500 字，请先减少文字再添加表情。';await focusComposer();return}
 body.value=next;error.value=''
 await nextTick();await nextTick();await focusComposer();await nextTick()
 // #ifdef H5
 const input=document.getElementById('comment-input') as HTMLTextAreaElement|null
 input?.setSelectionRange(selection.start+value.length,selection.start+value.length)
 // #endif
}
function selectReply(item: Comment) {
  if (busy.value || item.status === 'hidden' || !auth.requireLogin()) return
  reply.value = item
  replyId.value = item.id
  error.value = notice.value = ''
  void focusComposer()
}
async function prepareReport(item: Comment) {
  if (busy.value || loading.value || item.status === 'hidden' || !auth.requireLogin()) return
  const current = generation
  reporting.value = item
  await nextTick()
  if (current === generation) reportAction.value?.prepare()
}
function cancelReply() {
  reply.value = undefined
  replyId.value = null
  error.value = ''
  void focusComposer()
}
async function refresh(current: number) {
  const page = await read<CommentPage>('comments', { id: props.post })
  if (current !== generation) return
  items.value = page.items
  next.value = page.next
  total.value = page.total
  reply.value = page.items.find((item) => item.id === replyId.value && item.status !== 'hidden')
  emit('count', page.total)
}
async function more() {
  if (!next.value || loading.value || busy.value) return
  const current = generation
  loading.value = true
  pageError.value = ''
  try {
    const page = await read<CommentPage>('comments', { id: props.post, cursor: next.value })
    if (current !== generation) return
    items.value = mergeComments(items.value, page.items)
    reply.value = items.value.find((item) => item.id === replyId.value && item.status !== 'hidden')
    next.value = page.next
    total.value = page.total
    emit('count', page.total)
  } catch (e) {
    if (current === generation && !inaccessible(e)) pageError.value = errorText(e)
  } finally {
    if (current === generation) loading.value = false
  }
}
defineExpose({
  canRefresh: () => !busy.value && !uploader.value?.choosing && !uploader.value?.uploading,
  reachBottom: () => { if (!pageError.value) void more() },
  reveal: () => revealControl('comments', { focus: false, nativeScope })
})
async function send() {
  if (busy.value || incompleteMedia.value || uploader.value?.choosing || (replyId.value && !reply.value) || !hasContent.value || !auth.requireLogin())
    return
  const current = generation
  busy.value = true
  error.value = notice.value = ''
  attempt = commentAttempt(attempt, props.post, body.value, replyId.value, createId, media.value.flatMap(item=>item.asset?[item.asset]:[]))
  let accepted = false
  try {
    await write('comment', { ...attempt })
    if (current !== generation) return
    accepted = true
    body.value = ''
    clearMedia()
    reply.value = undefined
    replyId.value = null
    attempt = undefined
    notice.value = '评论已发表'
    await refresh(current)
  } catch (e) {
    if (current === generation && !inaccessible(e)) {
      error.value = accepted ? '评论已发表，列表未能刷新，请重新读取' : errorText(e)
    }
  } finally {
    if (current === generation) busy.value = false
  }
}
function prepareDelete(item: Comment) {
  if (busy.value || item.author.id !== auth.userId) return
  deleting.value = item
  error.value = ''
  confirming.value = true
}
async function remove() {
  if (busy.value || !deleting.value) return
  const current = generation,
    target = deleting.value.id
  busy.value = true
  error.value = ''
  let accepted = false
  try {
    await write('delete_comment', { id: target, post_id: props.post })
    if (current !== generation) return
    accepted = true
    confirming.value = false
    deleting.value = undefined
    if (replyId.value === target) {
      reply.value = undefined
      replyId.value = null
    }
    // Erase the deleted text and all local quotes immediately, including if refresh goes offline.
    items.value = items.value
      .filter((item) => item.id !== target)
      .map((item) => (item.reply_to_id === target ? { ...item, reply_to: null } : item))
    total.value = Math.max(0, total.value - 1)
    emit('count', total.value)
    notice.value = '评论已删除'
    await refresh(current)
  } catch (e) {
    if (current === generation && !inaccessible(e))
      error.value = accepted ? '评论已删除，列表未能刷新，请重新读取' : errorText(e)
  } finally {
    if (current === generation) busy.value = false
  }
}
async function reload() {
  if (busy.value || loading.value) return
  const current = generation
  loading.value = true
  pageError.value = error.value = ''
  reply.value = undefined
  try {
    await refresh(current)
  } catch (e) {
    if (current === generation && !inaccessible(e)) pageError.value = errorText(e)
  } finally {
    if (current === generation) loading.value = false
  }
}
</script>

<template>
  <view id="comments" class="panel stack post-comments"
    :style="{ '--post-comment-keyboard-inset': `${keyboardHeight}px` }">
    <view class="row row--between row--wrap">
      <text id="comments-heading" class="heading" role="heading" aria-level="2" tabindex="-1"
        >钓友交流 · {{ total }}</text
      >
      <text v-if="items.length" class="caption">最新评论在前</text>
    </view>
    <DiscussionLikes v-if="likes" :target="'post:' + post" :count="likes" />
    <text v-if="!items.length" class="muted">还没有评论，聊聊你的经验。</text>
    <DiscussionComment v-for="item in items" :key="item.id" :item="item" :can-reply="item.status !== 'hidden'"
      :disabled="busy || loading" :reply-label="`回复 ${item.author.nickname}`" media-label="评论附件" @reply="selectReply(item)">
      <ContentReviewStatus
        v-if="item.status === 'hidden'"
        :id="item.id"
        type="comment"
        status="hidden"
        :owner="item.author.id"
      />
      <template #management>
        <MobileAction
          v-if="item.author.id === auth.userId"
          class="text-action"
          :disabled="busy || loading"
          aria-label="删除自己的评论"
          @click="prepareDelete(item)"
          >删除</MobileAction>
        <MobileAction
          v-else-if="item.status !== 'hidden'"
          class="text-action"
          :disabled="busy || loading"
          :aria-label="`举报 ${item.author.nickname} 的评论`"
          @click="prepareReport(item)"
          >举报</MobileAction>
      </template>
    </DiscussionComment>
    <MobileListFooter :loading="loading" :error="pageError" :can-load-more="!!next && !busy"
      :finished="!next && !loading" :count="items.length" :total="total"
      loading-label="正在加载更多评论…" error-title="更多评论暂未加载" @more="more" />
    <ContentReportAction
      v-if="reporting"
      ref="reportAction"
      :id="reporting.id"
      type="comment"
      :owner="reporting.author.id"
      hide-trigger
    />
    <view id="post-comment-composer" class="post-comments__composer"
      :class="{ 'post-comments__composer--keyboard': keyboardHeight > 0 }">
    <MobileCommentComposer
      :disabled="busy || !active"
      :busy="busy"
      :media-disabled="uploader?.choosing || media.length >= 6"
      :send-disabled="incompleteMedia || uploader?.choosing || !!(replyId && !reply) || !hasContent"
      :emoji-open="emojiOpen"
      :send-label="replyId ? '发表回复' : '发表评论'"
      :show-camera="showCamera"
      :show-reply="!!replyId"
      :show-meta="!!(media.length || body.length)"
      emoji-trigger-id="comment-emoji-trigger"
      @emoji="showEmoji"
      @camera="chooseMedia('camera')"
      @media="chooseMedia('album')"
      @send="send"
    >
      <template v-if="replyId" #reply><view class="post-comments__replying row row--between row--wrap">
        <view class="stack stack--tight post-comments__reply">
          <text class="name">{{ reply ? `回复 ${reply.author.nickname}` : '回复对象待确认' }}</text>
          <text v-if="reply" class="caption post-comments__excerpt">{{ reply.body || (reply.media?.some(asset => asset.kind === 'video') ? '[附件]' : '[图片]') }}</text>
          <text v-if="!reply" class="caption">原评论暂未显示，请重新选择或取消回复，已写内容会保留。</text>
        </view>
        <MobileAction class="text-action" :disabled="busy" @click="cancelReply"
          >取消回复</MobileAction>
      </view></template>
      <MobileField
        v-model="body"
        field="comment"
        :label="replyId ? '写一条回复' : '写一条评论'"
        :focus="focus"
        :disabled="busy"
        multiline
        plain
        :adjust-position="false"
        @keyboard="moveAboveKeyboard"
        :maxlength="500"
        :placeholder="reply ? `回复 ${reply.author.nickname}…` : '分享有用的经验，友善交流'"
      />
      <template v-if="auth.signedIn" #attachments>
        <MobileMediaUploader ref="uploader" v-model="media" :scope="`${auth.context}:${post}`" :poster-scope="auth.context" :active="active" :accept="['image','video']" :limit="6" :upload-image="uploadPhoto" :upload-video="uploadVideo" :media-picker="chooseCommentMedia" :error-text="errorText" :recovery="uploadRecovery" :disabled="busy || !active" hide-add-button compact @change="error=''" />
      </template>
      <template v-if="media.length || body.length" #meta><text v-if="media.length">附件 {{ media.length }}/6</text><text v-if="body.length">{{ body.length }}/500</text></template>
    </MobileCommentComposer>
    </view>
    <text v-if="notice" class="caption" :class="{ 'post-comments__announcement': notice !== '评论已删除' }" role="status">{{ notice }}</text>
    <text v-if="error && !confirming" class="error" role="alert">{{ error }}</text>
    <MobileAction
      v-if="error"
      class="text-action"
      :disabled="busy || loading"
      @click="reload"
      >重新读取评论</MobileAction>
    <MobileConfirmDialog
      v-model="confirming"
      title="删除这条评论？"
      message="删除后无法恢复，其他回复中的原文引用也会隐藏。"
      confirm-text="删除评论"
      keep-open-on-confirm
      :busy="busy"
      @confirm="remove"
      @after-close="!deleting && revealControl('comment', { nativeScope })"
    >
      <text v-if="error" class="error" role="alert">{{ error }}</text>
    </MobileConfirmDialog>
    <MobileEmojiPicker v-model="emojiOpen" trigger-id="comment-emoji-trigger" @select="insertEmoji" />
  </view>
</template>

<style scoped>
.post-comments__announcement {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.post-comments {
  gap: 4px;
  padding-bottom: calc(var(--fishing-card-padding, 20px) + var(--post-comment-keyboard-inset, 0px));
}
.post-comments__composer {
  --mobile-comment-input-height: clamp(52px, 11vh, 84px);
  display: block;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  /* Match WeChat's document flow: large text and short screens must not hide comments. */
  margin-top: 8px;
  padding-block: 8px max(8px, var(--mobile-safe-bottom, 0px));
  border-top: 1px solid var(--line);
  background: var(--paper);
}
/* #ifdef MP-WEIXIN */
.post-comments__composer--keyboard {
  --mobile-comment-input-height: clamp(36px, calc((100vh - var(--post-comment-keyboard-inset, 0px)) * .11), 84px);
  padding-bottom: 8px;
}
/* #endif */
.post-comments__replying { gap: 8px; color: var(--reed); }
.post-comments__reply { min-width: 0; flex: 1 1 8rem; }
.post-comments__excerpt { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; white-space: pre-wrap; }
.post-comments__replying .text-action { flex: none; align-self: flex-start; margin-inline-start: auto; }
</style>
