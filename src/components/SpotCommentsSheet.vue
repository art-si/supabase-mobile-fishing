<script lang="ts">
let commentSheetSequence = 0
</script>

<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { onHide, onUnload } from '@dcloudio/uni-app'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileBottomSheet from '@mobile-core/components/MobileBottomSheet.vue'
import MobileField from '@mobile-core/components/MobileField.vue'
import MobileCommentComposer from '@mobile-core/components/MobileCommentComposer.vue'
import MobileConfirmDialog from '@mobile-core/components/MobileConfirmDialog.vue'
import MobileEmojiPicker from '@mobile-core/components/MobileEmojiPicker.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileListFooter from '@mobile-core/components/MobileListFooter.vue'
import MobileMediaUploader from '@mobile-core/components/MobileMediaUploader.vue'
import type { MediaUploadEntry } from '@mobile-core/media-upload'
import FishingLoadingStatus from './FishingLoadingStatus.vue'
import DiscussionComment from './DiscussionComment.vue'
import DiscussionLikes from './DiscussionLikes.vue'
import { useAuthStore } from '@/stores/auth'
import { useLoginAction } from '@/composables/useLoginAction'
import { useListEnd } from '@/composables/useListEnd'
import { errorText, createId } from '@/domain/rules'
import { commentAttempt, type CommentAttempt } from '@/domain/comments'
import { canRetryPhoto, uploadPhoto } from '@/services/media'
import { canUseCamera, chooseCommentCamera } from '@/platforms/comment-camera'
import { analyseSpotComments, deleteSpotComment, saveSpotComment, spotComments,
  type SpotCommunitySummary, type SpotDiscussion } from '@/services/spot-community'

defineOptions({ options: { styleIsolation: 'apply-shared' } })
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ target: string; title: string }>()
const emit = defineEmits<{ summary: [value: SpotCommunitySummary] }>()
const auth = useAuthStore()
const field = `spot-comment-${++commentSheetSequence}`
const emojiTrigger = `${field}-emoji`
const items = ref<SpotDiscussion[]>([])
const next = ref<string | null>(null)
const total = ref<number>()
const likes = ref(0)
const draft = ref('')
const reply = ref<SpotDiscussion>()
const media = ref<MediaUploadEntry[]>([])
const uploader = ref<InstanceType<typeof MobileMediaUploader>>()
const showCamera = canUseCamera()
const uploadRecovery = (cause: unknown) => canRetryPhoto(cause) ? 'retry' as const : 'remove' as const
const canSend = computed(() => !!(draft.value.trim() || media.value.length)
  && !uploader.value?.choosing && media.value.every(item => item.asset))
const keyboardHeight = ref(0)
const focus = ref(false)
const emojiOpen = ref(false)
const confirmOpen = ref(false)
const deleting = ref('')
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const pageError = ref('')
const actionError = ref('')
const notice = ref('')
let version = 0
let request: CommentAttempt | undefined

// Native preview and photo selection can temporarily hide the page.
// #ifdef H5
onHide(() => {
  if (!uploader.value?.choosing && document.visibilityState !== 'hidden') open.value = false
})
// #endif
// #ifdef MP-WEIXIN
watch(open, (visible, _, onCleanup) => {
  keyboardHeight.value = 0
  if (!visible) return
  const update = (event: { height: number }) => { keyboardHeight.value = event.height }
  uni.onKeyboardHeightChange(update)
  onCleanup(() => uni.offKeyboardHeightChange(update))
}, { immediate: true })
// #endif
onUnload(() => { open.value = false })

function clearDraft() {
  for (const item of media.value) item.release?.()
  media.value = []
  draft.value = ''
  reply.value = undefined
  request = undefined
}

