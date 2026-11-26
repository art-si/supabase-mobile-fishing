<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, onScopeDispose, ref, watch } from 'vue'
import { onHide, onShow } from '@dcloudio/uni-app'
import MobileAction from '@mobile-core/components/MobileAction.vue'
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
import { canUseCamera, chooseCommentCamera, isCommentCameraHandoff } from '@/platforms/comment-camera'
import { preserveMediaPickerPage } from '@mobile-core/media-picker-session'
import { revealControl } from '@mobile-core/form-focus'
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
    invalidate()
    items.value = props.initial
    next.value = props.next || null
    total.value = props.total
    reply.value = items.value.find((item) => item.id === replyId.value && item.status !== 'hidden')
  },
  { immediate: true }
)
watch(
  () => [props.post, auth.context],
  () => {
    invalidate()
    body.value = ''
    clearMedia()
    replyId.value = null
    attempt = undefined
  },
  { flush: 'sync' }
)
onHide(()=>{
  // #ifdef MP-WEIXIN
  if(preserveMediaPickerPage())return
  // #endif
  // #ifdef H5
  // The native camera temporarily backgrounds the web view; route exits still invalidate.
  if(isCommentCameraHandoff() && document.visibilityState==='hidden')return
  // #endif
  active.value=false;invalidate()
})
onShow(()=>{active.value=true})
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
defineExpose({ reachBottom: () => { if (!pageError.value) void more() } })
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
  <view id="comments" class="panel stack post-comments">
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
          >删除</MobileAction
        >
        <MobileAction
          v-else-if="item.status !== 'hidden'"
          class="text-action"
          :disabled="busy || loading"
          :aria-label="`举报 ${item.author.nickname} 的评论`"
          @click="prepareReport(item)"
          >举报</MobileAction
        >
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
    <MobileCommentComposer
      class="post-comments__composer"
      :disabled="busy || !active"
      :busy="busy"
      :media-disabled="uploader?.choosing || media.length >= 6"
      :send-disabled="incompleteMedia || uploader?.choosing || !!(replyId && !reply) || !hasContent"
      :emoji-open="emojiOpen"
      :send-label="replyId ? '发表回复' : '发表评论'"
      :show-camera="showCamera"
      emoji-trigger-id="comment-emoji-trigger"
      @emoji="showEmoji"
      @camera="chooseMedia('camera')"
      @media="chooseMedia('album')"
      @send="send"
    >
      <template v-if="replyId" #reply><view class="post-comments__replying row row--between">
        <view class="stack stack--tight post-comments__reply">
          <text class="name">{{ reply ? `回复 ${reply.author.nickname}` : '回复对象待确认' }}</text>
          <text v-if="!reply" class="caption">原评论暂未显示，请重新选择或取消回复，已写内容会保留。</text>
        </view>
        <MobileAction class="text-action" :disabled="busy" @click="cancelReply"
          >取消回复</MobileAction
        >
      </view></template>
      <MobileField
        v-model="body"
        field="comment"
        :label="replyId ? '写一条回复' : '写一条评论'"
        :focus="focus"
        :disabled="busy"
        multiline
        :maxlength="500"
        :placeholder="reply ? `回复 ${reply.author.nickname}…` : '分享有用的经验，友善交流'"
      />
      <template v-if="auth.signedIn" #attachments>
        <MobileMediaUploader ref="uploader" v-model="media" :scope="`${auth.context}:${post}`" :poster-scope="auth.context" :active="active" :accept="['image','video']" :limit="6" :upload-image="uploadPhoto" :upload-video="uploadVideo" :camera-picker="chooseCommentCamera" :error-text="errorText" :recovery="uploadRecovery" :disabled="busy || !active" hide-add-button compact @change="error=''" />
      </template>
      <template v-if="media.length || body.length" #meta><text v-if="media.length">附件 {{ media.length }}/6</text><text v-if="body.length">{{ body.length }}/500</text></template>
    </MobileCommentComposer>
    <text v-if="notice" class="caption" role="status">{{ notice }}</text>
    <text v-if="error && !confirming" class="error" role="alert">{{ error }}</text>
    <MobileAction
      v-if="error"
      class="text-action"
      :disabled="busy || loading"
      @click="reload"
      >重新读取评论</MobileAction
    >
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
.post-comments { gap: 4px; }
.post-comments__composer {
  --mobile-comment-input-height: clamp(52px, 11vh, 84px);
  position: sticky;
  z-index: 2;
  bottom: 0;
  margin-top: 8px;
  padding-block: 8px max(8px, var(--mobile-safe-bottom, 0px));
  border-top: 1px solid var(--line);
  background: var(--paper);
}
.post-comments__composer :deep(.mobile-comment-composer__attachments) { max-height: min(14vh, 104px); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; }
.post-comments__replying { gap: 8px; color: var(--reed); }
.post-comments__reply { min-width: 0; flex: 1; }
.post-comments__replying .text-action { flex: none; }
</style>
