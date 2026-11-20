<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, ref, watch } from 'vue'
import { onLoad, onUnload, onReady, onResize } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import FishingLoadingStatus from '@/components/FishingLoadingStatus.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileBottomSheet from '@mobile-core/components/MobileBottomSheet.vue'
import ChatMessageContent from '@/components/ChatMessageContent.vue'
import { useVisibleViewport } from '@mobile-core/visible-viewport'
import { useNativeFieldAttributes } from '@mobile-core/form-focus'
import { useAuthStore } from '@/stores/auth'
import { createId, errorText } from '@/domain/rules'
import { read, write } from '@/services/repository'
import { choosePhotos, uploadPhoto, canRetryPhoto } from '@/services/media'
import { chatMessages, clearMessageContent } from '@/services/chat'
import { isDemo } from '@/config'
import { assertSession } from '@/services/session'
import { onSocialUpdate } from '@/services/live-updates'
import { appForeground } from '@/services/app-activity'
import { usePageActivity } from '@mobile-core/page-activity'
import { messageStatus } from '@/domain/message-status'
import type { Message, Conversation, SocialSnapshot } from '@/domain/models'
const auth = useAuthStore(),
  id = ref(''),
  conversation = ref<Conversation | null>(null),
  messages = ref<Message[]>([]),
  draft = ref(''),
  error = ref(''),
  sending = ref(false),
  target = ref(''),
  following = ref(true),
  newCount = ref(0),
  syncing = ref(false)
const photoOpen = ref(false),
  photo = ref(''),
  choosing = ref(false),
  photoError = ref('')
const viewport = useVisibleViewport()
const composer = useNativeFieldAttributes(() => ({
  id: 'chat-message-input',
  name: 'chat-message',
  'aria-label': '发送给钓友的消息',
  'aria-describedby': 'chat-message-count',
  autocomplete: 'off'
}))
const hasEarlier = ref(false),
  olderLoading = ref(false)
let lastRead = 0,
  readTimer: ReturnType<typeof setTimeout> | undefined
const instance = getCurrentInstance(),
  layoutTop = ref(0),
  screenHeight = ref(uni.getWindowInfo().windowHeight),
  keyboardHeight = ref(0)
// The composer occupies the space BELOW the shared header, not the full visual viewport.
const viewportStyle = computed(() =>
  layoutTop.value
    ? {
        height: `${Math.max(100, (viewport.value ? viewport.value.top + viewport.value.height : screenHeight.value - keyboardHeight.value) - layoutTop.value)}px`
      }
    : undefined
)
function measure() {
  // #ifdef H5
  screenHeight.value = window.innerHeight
  // #endif
  uni
    .createSelectorQuery()
    .in(instance?.proxy)
    .select('.chat-layout')
    .boundingClientRect((result) => {
      const rect = Array.isArray(result) ? result[0] : result
      if (typeof rect?.top === 'number') layoutTop.value = rect.top
    })
    .exec()
}
onReady(() => {
  measure()
  // #ifdef H5
  window.addEventListener('resize', measure)
  let observer: ResizeObserver | undefined
  const root = instance?.proxy?.$el as HTMLElement | undefined
  if (root?.querySelector && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure)
    observer.observe(root)
    root.querySelectorAll('.top-bar, .session-notice').forEach((node) => observer!.observe(node))
  }
  disposeResize = () => {
    observer?.disconnect()
    window.removeEventListener('resize', measure)
  }
  // #endif
})
let disposeResize = () => {}
onUnload(() => disposeResize())
onResize((event) => {
  if (event.size) screenHeight.value = event.size.windowHeight
  nextTick(measure)
})
watch(viewport, () => nextTick(measure))
// #ifdef MP-WEIXIN
const keyboardChanged = (event: { height: number }) => {
  keyboardHeight.value = event.height
}
uni.onKeyboardHeightChange(keyboardChanged)
onUnload(() => uni.offKeyboardHeightChange(keyboardChanged))
// #endif
let draftOwner = auth.userId,
  restoringDraft = false
const draftKey = () => `dyj.${isDemo ? 'demo' : 'live'}.chat.${draftOwner}.${id.value}`
let active = false,
  poll: ReturnType<typeof setInterval> | undefined,
  version = 0,
  olderVersion = 0
