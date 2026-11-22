<script setup lang="ts">
defineOptions({ options: { styleIsolation: 'apply-shared' } })
import { computed, onScopeDispose, ref, watch } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileSegmented from '@mobile-core/components/MobileSegmented.vue'
import MobileSearch from '@mobile-core/components/MobileSearch.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileEmptyState from '@/components/FishingEmptyState.vue'
import MobileListFooter from '@mobile-core/components/MobileListFooter.vue'
import MobileLoadingStatus from '@/components/FishingLoadingStatus.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import FishingCityPicker from './FishingCityPicker.vue'
import { cityOption, cityOptions } from '@/domain/cities'
import { canLocateCity, locateCity } from '@/platforms/city-location'
import { errorText } from '@/domain/rules'
import PostCard from './PostCard.vue'
import { useResource } from '@/composables/useResource'
import { useMutation } from '@/composables/useMutation'
import { useLoginAction } from '@/composables/useLoginAction'
import { useAuthStore } from '@/stores/auth'
import { read, write } from '@/services/repository'
import type { Page, Post } from '@/domain/models'
const auth = useAuthStore(),
  filter = ref('recommended'),
  query = ref(''),
  submitted = ref(''),
  city = ref(cityOption(String(uni.getStorageSync('dyj.feed.city') || ''))?.name || ''),
  locatingCity = ref(false),
  cityError = ref('')