async function load(more = false) {
  if (!open.value || !props.target || (more && (!next.value || loading.value || busy.value))) return
  const current = ++version
  loading.value = true
  error.value = ''
  pageError.value = ''
  try {
    const result = await spotComments(props.target, more ? next.value : null)
    if (version !== current) return
    const ids = new Set(items.value.map(item => item.id))
    items.value = more ? [...items.value, ...result.items.filter(item => !ids.has(item.id))] : result.items
    next.value = result.next ?? null
    total.value = result.summary.comments
    likes.value = result.summary.likes
    emit('summary', result.summary)
  } catch (cause) {
    if (version === current) (more ? pageError : error).value = errorText(cause)
  } finally {
    if (version === current) loading.value = false
  }
}

const end = useListEnd('.spot-discussion__end',
  () => open.value && !!next.value && !loading.value && !busy.value && !pageError.value, () => void load(true))
onScopeDispose(() => { version++; clearDraft() })

function analyse(target: string, afterSubmission = false) {
  if (!auth.signedIn) return
  const scope = auth.context
  void analyseSpotComments(target, afterSubmission).then(results => {
    if (auth.context === scope) for (const summary of results) emit('summary', summary)
  }).catch(() => {
    // The saved comment remains available for the next analysis attempt.
  })
}
watch([open, () => props.target], ([visible, target], previous) => {
  version++
  busy.value = false
  focus.value = false
  emojiOpen.value = confirmOpen.value = false
  actionError.value = notice.value = ''
  if (target !== previous?.[1]) {
    items.value = []
    next.value = null
    total.value = undefined
    likes.value = 0
    clearDraft()
  }
  if (visible) void load().then(() => {
    if (open.value && props.target === target && items.value.length) analyse(target)
  })
})
watch(() => auth.context, () => {
  version++
  busy.value = false
  confirmOpen.value = emojiOpen.value = false
  items.value = []
  next.value = null
  total.value = undefined
  likes.value = 0
  if (open.value) void load()
})
watch(() => auth.userId, (user, previous) => {
  if (previous && user !== previous) {
    clearDraft()
  }
})
const login = useLoginAction<{ target: string; replyId?: string }>(async intent => {
  if (props.target !== intent.target) return
  open.value = true
  if (intent.replyId) {
    await nextTick()
    await load()
    const item = items.value.find(comment => comment.id === intent.replyId)
    if (item && open.value && props.target === intent.target) selectReply(item)
  }
})
function signedIn(replyId?: string) {
  if (login.requireLogin({ target: props.target, replyId })) return true
  open.value = false
  return false
}
async function focusComposer() {
  focus.value = false
  await nextTick()
  focus.value = true
}
function selectReply(item: SpotDiscussion) {
  if (busy.value || !signedIn(item.id)) return
  reply.value = item
  actionError.value = notice.value = ''
  void focusComposer()
}
function cancelReply() {
  reply.value = undefined
  actionError.value = ''
  void focusComposer()
}
function chooseMedia(source: 'camera' | 'album') {
  if (busy.value || !open.value || uploader.value?.choosing || media.value.length >= 6 || !signedIn()) return
  actionError.value = notice.value = ''
  void uploader.value?.choose(source)
}
let selection: { start: number; end: number }
function showEmoji() {
  selection = { start: draft.value.length, end: draft.value.length }
  // #ifdef H5
  const input = document.getElementById(`${field}-input`) as HTMLTextAreaElement | null
  if (input) selection = { start: input.selectionStart, end: input.selectionEnd }
  // #endif
  focus.value = false
  emojiOpen.value = true
}
async function insertEmoji(emoji: string) {
  const text = draft.value.slice(0, selection.start) + emoji + draft.value.slice(selection.end)
  if (text.length > 500) {
    actionError.value = '评论最多 500 字，请先减少文字再添加表情。'
    return
  }
  draft.value = text
  actionError.value = ''
  await nextTick()
  focus.value = true
  // #ifdef H5
  await nextTick()
  const caret = selection.start + emoji.length
  const input = document.getElementById(`${field}-input`) as HTMLTextAreaElement | null
  input?.focus({ preventScroll: true })
  input?.setSelectionRange(caret, caret)
  // #endif
}
async function submit() {
  const body = draft.value.trim()
  const target = props.target
  if (busy.value || !canSend.value || body.length > 500 || !target || !signedIn()) return
  const scope = auth.context
  const attempt = commentAttempt(request, target, body, reply.value?.id ?? null, createId,
    media.value.flatMap(item => item.asset ? [item.asset] : []))
  request = attempt
  busy.value = true
  actionError.value = notice.value = ''
  try {
    await saveSpotComment(target, attempt.id, body, attempt.reply_to_id, attempt.media)
    if (scope !== auth.context) return
    if (props.target === target && request === attempt) {
      clearDraft()
      notice.value = attempt.reply_to_id ? '回复已发表' : '评论已发表'
      await load()
    }
    if (body) analyse(target, true)
  } catch (cause) {
    if (scope === auth.context && props.target === target) actionError.value = errorText(cause)
  } finally {
    if (scope === auth.context && props.target === target) busy.value = false
  }
}
function askRemove(id: string) {
  actionError.value = notice.value = ''
  deleting.value = id
  confirmOpen.value = true
}
async function remove() {
  const id = deleting.value
  if (!id || busy.value) return
  const target = props.target, scope = auth.context
  busy.value = true
  actionError.value = ''
  try {
    const summary = await deleteSpotComment(target, id)
    if (auth.context !== scope || props.target !== target) return
    confirmOpen.value = false
    items.value = items.value.filter(item => item.id !== id)
      .map(item => item.reply_to_id === id ? { ...item, reply_to: null } : item)
    if (reply.value?.id === id) reply.value = undefined
    total.value = summary.comments
    emit('summary', summary)
    notice.value = '评论已删除'
  } catch (cause) {
    if (auth.context === scope && props.target === target) actionError.value = errorText(cause)
  } finally {
    if (auth.context === scope && props.target === target) busy.value = false
  }
}
</script>

