<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onLoad, onReachBottom } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import DiscussionAvatar from '@/components/DiscussionAvatar.vue'
import FishingLoadingStatus from '@/components/FishingLoadingStatus.vue'
import FishingEmptyState from '@/components/FishingEmptyState.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileSegmented from '@mobile-core/components/MobileSegmented.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileListFooter from '@mobile-core/components/MobileListFooter.vue'
import MobileBottomSheet from '@mobile-core/components/MobileBottomSheet.vue'
import { usePageActivity } from '@mobile-core/page-activity'
import { useAuthStore } from '@/stores/auth'
import { isDemo } from '@/config'
import { appForeground } from '@/services/app-activity'
import { onSocialUpdate } from '@/services/live-updates'
import { notifications } from '@/services/notifications'
import { isTransientRequestError } from '@/services/http'
import { errorText, relativeTime } from '@/domain/rules'
import {
  notificationSections,
  notificationCount,
  notificationUrl,
  hasNewNotification,
  refreshNotifications,
  type NotificationCategory,
  type NotificationCounts,
  type NotificationPreferences,
  type NotificationPage,
  type NotificationRefresh,
  type InboxNotification
} from '@/domain/notifications'

const auth = useAuthStore(),
  category = ref<NotificationCategory>('interaction')
const items = ref<InboxNotification[]>([]),
  next = ref<string | null>(null)
const summary = ref<NotificationCounts>({ interaction: 0, system: 0 })
const preferences = ref<NotificationPreferences | null>(null),
  settingsOpen = ref(false)
const operation = ref(''),
  error = ref(''),
  moreError = ref(''),
  status = ref(''),
  hasNew = ref(false)
const unread = computed(() => items.value.some((item) => !item.read && item.available))
const busy = computed(() => !!operation.value && operation.value !== 'refresh')
let active = false,
  version = 0,
  showSettings = false,
  firstId: string | undefined