let stopLive: (() => void) | undefined,
  syncAgain = false,
  reading = false
onLoad((options) => {
  id.value = options?.id || ''
  draft.value = uni.getStorageSync(draftKey()) || ''
})
watch(draft, () => {
  if (auth.userId === draftOwner && draftOwner && id.value && !restoringDraft)
    try {
      uni.setStorageSync(draftKey(), draft.value)
    } catch {
      error.value = '设备未能保存聊天草稿，请检查存储空间'
    }
})
watch(
  () => auth.context,
  () => {
    version++
    olderVersion++
    clearTimeout(readTimer)
    conversation.value = null
    messages.value = []
    hasEarlier.value = false
    olderLoading.value = false
    sending.value = false
    syncing.value = false
    syncAgain = false
    reading = false
    lastRead = 0
    newCount.value = 0
    following.value = true
    error.value = ''
    photoOpen.value = false
    photo.value = ''
    photoError.value = ''
    choosing.value = false
    restoringDraft = true
    draftOwner = auth.userId
    try {
      draft.value = draftOwner ? String(uni.getStorageSync(draftKey()) || '') : ''
    } catch {
      draft.value = ''
    }
    void nextTick(() => {
      restoringDraft = false
    })
    if (active) void sync()
  },
  { flush: 'sync' }
)
function start() {
  active = true
  stopLive?.()
  stopLive = onSocialUpdate(() => {
    if (!active) return
    if (syncing.value) syncAgain = true
    else void sync()
  })
  void sync()
  clearInterval(poll)
  poll = setInterval(() => void sync(), 5000)
}
function stop() {
  active = false
  stopLive?.()
  stopLive = undefined
  syncAgain = false
  version++
  olderVersion++
  olderLoading.value = false
  clearInterval(poll)
  clearTimeout(readTimer)
  poll = undefined
  syncing.value = false
  messages.value = clearMessageContent(messages.value)
}
usePageActivity(appForeground, start, stop)
async function latest() {
  const scope = auth.context
  following.value = true
  newCount.value = 0
  target.value = ''
  await nextTick()
  if (scope !== auth.context) return
  target.value = 'chat-end'
  clearTimeout(readTimer)
  readTimer = setTimeout(readIfVisible, 150)
}
function readIfVisible() {
  if (!active || !following.value) return
  const scope = auth.context
  const query = uni.createSelectorQuery().in(instance?.proxy)
  query.select('.chat-scroll').boundingClientRect()
  query.select('#chat-end').boundingClientRect()
  query.exec((results) => {
    if (!active || !following.value || scope !== auth.context) return
    const [viewport, end] = results
    if (viewport && end && end.top >= viewport.top && end.bottom <= viewport.bottom + 2)
      void markRead()
  })
}
async function earlier() {
  if (olderLoading.value || !hasEarlier.value) return
  olderLoading.value = true
  const current = ++olderVersion,
    first = messages.value.find((m) => !m.delivery)
  try {
    const received = await chatMessages('messages', { id: id.value, before: first?.sequence })
    if (!active || current !== olderVersion) return
    following.value = false
    const known = new Set(messages.value.map((m) => m.id))
    messages.value = [...received.filter((m) => !known.has(m.id)), ...messages.value]
    hasEarlier.value = received.length === 100
    target.value = ''
    await nextTick()
    if (first) target.value = `message-${first.id}`
  } catch (e) {
    if (current === olderVersion) error.value = errorText(e)
  } finally {
    if (current === olderVersion) olderLoading.value = false
  }
}
async function sync() {
  if (!active || !id.value || !auth.signedIn || syncing.value) return
  const current = ++version
  syncing.value = true
  try {
    const social = await read<SocialSnapshot>('social')
    if (!active || current !== version) return
    conversation.value = social.conversations.find((c) => c.id === id.value) || null
    if (!conversation.value) throw new Error('你无权读取这个会话')
    const persisted = messages.value.filter((m) => !m.delivery)
    const after = Math.max(0, ...persisted.map((m) => m.sequence))
    const received = await chatMessages(
      'messages',
      {
        id: id.value,
        ...(persisted.length ? { after } : {})
      },
      messages.value
    )
    if (!active || current !== version) return
    // Refresh existing references too: an empty incremental page does not mean permissions are unchanged.
    const attached = persisted.filter((m) => m.kind && m.kind !== 'text')
    const refreshed: Message[] = []
    for (let offset = 0; offset < attached.length; offset += 100) {
      const batch = attached.slice(offset, offset + 100)
      refreshed.push(
        ...(await chatMessages(
          'message_content',
          {
            id: id.value,
            ids: batch.map((m) => m.id)
          },
          batch
        ))
      )
      if (!active || current !== version) return
    }
    if (!persisted.length) hasEarlier.value = received.length === 100
    const byClient = new Map(messages.value.map((m) => [`${m.sender_id}:${m.client_id}`, m]))
    // Missing projections are cleared, rather than retaining a formerly authorized preview.
    const refreshedIds = new Set(refreshed.map((m) => m.id))
    for (const message of clearMessageContent(attached.filter((m) => !refreshedIds.has(m.id))))
      byClient.set(`${message.sender_id}:${message.client_id}`, message)
    for (const message of [...refreshed, ...received])
      byClient.set(`${message.sender_id}:${message.client_id}`, message)
    messages.value = [...byClient.values()].sort((a, b) =>
      a.delivery ? 1 : b.delivery ? -1 : a.sequence - b.sequence
    )
    if (received.length) {
      if (following.value) await latest()
      else newCount.value += received.length
    }
    error.value = ''
    readIfVisible()
  } catch (e) {
    if (active && current === version) {
      messages.value = clearMessageContent(messages.value)
      error.value = errorText(e)
    }
  } finally {
    if (current === version) {
      syncing.value = false
      if (syncAgain && active) {
        syncAgain = false
        void sync()
      }
    }
  }
}
async function markRead() {
  following.value = true
  newCount.value = 0
  if (!active || !auth.signedIn || reading) return
  // #ifdef H5
  if (document.visibilityState !== 'visible') return
  // #endif
  const sequence = Math.max(0, ...messages.value.filter((m) => !m.delivery).map((m) => m.sequence))
  const scope = auth.context
  if (sequence > lastRead) {
    reading = true
    try {
      await write('read_conversation', { id: id.value, sequence })
      if (scope === auth.context) lastRead = Math.max(lastRead, sequence)
    } catch {
      /* next foreground sync retries without changing message data */
    } finally {
      if (scope === auth.context) reading = false
    }
  }
}
async function choosePhoto(source: 'camera' | 'album') {
  if (choosing.value || sending.value || !conversation.value?.can_send) return
  choosing.value = true
  photoError.value = ''
  const scope = auth.context
  try {
    const paths = await choosePhotos(1, source)
    if (scope === auth.context && paths[0]) photo.value = paths[0]
  } catch (e) {
    if (scope === auth.context) photoError.value = errorText(e)
  } finally {
    if (scope === auth.context) choosing.value = false
  }
}
async function send(retry?: Message, image = false) {
  const scope = auth.context
  if (sending.value || !conversation.value?.can_send || !auth.requireLogin()) return
  const kind = retry?.kind || (image ? 'image' : 'text')
  const body = retry?.body || (kind === 'image' ? '[图片]' : draft.value.trim())
  if (!body || (image && !photo.value)) return
  sending.value = true
  error.value = ''
  const pending: Message = retry || {
    id: createId(),
    conversation_id: id.value,
    sender_id: auth.userId,
    client_id: createId(),
    sequence: Number.MAX_SAFE_INTEGER,
    body,
    kind,
    ...(image ? { localPhoto: photo.value } : {}),
    created_at: new Date().toISOString(),
    delivery: 'sending'
  }
  if (!retry) {
    messages.value.push(pending)
    if (image) {
      photo.value = ''
      photoOpen.value = false
    } else draft.value = ''
  } else {
    pending.delivery = 'sending'
    pending.error = ''
  }
  try {
    await latest()
    assertSession(scope)
    if (pending.kind === 'image' && !pending.media?.length) {
      if (!pending.localPhoto) throw new Error('照片暂不可用，请重新选择')
      const asset = await uploadPhoto(pending.localPhoto)
      assertSession(scope)
      pending.media = [{ ...asset, url: pending.localPhoto }]
      messages.value = [...messages.value]
    }
    const confirmed = await write<Message>('send_message', {
      conversation_id: id.value,
      client_id: pending.client_id,
      body,
      kind,
      ...(pending.kind === 'image' ? { media_id: pending.media?.[0]?.id } : {})
    })
    const index = messages.value.findIndex(
      (m) => m.client_id === pending.client_id && m.sender_id === auth.userId
    )
    if (index >= 0) messages.value.splice(index, 1, confirmed)
    await latest()
  } catch (e) {
    if (scope !== auth.context) return
    pending.delivery = 'failed'
    pending.error = errorText(e)
    pending.retryable =
      canRetryPhoto(e) &&
      !(
        e &&
        typeof e === 'object' &&
        'code' in e &&
        ['PHOTO_NOT_AVAILABLE', 'FORBIDDEN'].includes(String(e.code))
      )
    messages.value = [...messages.value]
  } finally {
    if (scope === auth.context) sending.value = false
  }
}
function scrolled(event: { detail: { scrollTop: number; scrollHeight: number } }) {
  if (event.detail.scrollTop < lastScroll - 6) following.value = false
  lastScroll = event.detail.scrollTop
}
function replacePhoto(message: Message) {
  if (message.delivery !== 'failed') return
  messages.value = messages.value.filter((m) => m !== message)
  photo.value = ''
  photoOpen.value = true
}
let lastScroll = 0
</script>
<template>
  <FishingShell :title="conversation?.peer.nickname || '钓友聊天'" back edge-to-bottom>
    <view class="chat-layout" :style="viewportStyle">
      <MobileAction v-if="!auth.signedIn" class="primary" @click="auth.requireLogin()"
        >登录后查看聊天</MobileAction
      >
      <MobileLoadError v-if="error" inline :message="error" @retry="sync" />
      <FishingLoadingStatus v-if="syncing && !conversation" label="正在读取聊天记录…" />
      <scroll-view
        class="chat-scroll"
        scroll-y
        :scroll-into-view="target"
        @scroll="scrolled"
        @scrolltolower="markRead"
      >
        <view
          class="chat-thread"
          role="log"
          aria-label="聊天记录"
          aria-live="polite"
          aria-relevant="additions"
        >
          <text class="caption chat-note">{{
            isDemo ? '本机体验会话，不会发送给真实用户。' : '仅好友可发送新消息。'
          }}</text>
          <MobileAction
            v-if="hasEarlier"
            class="text-action"
            :disabled="olderLoading"
            @click="earlier"
            >{{ olderLoading ? '正在读取…' : '查看更早的消息' }}</MobileAction
          >
          <view
            v-for="message in messages"
            :key="message.client_id"
            :id="`message-${message.id}`"
            class="chat-turn"
            :class="{ 'chat-turn--mine': message.sender_id === auth.userId }"
            ><ChatMessageContent :message="message" :mine="message.sender_id === auth.userId" />
            <text v-if="message.sender_id === auth.userId" class="caption">{{
              messageStatus(message, conversation)
            }}</text
            ><text
              v-if="message.delivery === 'failed' && message.error"
              class="error chat-send-error"
              role="alert"
              >{{ message.error }}</text
            >
            <MobileAction
              v-if="message.delivery === 'failed' && message.retryable !== false"
              class="text-action"
              :disabled="sending || !conversation?.can_send"
              @click="send(message)"
              >重试这条消息</MobileAction
            >
            <MobileAction
              v-if="
                message.delivery === 'failed' &&
                message.retryable === false &&
                message.kind === 'image' &&
                conversation?.can_send
              "
              class="text-action"
              @click="replacePhoto(message)"
              >重新选择可发送的照片</MobileAction
            >
          </view>
          <view id="chat-end" style="height: 1px" />
        </view>
      </scroll-view>
      <view class="chat-composer"
        ><MobileAction v-if="newCount || !following" class="text-action" @click="latest"
          >{{ newCount ? `${newCount} 条新消息 · ` : '' }}查看最新</MobileAction
        ><text v-if="conversation && !conversation.can_send" class="notice"
          >当前不能发送新消息，重新成为好友后可继续。</text
        ><view class="row">
          <MobileAction
            class="secondary chat-photo-button"
            :disabled="sending || !conversation?.can_send"
            @click="photoOpen = true"
            >照片</MobileAction
          >
          <textarea
            ref="composer"
            :key="auth.context"
            v-model="draft"
            class="chat-input"
            auto-height
            :maxlength="2000"
            :adjust-position="false"
            aria-label="发送给钓友的消息"
            aria-describedby="chat-message-count"
            placeholder="输入消息…"
            :disabled="!conversation?.can_send"
          /><MobileAction
            class="primary"
            :disabled="sending || !draft.trim() || !conversation?.can_send"
            @click="send()"
            >发送</MobileAction
          ></view
        ><text id="chat-message-count" class="caption"
          >{{ draft.length }}/2000{{ syncing ? ' · 正在更新消息…' : '' }}</text
        ></view
      >
    </view>
    <MobileBottomSheet
      v-if="auth.signedIn"
      v-model="photoOpen"
      title="发送照片"
      close-label="关闭照片选择"
      :busy="choosing || sending"
    >
      <view class="stack fishing-sheet-content">
        <image
          v-if="photo"
          class="photo-preview"
          :src="photo"
          mode="aspectFit"
          aria-label="待发送照片预览"
        />
        <text class="caption"
          >压缩上传副本并去除位置元数据。发送后会话双方可查看，退出页面前请完成发送。</text
        >
        <view class="row photo-actions">
          <MobileAction
            class="secondary"
            :disabled="choosing || sending"
            @click="choosePhoto('album')"
            >{{ photo ? '重新选照片' : '从相册选择' }}</MobileAction
          >
          <MobileAction
            class="secondary"
            :disabled="choosing || sending"
            @click="choosePhoto('camera')"
            >拍一张</MobileAction
          >
        </view>
        <text v-if="photoError" class="error" role="alert">{{ photoError }}</text>
        <MobileAction
          v-if="photo"
          class="primary"
          :disabled="choosing || sending || !conversation?.can_send"
          @click="send(undefined, true)"
          >发送这张照片</MobileAction
        >
      </view>
    </MobileBottomSheet>
  </FishingShell>