let cityRequest = 0
let requestedDefaultCity = false
onScopeDispose(() => cityRequest++)
const followingRequiresLogin = computed(() => filter.value === 'following' && !auth.signedIn)
const searchPending = computed(() => query.value.trim() !== submitted.value)
const options = [
  { value: 'recommended', label: '推荐' },
  { value: 'following', label: '关注' },
  { value: 'city', label: '同城' }
]
const { data, loading, error, load, invalidate } = useResource(
  () =>
    followingRequiresLogin.value || (filter.value === 'city' && !city.value)
      ? Promise.resolve({ items: [], next: null } as Page<Post>)
      : read<Page<Post>>('feed', { filter: filter.value, query: submitted.value, city: city.value }),
  { items: [], next: null }
)
const mutation = useMutation()
const more = useMutation()
watch(
  query,
  invalidate,
  { flush: 'sync' }
)
watch(
  () => auth.context,
  () => {
    query.value = ''
    submitted.value = ''
  },
  { flush: 'sync' }
)
watch(
  [filter, city, () => auth.userId],
  () => {
    more.error.value = ''
    data.value = { items: [], next: null }
    void load()
  },
  { immediate: true }
)
function search(value: string) {
  more.error.value = ''
  submitted.value = value
  void load()
}
watch(filter, async (value) => {
  if (value !== 'city' || city.value || !canLocateCity || requestedDefaultCity) return
  requestedDefaultCity = true
  const current = ++cityRequest
  locatingCity.value = true
  try {
    const cityId = await locateCity()
    if (current === cityRequest) city.value = cityOptions.find((option) => option.id === cityId)?.name || ''
  } catch (failure) {
    if (current !== cityRequest) return
    cityError.value = errorText(failure).includes('定位权限已关闭')
      ? '定位权限已关闭，请手动选择城市。'
      : '未能定位当前城市，请手动选择。'
  } finally {
    if (current === cityRequest) locatingCity.value = false
  }
})
function chooseCity(value: string) {
  cityRequest++
  locatingCity.value = false
  cityError.value = ''
  city.value = value
  uni.setStorageSync('dyj.feed.city', city.value)
}
type Reaction = { id: string; kind: 'like' | 'bookmark'; enabled: boolean }
const loginAction = useLoginAction<Reaction>((intent) => applyReaction(intent, true))
async function react(post: Post, kind: 'like' | 'bookmark') {
  if (mutation.busy.value) return
  const intent = { id: post.id, kind, enabled: auth.signedIn ? !(kind === 'like' ? post.liked : post.saved) : true }
  if (!loginAction.requireLogin(intent)) return
  await applyReaction(intent)
}
async function applyReaction(intent: Reaction, resumed = false) {
  await mutation.run(async () => {
    const scope = auth.context
    invalidate()
    let updated: Post
    try { updated = await write<Post>('reaction', intent) }
    catch (failure) {
      if (resumed && auth.context === scope) await load()
      throw failure
    }
    data.value = {
      ...data.value,
      items: data.value.items.map((p) => (p.id === updated.id ? updated : p))
    }
    if (resumed) {
      await load()
      if (auth.context === scope) uni.showToast({ title: intent.kind === 'like' ? '已点赞' : '已收藏', icon: 'none' })
    }
  })
}
async function loadMore() {
  if (!data.value.next || loading.value || searchPending.value) return
  const before = data.value
  await more.run(async () => {
    const params = {
      filter: filter.value,
      query: submitted.value,
      city: city.value,
      cursor: data.value.next
    }
    const user = auth.userId
    const page = await read<Page<Post>>('feed', params).catch(failure => {
      if (before === data.value && user === auth.userId && !loading.value) throw failure
      return null
    })
    if (
      !page ||
      before !== data.value ||
      loading.value ||
      user !== auth.userId ||
      params.filter !== filter.value ||
      params.query !== submitted.value ||
      params.city !== city.value ||
      params.cursor !== data.value.next
    )
      return
    const ids = new Set(before.items.map(post => post.id))
    data.value = { items: [...before.items, ...page.items.filter(post => !ids.has(post.id))], next: page.next }
  })
}
function reachBottom() {
  if (!more.error.value) void loadMore()
}
defineExpose({ refresh: load, reachBottom })
</script>
<template>
  <view class="stack">
    <MobileSearch
      :key="auth.context"
      v-model="query"
      name="feed-search"
      label="搜索鱼情与心得"
      placeholder="鱼种或钓法"
      action-label=""
      live
      @search="search"
    />
    <MobileSegmented v-model="filter" label="鱼情筛选" :options="options" />
    <view v-if="filter === 'city'" class="feed-city">
      <view class="feed-city__row">
        <view class="feed-city__control"><MobileIcon class="feed-city__pin" name="location" size="20px" /><FishingCityPicker :model-value="city" field="feed-city" label="切换同城城市" placeholder="选择城市" compact guest-location @update:model-value="chooseCity" /></view>
        <text v-if="city" class="feed-city__hint caption">查看常驻该城市的钓友分享</text>
        <text v-else-if="locatingCity" class="feed-city__hint caption" role="status">正在识别当前城市…</text>
        <text v-else-if="cityError" class="feed-city__hint caption" role="status">{{ cityError }}</text>
        <text v-else class="feed-city__hint caption">查看所选城市的鱼情和心得</text>
      </view>
    </view>
    <MobileLoadError v-if="error" title="鱼情暂未加载" :message="error" @retry="load" />
    <text v-if="mutation.error.value && !error" class="error" role="alert">{{ mutation.error.value }}</text>
    <MobileLoadingStatus v-if="loading && !data.items.length && !followingRequiresLogin" label="正在寻找新鱼情…" />
    <PostCard
      v-for="post in data.items"
      :key="post.id"
      :post="post"
      :busy="mutation.busy.value"
      @react="react(post, $event)"
      @open="uni.navigateTo({ url: `/pages/post/detail?id=${post.id}` })"
    />
    <MobileEmptyState
      v-if="followingRequiresLogin"
      icon="user"
      title="登录后查看关注动态"
      description="关注钓友后，可以在这里查看他们分享的鱼情。"
      ><MobileAction class="secondary" @click="auth.requireLogin()">登录/注册</MobileAction>
    </MobileEmptyState>
    <MobileEmptyState
      v-else-if="!loading && !error && !data.items.length && (filter !== 'city' || city)"
      icon="document"
      :title="filter === 'following' ? '还没有关注的鱼情' : '还没有这片水域的故事'"
      description="换个关键词，或分享你的第一份记录。"
      ><MobileAction class="secondary" @click="uni.navigateTo({ url: '/pages/post/compose' })"
        >记一笔</MobileAction
      ></MobileEmptyState
    >
    <MobileListFooter
      v-if="!searchPending && !followingRequiresLogin"
      :loading="more.busy.value"
      :error="more.error.value"
      :can-load-more="!!data.next && !loading && !error"
      :finished="!data.next && !loading && !error"
      :count="data.items.length"
      loading-label="正在加载更多鱼情…"
      @more="loadMore"
    />
  </view>
</template>
<style scoped>
.feed-city { display: grid; gap: 4px; min-width: 0; }
.feed-city__row { display: flex; align-items: center; flex-wrap: wrap; column-gap: 12px; row-gap: 0; min-width: 0; }
.feed-city__control { position: relative; flex: 0 1 auto; min-width: 0; max-width: 100%; color: var(--lake); }
.feed-city__pin { position: absolute; left: 0; top: 50%; transform: translateY(-50%); pointer-events: none; }
.feed-city__control :deep(.mobile-picker-trigger) { min-height: 48px; padding: 8px 4px 8px 28px; border-color: transparent; background: transparent; color: var(--lake); font-size: var(--fishing-text-size); font-weight: 600; line-height: 1.4; }
.feed-city__control :deep(.mobile-picker-trigger:focus-visible) { outline: 2px solid var(--lake); outline-offset: 2px; }
.feed-city__hint { flex: 1 1 9rem; min-width: 0; overflow-wrap: anywhere; text-wrap: balance; font-size: var(--fishing-caption-size); line-height: 1.5; }
</style>
