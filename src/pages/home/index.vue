<script setup lang="ts">
import { computed, ref, nextTick, onMounted } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import FishMark from '@/components/FishMark.vue'
import MobileBottomNav from '@mobile-core/components/MobileBottomNav.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import FeedView from '@/components/FeedView.vue'
import SpotsView from '@/components/SpotsView.vue'
import MessagesView from '@/components/MessagesView.vue'
import MineView from '@/components/MineView.vue'
import { onSocialUpdate } from '@/services/live-updates'
import { appForeground } from '@/services/app-activity'
import { usePageActivity } from '@mobile-core/page-activity'
type Tab = 'feed' | 'spots' | 'messages' | 'mine'
const active = ref<Tab>('feed')
const titles: Record<Tab, string> = {
  feed: '钓友集',
  spots: '找钓位',
  messages: '消息',
  mine: '我的'
}
const title = computed(() => titles[active.value])
const tabs = [
  { key: 'feed', label: '钓友圈', icon: 'home', url: '/pages/home/index?tab=feed' },
  { key: 'spots', label: '找钓位', icon: 'location', url: '/pages/home/index?tab=spots' },
  { key: 'messages', label: '消息', icon: 'message', url: '/pages/home/index?tab=messages' },
  { key: 'mine', label: '我的', icon: 'user', url: '/pages/home/index?tab=mine' }
]
const feed = ref<InstanceType<typeof FeedView>>(),
  spots = ref<InstanceType<typeof SpotsView>>(),
  messages = ref<InstanceType<typeof MessagesView>>(),
  mine = ref<InstanceType<typeof MineView>>()
let poll: ReturnType<typeof setInterval> | undefined
let stopLive: (() => void) | undefined
async function change(tab: string) {
  if (!(tab in titles)) return
  active.value = tab as Tab
  // #ifdef H5
  const next = new URL(window.location.href)
  next.hash = `/pages/home/index?tab=${tab}`
  window.history.replaceState(window.history.state, '', next)
  // #endif
  await nextTick()
  refresh()
  uni.pageScrollTo({ scrollTop: 0, duration: 0 })
}
// Same-page hash links do not re-run Uni's onLoad. Keep deep links and browser
// history aligned with the selected tab without remounting the whole app.
// #ifdef H5
function syncRouteTab() {
  const [path, query] = window.location.hash.slice(1).split('?')
  if (path !== '/pages/home/index') return
  const tab = new URLSearchParams(query).get('tab') || 'feed'
  if (tab in titles && tab !== active.value) void change(tab)
}
onMounted(() => window.addEventListener('hashchange', syncRouteTab))
onUnload(() => window.removeEventListener('hashchange', syncRouteTab))
// #endif
function refresh() {
  ;({ feed: feed.value, spots: spots.value, messages: messages.value, mine: mine.value })[
    active.value
  ]?.refresh()
}
onLoad((options) => {
  if (options?.tab && options.tab in titles) active.value = options.tab as Tab
})
usePageActivity(
  appForeground,
  () => {
    stopLive?.()
    stopLive = onSocialUpdate(() => {
      if (active.value === 'messages') refresh()
    })
    refresh()
    clearInterval(poll)
    poll = setInterval(() => {
      if (active.value === 'messages') refresh()
    }, 10000)
  },
  () => {
    stopLive?.()
    stopLive = undefined
    clearInterval(poll)
    poll = undefined
  }
)
</script>
<template>
  <FishingShell
    :title="title"
    tabbed
    :action="active === 'feed' ? '记录鱼情' : active === 'spots' ? '新增钓位' : undefined"
    @action="
      uni.navigateTo({ url: active === 'spots' ? '/pages/spot/create' : '/pages/post/compose' })
    "
  >
    <view class="fishing-content">
      <FeedView v-if="active === 'feed'" ref="feed" /><SpotsView
        v-else-if="active === 'spots'"
        ref="spots"
      /><MessagesView v-else-if="active === 'messages'" ref="messages" /><MineView
        v-else
        ref="mine"
      />
    </view>
    <MobileBottomNav :items="tabs" :active="active" @action="change">
      <template #icon="{ item, active: selected }">
        <FishMark v-if="item.key === 'feed'" :size="28" :tone="selected ? 'brand' : 'muted'" />
        <MobileIcon v-else :name="item.icon" :size="20" />
      </template>
    </MobileBottomNav>
  </FishingShell>
</template>
