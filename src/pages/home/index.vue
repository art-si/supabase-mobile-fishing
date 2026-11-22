<script setup lang="ts">
import { computed, ref, nextTick, onMounted, watch } from 'vue'
import { onLoad, onPageScroll, onReachBottom, onShow, onUnload } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import FishingPrimaryNav from '@/components/FishingPrimaryNav.vue'
import FeedView from '@/components/FeedView.vue'
import SpotsView from '@/components/SpotsView.vue'
import MineView from '@/components/MineView.vue'
import { appForeground } from '@/services/app-activity'
import { homeTabs, reportsRoute, takeHomeTab } from '@/services/primary-navigation'
import { useAuthStore } from '@/stores/auth'
import { usePageActivity } from '@mobile-core/page-activity'
type Tab = (typeof homeTabs)[number]
const active = ref<Tab>('feed')
const visited = ref<Partial<Record<Tab, boolean>>>({ feed: true })
const auth = useAuthStore()
const titles: Record<Tab, string> = {
  feed: '钓友集',
  spots: '找钓位',
  mine: '我的'
}
const title = computed(() => titles[active.value])
const feed = ref<InstanceType<typeof FeedView>>(),
  spots = ref<InstanceType<typeof SpotsView>>(),
  mine = ref<InstanceType<typeof MineView>>()
let positions: Partial<Record<Tab, number>> = {}
let scrollTop = 0
let switchVersion = 0
let restoring = false
let reportsOpen = false
onPageScroll((event) => {
  if (!restoring) scrollTop = event.scrollTop
})
onReachBottom(() => {
  if (restoring) return
  if (active.value === 'feed') feed.value?.reachBottom()
  if (active.value === 'spots') spots.value?.reachBottom()
})
watch(
  () => auth.context,
  () => { positions = {} }
)

function rememberPosition() {
  if (restoring) return
  // #ifdef H5
  scrollTop = window.scrollY
  // #endif
  positions[active.value] = scrollTop
}

function openReports() {
  if (reportsOpen) return
  rememberPosition()
  reportsOpen = true
  uni.navigateTo({
    url: reportsRoute,
    animationType: 'none',
    fail: () => {
      reportsOpen = false
      uni.showToast({ title: '暂时无法打开举报页面，请重试', icon: 'none' })
    }
  })
}

async function change(tab: string, remember = true) {
  if (tab === 'reports' || tab === 'messages') {
    openReports()
    return
  }
  const target = homeTabs.find((item) => item === tab)
  if (!target || target === active.value) return
  if (remember) rememberPosition()
  const wasVisited = visited.value[target]
  visited.value[target] = true
  active.value = target
  // #ifdef H5
  const next = new URL(window.location.href)
  next.hash = `/pages/home/index?tab=${tab}`
  window.history.replaceState(window.history.state, '', next)
  // #endif
  await restorePosition(target, Boolean(wasVisited) && target !== 'feed')
}

async function restorePosition(target: Tab, reload = false) {
  const current = ++switchVersion
  restoring = true
  await nextTick()
  if (current !== switchVersion) return
  if (reload) refresh()
  uni.pageScrollTo({
    scrollTop: positions[target] ?? 0,
    duration: 0,
    complete: () => {
      if (current !== switchVersion) return
      restoring = false
      scrollTop = positions[target] ?? 0
    }
  })
}
// Same-page hash links do not re-run Uni's onLoad. Keep deep links and browser
// history aligned with the selected tab without remounting the whole app.
// #ifdef H5
function syncRouteTab() {
  const [path, query] = window.location.hash.slice(1).split('?')
  if (path !== '/pages/home/index') return
  const tab = new URLSearchParams(query).get('tab') || 'feed'
  if (tab !== active.value) void change(tab)
}
onMounted(() => window.addEventListener('hashchange', syncRouteTab))
onUnload(() => window.removeEventListener('hashchange', syncRouteTab))
// #endif
function refresh() {
  ;({ feed: feed.value, spots: spots.value, mine: mine.value })[
    active.value
  ]?.refresh()
}
onLoad((options) => {
  if (options?.tab === 'reports' || options?.tab === 'messages') {
    uni.redirectTo({ url: reportsRoute })
    return
  }
  active.value = homeTabs.find((item) => item === options?.tab) ?? 'feed'
  visited.value = { [active.value]: true }
})
onShow(() => {
  const target = takeHomeTab()
  const fromReports = reportsOpen
  reportsOpen = false
  if (target && target !== active.value) void change(target, false)
  else if (fromReports) void restorePosition(active.value)
})
usePageActivity(appForeground, refresh, () => {})
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
      <view v-if="visited.feed" v-show="active === 'feed'"><FeedView ref="feed" /></view>
      <view v-if="visited.spots" v-show="active === 'spots'"><SpotsView ref="spots" /></view>
      <view v-if="visited.mine" v-show="active === 'mine'"><MineView ref="mine" /></view>
    </view>
    <FishingPrimaryNav :active="active" @navigate="change" />
  </FishingShell>
</template>
