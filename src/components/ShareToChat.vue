<script setup lang="ts">
import { ref, watch } from 'vue'
import { onHide } from '@dcloudio/uni-app'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import { activateActionKey, preventActionKey } from '@mobile-core/action-keyboard'
import MobileBottomSheet from '@mobile-core/components/MobileBottomSheet.vue'
import FishingLoadingStatus from './FishingLoadingStatus.vue'
import { useAuthStore } from '@/stores/auth'
import { read, write } from '@/services/repository'
import { createId, errorText } from '@/domain/rules'
import type { Profile, SocialSnapshot } from '@/domain/models'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
const props = defineProps<{ id: string; type: 'post' | 'spot'; title: string; compact?: boolean }>()
const auth = useAuthStore(),
  open = ref(false),
  busy = ref(false),
  loading = ref(false),
  friends = ref<Profile[]>([]),
  selected = ref(''),
  error = ref(''),
  sent = ref('')
let version = 0
const keys = new Map<string, string>()
const conversations = new Map<string, string>()
function clear() {
  version++
  open.value = false
  busy.value = false
  loading.value = false
  friends.value = []
  selected.value = ''
  error.value = ''
  sent.value = ''
  keys.clear()
  conversations.clear()
}
watch(() => [props.id, auth.context], clear, { flush: 'sync' })
onHide(clear)
async function prepare() {
  if (!auth.requireLogin() || busy.value || loading.value) return
  open.value = true
  loading.value = true
  error.value = ''
  friends.value = []
  const current = ++version
  try {
    const social = await read<SocialSnapshot>('social')
    if (current !== version) return
    friends.value = social.friends
    if (!social.friends.some((f) => f.id === selected.value)) selected.value = ''
  } catch (e) {
    if (current === version) error.value = errorText(e)
  } finally {
    if (current === version) loading.value = false
  }
}
async function send() {
  if (busy.value || !selected.value) return
  const current = version,
    peer = selected.value
  busy.value = true
  error.value = ''
  if (!keys.has(peer)) keys.set(peer, createId())
  try {
    const conversation =
      conversations.get(peer) || (await write<string>('conversation', { id: peer }))
    if (current !== version) return
    conversations.set(peer, conversation)
    await write('send_message', {
      conversation_id: conversation,
      client_id: keys.get(peer),
      kind: props.type,
      reference_id: props.id
    })
    if (current !== version) return
    sent.value = conversation
    open.value = false
    keys.delete(peer)
    selected.value = ''
  } catch (e) {
    if (current === version) error.value = errorText(e)
  } finally {
    if (current === version) busy.value = false
  }
}
</script>
<template>
  <view class="stack stack--tight">
    <MobileAction :class="compact ? 'text-action spot-tool-action' : 'secondary'" @click="prepare"
      ><MobileIcon v-if="compact" name="send" :size="18" />{{
        compact ? '发钓友' : '发给钓友'
      }}</MobileAction
    >
    <MobileAction
      v-if="sent"
      class="text-action"
      @click="uni.navigateTo({ url: `/pages/chat/index?id=${sent}` })"
      >已发送 · 查看聊天</MobileAction
    >
    <MobileBottomSheet
      v-if="auth.signedIn"
      v-model="open"
      title="发给钓友"
      close-label="关闭分享"
      :busy="busy"
    >
      <view class="stack fishing-sheet-content">
        <text class="name">{{ title }}</text>
        <text class="caption"
          >不改变原内容的可见范围；对方无权查看时无法发送。钓位卡片不附带定位坐标。</text
        >
        <FishingLoadingStatus v-if="loading" label="正在读取好友…" />
        <template v-else>
          <view
            v-if="friends.length"
            class="stack stack--tight"
            role="group"
            aria-label="选择接收好友"
          >
            <button
              v-for="friend in friends"
              :key="friend.id"
              class="mobile-action share-friend row row--between"
              role="button"
              :tabindex="busy ? -1 : 0"
              :aria-disabled="busy || undefined"
              hover-class="mobile-action--pressed"
              :class="{ 'share-friend--selected': selected === friend.id }"
              :aria-pressed="selected === friend.id"
              :disabled="busy"
              @click="selected = friend.id"
              @keydown="preventActionKey"
              @keyup="
                activateActionKey($event, () => {
                  if (!busy) selected = friend.id
                })
              "
            >
              <text>{{ friend.nickname }}</text
              ><text v-if="selected === friend.id" class="caption">已选择</text>
            </button>
          </view>
          <text v-else-if="!error" class="muted">还没有好友，先到消息页认识钓友。</text>
          <text v-if="error" class="error" role="alert">{{ error }}</text>
          <MobileAction v-if="error && !friends.length" class="secondary" @click="prepare"
            >重新读取好友</MobileAction
          >
          <MobileAction
            v-if="friends.length"
            class="primary"
            :disabled="busy || !selected"
            @click="send"
            >{{ busy ? '正在发送…' : '确认发送' }}</MobileAction
          >
        </template>
      </view>
    </MobileBottomSheet>
  </view>
</template>
<style scoped>
.name,
.mobile-action {
  font-size: max(16px, 1rem);
}
.caption {
  font-size: max(14px, 0.875rem);
}
.share-friend.mobile-action {
  padding: 12px 16px;
  border: 1px solid var(--line);
  color: var(--ink);
  border-radius: 12px;
  text-align: left;
}
.share-friend--selected.mobile-action {
  background: var(--lake-soft);
  border-color: var(--lake);
}
</style>