let poll: ReturnType<typeof setInterval> | undefined, stopLive: (() => void) | undefined
onReachBottom(() => {
  if (!error.value && !moreError.value && !settingsOpen.value) void load(true)
})
function clear() {
  version++
  items.value = []
  next.value = null
  firstId = undefined
  summary.value = { interaction: 0, system: 0 }
  preferences.value = null
  operation.value = ''
  error.value = ''
  moreError.value = ''
  status.value = ''
  hasNew.value = false
}
async function run(name: string, task: (current: () => boolean) => Promise<void>) {
  if (operation.value === 'refresh' && name !== 'refresh') {
    version++
    operation.value = ''
  }
  if (!active || !auth.signedIn || isDemo || operation.value) return
  const currentVersion = version
  operation.value = name
  error.value = ''
  if (name === 'more' || name === 'page') moreError.value = ''
  const current = () => active && currentVersion === version
  try {
    await task(current)
  } catch (e) {
    if (!current()) return
    if (name === 'more' && isTransientRequestError(e)) {
      moreError.value = errorText(e)
      return
    }
    // Never leave private previews on screen after reauthorization fails.
    items.value = []
    next.value = null
    summary.value = { interaction: 0, system: 0 }
    preferences.value = null
    error.value = errorText(e)
  } finally {
    if (current()) operation.value = ''
  }
}
async function load(more = false) {
  if (more && !next.value) return
  await run(more ? 'more' : 'page', async (current) => {
    const [result, prefs] = await Promise.all([
      notifications<NotificationPage>('page', {
        category: category.value,
        cursor: more ? next.value : null
      }),
      notifications<NotificationPreferences>('preferences')
    ])
    if (!current()) return
    const merged = more ? [...items.value, ...result.items] : result.items
    items.value = merged.filter(
      (item, index) => merged.findIndex((other) => other.id === item.id) === index
    )
    next.value = result.next
    summary.value = result.summary
    preferences.value = prefs
    if (!more) {
      firstId = result.items[0]?.id
      hasNew.value = false
      status.value = ''
    }
  })
}
async function refresh(markRead = false) {
  if (error.value) return
  await run(markRead ? 'read' : 'refresh', async (current) => {
    const section = category.value
    const ids = items.value.map(item => item.id)
    const action = markRead ? 'mark_read' : 'refresh'
    const [result, prefs] = await Promise.all([
      notifications<NotificationRefresh>(action, { category: section, ids: ids.slice(0, 200) }),
      notifications<NotificationPreferences>('preferences')
    ])
    if (!current()) return
    for (let offset = 200; offset < ids.length; offset += 200) {
      const part = await notifications<NotificationRefresh>(action, { category: section, ids: ids.slice(offset, offset + 200) })
      if (!current()) return
      result.items.push(...part.items)
      result.summary = part.summary
      result.latest = part.latest
    }
    items.value = refreshNotifications(items.value, result.items)
    summary.value = result.summary
    preferences.value = prefs
    hasNew.value = hasNewNotification(result.latest, firstId)
    if (markRead) status.value = '已显示的通知已标为已读'
  })
}
async function open(item: InboxNotification) {
  await run('open', async (current) => {
    const fresh = await notifications<InboxNotification>('open', { id: item.id })
    if (!current()) return
    items.value = items.value.map((row) => (row.id === fresh.id ? fresh : row))
    const url = notificationUrl(fresh)
    if (!url) {
      status.value = '内容已不可见，没有打开旧内容'
      return
    }
    uni.navigateTo({
      url,
      fail: () => {
        if (current()) error.value = '页面未能打开，请重试'
      }
    })
  })
}
async function preference(key: keyof NotificationPreferences) {
  if (!preferences.value) return
  const enabled = !preferences.value[key]
  status.value = ''
  await run('preference', async (current) => {
    const result = await notifications<NotificationPreferences>('set_preference', { key, enabled })
    if (!current()) return
    preferences.value = result
    status.value = `${key === 'likes' ? '点赞' : '评论与回复'}提醒已${enabled ? '开启' : '关闭'}`
  })
}
function change(value: NotificationCategory) {
  category.value = value
  clear()
  void load()
}
function start() {
  active = true
  clear()
  if (showSettings && auth.signedIn && !isDemo) {
    settingsOpen.value = true
    showSettings = false
  }
  void load()
  stopLive = onSocialUpdate(() => void refresh())
  poll = setInterval(() => void refresh(), 10000)
}
function stop() {
  active = false
  stopLive?.()
  stopLive = undefined
  clearInterval(poll)
  poll = undefined
  settingsOpen.value = false
  clear()
}
usePageActivity(appForeground, start, stop)
watch(
  () => auth.context,
  () => {
    settingsOpen.value = false
    clear()
    if (active) void load()
  },
  { flush: 'sync' }
)
onLoad((options) => {
  showSettings = options?.settings === '1'
})
</script>
<template>
  <FishingShell title="通知" back>
    <view class="fishing-content notification-content stack">
      <FishingEmptyState
        v-if="!auth.signedIn"
        icon="message"
        title="登录后查看通知"
        description="点赞、评论与处理结果，只向你展示。"
      >
        <MobileAction class="primary" @click="auth.requireLogin()">登录</MobileAction>
      </FishingEmptyState>
      <FishingEmptyState
        v-else-if="isDemo"
        icon="message"
        title="本机体验不产生真实通知"
        description="登录线上账号后，这里会展示你的互动和处理结果。"
      />
      <template v-else>
        <MobileSegmented
          label="通知分类"
          :model-value="category"
          :options="notificationSections"
          @update:model-value="change"
        />
        <view class="row row--between row--wrap">
          <text class="caption"
            >{{ category === 'interaction' ? '互动' : '系统' }} ·
            {{ notificationCount(summary[category]) }} 条未读</text
          >
          <MobileAction class="text-action" @click="settingsOpen = true">通知设置</MobileAction>
        </view>
        <MobileAction v-if="hasNew" class="secondary" :disabled="busy" @click="load()"
          >有新通知，刷新查看</MobileAction
        >
        <MobileLoadError v-if="error" title="通知未能更新" :message="error" @retry="load()" />
        <FishingLoadingStatus
          v-if="operation === 'page'"
          label="正在读取通知…"
        />
        <view v-if="items.length" class="panel inbox-list">
          <template v-for="item in items" :key="item.id">
            <MobileAction
              v-if="item.available"
              class="inbox-row list-row"
              :disabled="busy"
              @click="open(item)"
            >
              <DiscussionAvatar v-if="item.actor && item.category === 'interaction'" :person="item.actor" />
              <view class="grow stack stack--tight">
                <view class="row row--between row--wrap">
                  <text class="name inbox-text">{{ item.title }}</text>
                  <text class="caption">{{ relativeTime(item.created_at) }}</text>
                </view>
                <text class="muted inbox-text">{{ item.preview }}</text>
                <text v-if="!item.read" class="inbox-unread">未读</text>
              </view>
              <MobileIcon name="chevron" :size="16" />
            </MobileAction>
            <view v-else class="inbox-row list-row">
              <view class="stack stack--tight"
                ><text class="caption">{{ relativeTime(item.created_at) }}</text
                ><text class="name">内容已不可见</text
                ><text class="muted">内容或关系已变化，不再展示原信息。</text></view
              >
            </view>
          </template>
        </view>
        <FishingEmptyState
          v-else-if="!error && !hasNew && !next && operation !== 'page' && operation !== 'more'"
          icon="message"
          :title="category === 'interaction' ? '还没有互动通知' : '还没有系统通知'"
          :description="
            category === 'interaction'
              ? '新的点赞和评论回复会出现在这里。'
              : '内容审核、社区举报和禁钓提醒的处理结果会出现在这里。'
          "
        />
        <view class="mobile-action-group">
          <MobileAction class="text-action" :disabled="busy" @click="load()">刷新通知</MobileAction>
          <MobileAction v-if="unread" class="text-action" :disabled="busy" @click="refresh(true)"
            >已显示的标为已读</MobileAction
          >
        </view>
        <MobileListFooter :loading="operation === 'more'" :error="moreError"
          :can-load-more="!!next && !busy && !error && !settingsOpen"
          :finished="!next && !busy && !error" :count="items.length"
          loading-label="正在加载更早的通知…" more-text="加载更早的通知"
          error-title="更早的通知暂未加载" @more="load(true)" />
        <text
          v-if="status && !settingsOpen"
          class="caption"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          >{{ status }}</text
        >
        <text class="caption"
          >站内通知，暂不提供离线推送。处理结果记录当时的决定，打开后以内容当前状态为准。</text
        >
      </template>
    </view>
    <MobileBottomSheet v-model="settingsOpen" title="通知设置" close-label="关闭通知设置">
      <view class="notification-settings stack">
        <view v-if="preferences">
          <MobileAction
            class="list-row"
            :aria-pressed="preferences.likes"
            :disabled="busy"
            @click="preference('likes')"
            ><text class="grow name">点赞提醒</text
            ><text class="caption">{{
              preferences.likes ? '已开启' : '已关闭'
            }}</text></MobileAction
          >
          <MobileAction
            class="list-row"
            :aria-pressed="preferences.comments"
            :disabled="busy"
            @click="preference('comments')"
            ><text class="grow name">评论与回复</text
            ><text class="caption">{{
              preferences.comments ? '已开启' : '已关闭'
            }}</text></MobileAction
          >
        </view>
        <FishingLoadingStatus v-if="operation === 'preference'" label="正在保存设置…" />
        <MobileLoadError v-if="error" :message="error" @retry="load()" />
        <FishingLoadingStatus v-else-if="!preferences && !isDemo" label="正在读取设置…" />
        <text class="muted"
          >更改只影响之后的新通知，不删除已有记录。审核和举报结果仍会保留。</text
        >
        <text class="caption">这些开关只影响站内通知。</text>
        <text v-if="status" class="caption" role="status" aria-live="polite" aria-atomic="true">{{
          status
        }}</text>
      </view>
    </MobileBottomSheet>
  </FishingShell>
</template>
<style scoped>
.inbox-list {
  padding-block: 0;
}
.notification-settings {
  padding: 16px var(--mobile-workspace-inset, 16px) 24px;
}
/* These notification rows use this app's semantic surfaces even while disabled;
   uni-app's default button fill is a light surface in both appearances. */
.notification-content :deep(.mobile-action.text-action[disabled]),
.notification-content :deep(.mobile-action.inbox-row[disabled]),
.notification-settings :deep(.mobile-action.list-row[disabled]) {
  background: transparent;
  color: var(--reed);
}
.notification-content :deep(.mobile-action.secondary[disabled]) {
  background: var(--lake-soft);
  color: var(--lake);
}
.inbox-row {
  padding-block: 14px;
  text-align: start;
}
.inbox-row .name { color: var(--discussion-name); }
.inbox-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.inbox-unread {
  font-size: var(--fishing-caption-size);
  font-weight: 650;
  color: var(--lake);
}
</style>