<template>
  <MobileBottomSheet v-model="open" title="钓位评论" close-label="关闭钓位评论" root-portal :z-index="140"
    :busy="busy" tall :keyboard-height="keyboardHeight" initial-focus=".mobile-sheet__close">
    <view class="spot-discussion">
      <view class="spot-discussion__context">
        <text class="name spot-discussion__title" role="heading" aria-level="3">{{ title }}</text>
        <text v-if="total !== undefined" class="caption">{{ total }} 条评论<template v-if="total > 1"> · 最新在前</template></text>
      </view>
      <DiscussionLikes v-if="open && likes" :target="target" :count="likes" />
      <MobileLoadError v-if="error" inline :message="error" title="评论暂时无法更新" @retry="load()" />
      <FishingLoadingStatus v-if="loading && !items.length" label="正在读取评论…" bare />
      <text v-else-if="!items.length && !error" class="muted">还没有评论，聊聊你的经验。</text>
      <DiscussionComment v-for="item in items" :key="item.id" :item="item" can-reply :disabled="busy"
        :reply-label="`回复${item.author?.nickname || '钓友'}的评论`" media-label="评论图片" @reply="selectReply(item)">
        <template v-if="item.own" #management>
          <MobileAction class="text-action" :disabled="busy || loading"
            aria-label="删除自己的评论" @click="askRemove(item.id)">删除</MobileAction>
        </template>
      </DiscussionComment>
      <!-- #ifdef H5 -->
      <span v-if="next" ref="end" class="spot-discussion__end" aria-hidden="true" />
      <!-- #endif -->
      <!-- #ifdef MP-WEIXIN -->
      <view v-if="next" class="spot-discussion__end" aria-hidden="true" />
      <!-- #endif -->
      <MobileListFooter :loading="loading && (!!items.length || !!next)" :error="pageError"
        :can-load-more="!!next && !busy && !error" :finished="!next && !loading && !error"
        :count="items.length" :total="total" loading-label="正在加载更多评论…"
        error-title="更多评论暂未加载" @more="load(true)" />
    </view>
    <template #footer>
      <view class="spot-discussion__composer">
        <MobileCommentComposer :busy="busy && !confirmOpen" :disabled="busy" :send-disabled="!canSend"
          :media-disabled="uploader?.choosing || media.length >= 6" :show-camera="showCamera" attachment-label="添加图片"
          :send-label="reply ? '发表回复' : '发表评论'" :emoji-open="emojiOpen" :emoji-trigger-id="emojiTrigger"
          @camera="chooseMedia('camera')" @media="chooseMedia('album')" @emoji="showEmoji" @send="submit">
          <template v-if="reply" #reply>
            <view class="spot-discussion__reply">
              <text class="spot-discussion__excerpt">{{ reply.body || '[图片]' }}</text>
              <MobileAction class="text-action" :disabled="busy" @click="cancelReply">取消回复</MobileAction>
            </view>
          </template>
          <MobileField v-model="draft" :field="field" :label="reply ? '回复 ' + (reply.author?.nickname || '钓友') : '写一条评论'" multiline :focus="focus"
            :maxlength="500" :disabled="busy" :placeholder="reply ? '写回复…' : '分享有用的经验，友善交流'" />
          <template v-if="auth.signedIn" #attachments>
            <MobileMediaUploader ref="uploader" v-model="media" :scope="`${auth.context}:${target}`" :active="open"
              :accept="['image']" :limit="6" :upload-image="uploadPhoto" :camera-picker="chooseCommentCamera"
              :error-text="errorText" :recovery="uploadRecovery" :disabled="busy" compact hide-add-button
              @change="actionError = ''" />
          </template>
          <template v-if="draft.length || media.length" #meta><text v-if="media.length">图片 {{ media.length }}/6</text><text v-if="draft.length">{{ draft.length }}/500</text></template>
        </MobileCommentComposer>
        <text v-if="notice" class="caption" role="status">{{ notice }}</text>
        <text v-if="actionError && !confirmOpen" class="error" role="alert">{{ actionError }}</text>
      </view>
    </template>
    <template #overlay>
      <MobileEmojiPicker v-model="emojiOpen" :trigger-id="emojiTrigger" @select="insertEmoji" />
      <MobileConfirmDialog v-model="confirmOpen" title="删除这条评论？" message="删除后无法恢复。"
        confirm-text="删除评论" keep-open-on-confirm :busy="busy" @confirm="remove">
        <text v-if="actionError" class="error" role="alert">{{ actionError }}</text>
      </MobileConfirmDialog>
    </template>
  </MobileBottomSheet>
</template>

<style scoped>
.spot-discussion, .spot-discussion__composer {
  display: grid;
  min-width: 0;
  gap: 8px;
  overflow-wrap: anywhere;
}
.spot-discussion { padding: 12px 16px 16px; gap: 4px; }
.spot-discussion__context { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.spot-discussion__context .caption { flex-shrink: 0; }
.spot-discussion__title { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.spot-discussion__reply {
  min-width: 0;
  padding-inline-start: 10px;
  border-inline-start: 2px solid var(--line);
  color: var(--reed);
}
.spot-discussion__excerpt { min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: .875rem; }
.spot-discussion__reply { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.spot-discussion__reply .text-action { flex: none; }
.spot-discussion__composer {
  --mobile-comment-input-height: clamp(46px, calc(var(--mobile-sheet-viewport-height, 100vh) * .11), 84px);
  max-height: 46vh;
  max-height: min(46vh, calc(var(--mobile-sheet-viewport-height, 100dvh) * .50));
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
}
.spot-discussion__composer :deep(.mobile-comment-composer__attachments) { max-height: min(14vh, 104px); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; }
.spot-discussion__composer::-webkit-scrollbar { display: none; }
.spot-discussion__end { display: block; height: 1px; }
</style>