</template>
<style scoped>
.chat-layout {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: calc(100dvh - 170px);
  padding: 12px var(--mobile-workspace-inset) 0;
}
.chat-scroll {
  flex: 1;
  min-height: 0;
  height: 100px;
}
.chat-thread {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 12px 0;
}
.chat-note {
  text-align: center;
}
.caption {
  font-size: max(14px, 0.875rem);
}
.chat-composer .mobile-action,
.fishing-sheet-content .mobile-action {
  font-size: max(16px, 1rem);
}
.chat-turn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
}
.chat-turn--mine {
  align-items: flex-end;
}
.chat-send-error {
  max-width: 88%;
  font-size: max(14px, 0.875rem);
}
.chat-composer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 0 max(8px, var(--mobile-safe-bottom));
  border-top: 1px solid var(--line);
}
.chat-input {
  width: 100%;
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  min-height: 48px;
  max-height: 140px;
  padding: 12px;
  border-radius: 14px;
  background: var(--inset);
  font-size: max(16px, 1rem);
  line-height: 1.5;
  color: var(--ink);
}
.chat-input:focus-within {
  outline: 2px solid var(--lake);
  outline-offset: 2px;
}
.chat-composer > .row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: flex-end;
}
.chat-photo-button.mobile-action {
  padding-inline: 10px;
  flex: none;
}
.photo-preview {
  display: block;
  width: 100%;
  height: 200px;
  border-radius: 12px;
  background: var(--inset);
}
.photo-actions {
  flex-wrap: wrap;
}
@media (max-width: 360px) {
  .chat-composer > .row {
    grid-template-columns: 1fr 1fr;
  }
  .chat-input {
    order: -1;
    grid-column: 1 / -1;
    width: 100%;
  }
  .chat-photo-button {
    justify-self: start;
  }
  .chat-composer > .row > .primary {
    justify-self: end;
  }
}
</style>
