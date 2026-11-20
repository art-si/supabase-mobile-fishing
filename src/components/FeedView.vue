<script setup lang="ts">
defineOptions({ options: { styleIsolation: 'apply-shared' } })
import { ref, watch, onScopeDispose } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileSegmented from '@mobile-core/components/MobileSegmented.vue'
import MobileSearch from '@mobile-core/components/MobileSearch.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileEmptyState from '@/components/FishingEmptyState.vue'
import MobileListFooter from '@mobile-core/components/MobileListFooter.vue'
import MobileLoadingStatus from '@/components/FishingLoadingStatus.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import FishingCityPicker from './FishingCityPicker.vue'
import { cityOptions } from '@/domain/cities'
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
  city = ref(String(uni.getStorageSync('dyj.feed.city') || '')),
  locatingCity = ref(false),
  cityError = ref('')
let cityRequest = 0, requestedDefaultCity = false
onScopeDispose(() => { cityRequest++ })
const options = [
  { value: 'recommended', label: '推荐' },
  { value: 'following', label: '关注' },
  { value: 'city', label: '同城' }
]
const { data, loading, error, load, invalidate } = useResource(
  () =>
    filter.value === 'city' && !city.value
      ? Promise.resolve({ items: [], next: null } as Page<Post>)
      : read<Page<Post>>('feed', { filter: filter.value, query: submitted.value, city: city.value }),
  { items: [], next: null }
)
const mutation = useMutation()
const more = useMutation()
watch(
  query,
  () => {
    invalidate()
    data.value = { items: [], next: null }
  },
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
    data.value = { items: [], next: null }
    void load()
  },
  { immediate: true }
)
function search(value: string) {
  submitted.value = value
  void load()
}
watch(filter, (value) => {
  if (value === 'city' && !requestedDefaultCity) {
    requestedDefaultCity = true
    if (canLocateCity) void defaultCity()
  }
})
async function defaultCity() {
  const current = ++cityRequest
  locatingCity.value = true; cityError.value = ''
  try {
    const id = await locateCity()
    if (current !== cityRequest) return
    const found = cityOptions.find(option => option.id === id)
    if (found) city.value = found.name
  } catch (error) {
    if (current === cityRequest) cityError.value = errorText(error).replace('也可以搜索地点', '也可以手动选择城市')
  } finally { if (current === cityRequest) locatingCity.value = false }
}
function chooseCity(value: string) {
  cityRequest++; locatingCity.value = false; cityError.value = ''
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
  await more.run(async () => {
    const params = {
      filter: filter.value,
      query: submitted.value,
      city: city.value,
      cursor: data.value.next
    }
    const user = auth.userId
    const page = await read<Page<Post>>('feed', params)
    if (
      user !== auth.userId ||
      params.filter !== filter.value ||
      params.query !== submitted.value ||
      params.city !== city.value ||
      params.cursor !== data.value.next
    )
      return
    data.value = { items: [...data.value.items, ...page.items], next: page.next }
  })
}
defineExpose({ refresh: load })
</script>
<template>
  <view class="stack">
    <MobileSearch
      :key="auth.context"
      v-model="query"
      name="feed-search"
      label="搜索鱼情与心得"
      placeholder="搜鱼种、钓法、心得"
      action-label=""
      live
      @search="search"
    />
    <MobileSegmented v-model="filter" label="鱼情筛选" :options="options" />
    <view v-if="filter === 'city'" class="feed-city">
      <view class="feed-city__row">
        <view class="feed-city__control"><MobileIcon class="feed-city__pin" name="location" size="20px" /><FishingCityPicker :model-value="city" field="feed-city" label="切换同城城市" placeholder="选择城市" compact @update:model-value="chooseCity" /></view>
        <text v-if="city" class="feed-city__hint caption">查看常驻该城市的钓友分享</text>
        <text v-else-if="!locatingCity && !cityError" class="feed-city__hint caption">选择城市，查看当地钓友分享。</text>
      </view>
      <text v-if="locatingCity" class="caption" role="status">正在定位当前城市…</text>
      <text v-if="cityError" class="caption" role="status">{{ cityError }}</text>
    </view>
    <MobileLoadError v-if="error" :message="error" @retry="load" />
    <text v-if="mutation.error.value && !error" class="error" role="alert">{{ mutation.error.value }}</text>
    <MobileLoadingStatus v-if="loading" label="正在寻找新鱼情…" />
    <PostCard
      v-for="post in data.items"
      :key="post.id"
      :post="post"
      :busy="mutation.busy.value"
      @react="react(post, $event)"
      @open="uni.navigateTo({ url: `/pages/post/detail?id=${post.id}` })"
    />
    <MobileEmptyState
      v-if="!loading && !error && !data.items.length && (filter !== 'city' || (city && !locatingCity))"
      icon="document"
      :title="filter === 'following' ? '还没有关注的鱼情' : '还没有这片水域的故事'"
      description="换个关键词，或分享你的第一份记录。"
      ><MobileAction class="secondary" @click="uni.navigateTo({ url: '/pages/post/compose' })"
        >记一笔</MobileAction
      ></MobileEmptyState
    >
    <MobileListFooter
      :loading="more.busy.value"
      :error="more.error.value"
      :can-load-more="!!data.next"
      :finished="!data.next"
      :count="data.items.length"
      @more="loadMore"
    >
      <template #loading><MobileLoadingStatus label="正在读取更多鱼情…" :block="false" /></template>
    </MobileListFooter>
  </view>
</template>
<style scoped>
.feed-city { display: grid; gap: 4px; min-width: 0; }
.feed-city__row { display: flex; align-items: center; flex-wrap: wrap; column-gap: 12px; row-gap: 0; min-width: 0; }
.feed-city__control { position: relative; flex: 0 1 auto; min-width: 0; max-width: 100%; color: var(--lake); }
.feed-city__pin { position: absolute; left: 0; top: 50%; transform: translateY(-50%); pointer-events: none; }
.feed-city__control :deep(.mobile-picker-trigger) { min-height: 48px; padding: 8px 4px 8px 28px; border-color: transparent; background: transparent; color: var(--lake); font-size: 1rem; font-weight: 600; line-height: 1.4; }
.feed-city__control :deep(.mobile-picker-trigger:focus-visible) { outline: 2px solid var(--lake); outline-offset: 2px; }
.feed-city__hint { flex: 1 1 9rem; min-width: 0; overflow-wrap: anywhere; text-wrap: balance; font-size: .8125rem; line-height: 1.5; }
</style>
