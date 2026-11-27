<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onLoad, onShow, onHide, onReachBottom } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import MobileSkeleton from '@mobile-core/components/MobileSkeleton.vue'
import PostCard from '@/components/PostCard.vue'
import SpotCard from '@/components/SpotCard.vue'
import SpotCommentsSheet from '@/components/SpotCommentsSheet.vue'
import TripCard from '@/components/TripCard.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileListFooter from '@mobile-core/components/MobileListFooter.vue'
import MobileEmptyState from '@/components/FishingEmptyState.vue'
import { read, write } from '@/services/repository'
import { onContentDeleted } from '@/services/content-deletion'
import { useResource } from '@/composables/useResource'
import { useListRefresh } from '@/composables/useListRefresh'
import { useMutation } from '@/composables/useMutation'
import { useAuthStore } from '@/stores/auth'
import { useSpotCommunity } from '@/composables/useSpotCommunity'
import { leadCommunityKey, savedSpotLeads } from '@/services/spot-community'
import { prepareTripDraft, discardTripDraft } from '@/services/draft-handoff'
import { editRoute } from '@/domain/content-edit'
import type { Page, Post, Spot, Trip } from '@/domain/models'
import type { SpotLead } from '../../../supabase/functions/_shared/discovery-contract'
const libraryTypes = ['trips', 'saved', 'posts', 'spots'] as const
type LibraryType = (typeof libraryTypes)[number]
const auth = useAuthStore(),
  type = ref<LibraryType>('trips'),
  titles: Record<LibraryType, string> = {
    trips: '出钓日志',
    saved: '我的收藏',
    posts: '我的记录',
    spots: '我的钓位'
  },
  title = computed(() => titles[type.value]),
  mutation = useMutation()
const emptyPage = <T,>(): Page<T> => ({ items: [], next: null })
const initial = { posts: emptyPage<Post>(), spots: emptyPage<Spot>(), trips: emptyPage<Trip>(), leads: [] as SpotLead[] }
const { data, error, loading, load, invalidate } = useResource(async () => {
  if (!auth.signedIn) return initial
  const category = type.value
  const [posts, spots, trips, leads] = await Promise.all([
    category === 'posts' || category === 'saved' ? read<Page<Post>>('library_posts', { type: category }) : initial.posts,
    category === 'spots' || category === 'saved' ? read<Page<Spot>>('library_spots', { type: category }) : initial.spots,
    category === 'trips' || category === 'posts' ? read<Page<Trip>>('library_trips') : initial.trips,
    category === 'saved' ? savedSpotLeads().catch(() => [] as SpotLead[]) : initial.leads
  ])
  return { posts, spots, trips, leads }
}, initial)
let active = true
onHide(() => { active = false })
onContentDeleted(value => {
  const reload = loading.value
  invalidate()
  const list = value.type === 'post' ? 'posts' : value.type === 'spot' ? 'spots' : 'trips'
  data.value = { ...data.value, [list]: { ...data.value[list], items: data.value[list].items.filter(item => item.id !== value.id) } }
  if (reload && active) void load()
})
const more = useMutation()
const hasMore = computed(() => Boolean(data.value.posts.next || data.value.spots.next || data.value.trips.next))
const itemCount = computed(() => data.value.posts.items.length + data.value.spots.items.length +
  data.value.trips.items.length + data.value.leads.length)
async function loadMore() {
  const previous = data.value
  const category = type.value
  const scope = auth.context
  if (loading.value || error.value || !auth.signedIn || !hasMore.value) return
  await more.run(async () => {
    const append = async <T,>(action: string, page: Page<T>) => {
      if (!page.next) return page
      const next = await read<Page<T>>(action, { type: category, cursor: page.next })
      const ids = new Set(page.items.map(item => (item as { id: string }).id))
      return { items: [...page.items, ...next.items.filter(item => !ids.has((item as { id: string }).id))], next: next.next }
    }
    try {
      const [posts, spots, trips] = await Promise.all([
        append('library_posts', previous.posts), append('library_spots', previous.spots),
        append('library_trips', previous.trips)
      ])
      if (data.value === previous && !loading.value && auth.context === scope && type.value === category)
        data.value = { ...previous, posts, spots, trips }
    } catch (cause) {
      if (data.value === previous && auth.context === scope && type.value === category) throw cause
    }
  })
}
onReachBottom(() => { if (!more.error.value) void loadMore() })
useListRefresh(async () => { more.error.value = ''; await load() }, () => !mutation.busy.value && !commentsOpen.value)
watch([type, () => auth.context], () => { more.error.value = '' })
const { summaries, busy: communityBusy, apply: updateCommunity, react: reactToSpot,
  openComments, commentsOpen, commentTarget } = useSpotCommunity(
  computed(() => data.value.leads.map(leadCommunityKey))
)
const visibleLeads = computed(() => data.value.leads.flatMap(lead => {
  const target = leadCommunityKey(lead)
  const community = summaries.value[target]
  if (community?.saved === false) return []
  return [{ lead, target, community, spot: {
    id: target, city: lead.city, name: lead.name, water_type: lead.waterType, observed_on: lead.sourceDate,
    fishing_status: community?.status === 'prohibited' ? 'prohibited' as const : undefined
  } }]
}))
onLoad((options) => {
  type.value = libraryTypes.find((kind) => kind === options?.type) ?? 'trips'
  void load()
})
onShow(() => { active = true; void load() })
const empty = computed(() =>
  type.value === 'trips'
    ? !data.value.trips.items.length
    : type.value === 'spots'
      ? !data.value.spots.items.length
      : type.value === 'saved'
        ? !data.value.posts.items.length && !data.value.spots.items.length && !visibleLeads.value.length
        : !data.value.posts.items.length && !data.value.trips.items.length
)
const libraryEmpty = {
  trips: { title: '还没有出钓日志', description: '记下日期、渔获和心得，方便下次回看。', action: '记录鱼情', url: '/pages/post/compose' },
  posts: { title: '还没有鱼情记录', description: '渔获和钓法心得都可以记在这里。', action: '记录鱼情', url: '/pages/post/compose' },
  spots: { title: '还没有保存自己的钓位', description: '留下钓位位置和现场信息，下次可以直接找到。', action: '新增钓位', url: '/pages/spot/create' },
  saved: { title: '还没有收藏', description: '收藏鱼情或钓位后，可以在这里回看。', action: '浏览钓友圈', url: '/pages/home/index' }
}
const emptyState = computed(() => libraryEmpty[type.value])
async function react(post: Post, kind: 'like' | 'bookmark') {
  await mutation.run(async () => {
    await write('reaction', {
      id: post.id,
      kind,
      enabled: kind === 'like' ? !post.liked : !post.saved
    })
    await load()
  })
}
function useTrip(trip: Trip, intent: 'repeat' | 'share') {
  if (!auth.requireLogin()) return
  const { token, mode } = prepareTripDraft(trip, auth.userId, intent)
  uni.navigateTo({
    url: `/pages/post/compose?mode=${mode}&fromTrip=${token}`,
    fail: () => {
      discardTripDraft(token)
      mutation.error.value = '暂时无法打开草稿，请重试'
    }
  })
}
</script>
<template>
  <FishingShell :title="title" back>
    <view v-if="!auth.signedIn" class="fishing-content">
      <MobileEmptyState
        icon="document"
        title="登录后查看个人记录"
        description="在这里查看收藏、出钓记录和自己保存的钓位。"
      >
        <MobileAction class="primary" @click="auth.requireLogin()">登录</MobileAction>
      </MobileEmptyState>
    </view>
    <view v-else class="fishing-content stack">
      <MobileLoadError v-if="error" :message="error" @retry="load" />
      <MobileSkeleton v-if="loading && empty" label="正在翻阅你的出钓记录…" />
      <template v-if="type === 'posts' || type === 'saved'"
        ><view v-for="post in data.posts.items" :key="post.id" class="stack stack--tight"
          ><PostCard
            :post="post"
            :busy="mutation.busy.value"
            @react="react(post, $event)"
            @open="uni.navigateTo({ url: `/pages/post/detail?id=${post.id}` })"
          >
            <template v-if="type === 'posts' && post.author.id === auth.userId" #management>
              <view class="mobile-action-group publication-management">
                <MobileAction class="secondary" @click="uni.navigateTo({ url: editRoute('post', post.id) })">编辑发布</MobileAction>
              </view>
            </template>
          </PostCard></view
        ></template
      >
      <template v-if="type === 'trips' || (type === 'posts' && data.trips.items.length)"
        ><view v-if="data.trips.items.length" class="notice">以前的出钓日志仍仅自己可见。新的记录统一在“记录鱼情”里保存。</view
        ><TripCard v-for="trip in data.trips.items" :key="trip.id" :trip="trip" :owner="auth.userId" :busy="mutation.busy.value" @use="useTrip(trip,$event)" />
        </template
      >
      <template v-if="type === 'spots' || type === 'saved'"
        ><view v-for="spot in data.spots.items" :key="spot.id" class="stack stack--tight"
          ><SpotCard :spot="spot" :busy="mutation.busy.value" /></view
        ></template
      >
      <template v-if="type === 'saved'">
        <SpotCard v-for="card in visibleLeads" :key="card.target" :spot="card.spot" :lead="card.lead.source"
          interactive
          :source-address="card.lead.sourceAddress" :labels="card.lead.labels" :community="card.community"
          :busy="communityBusy.has(card.target)" @react="kind => reactToSpot(card.target, kind)"
          @comments="openComments(card.target, card.spot.name)" />
        <SpotCommentsSheet v-model="commentsOpen" :target="commentTarget.id" :title="commentTarget.title"
          @summary="updateCommunity" />
      </template>
      <MobileEmptyState
        v-if="empty && !loading && !error"
        icon="document"
        :title="emptyState.title"
        :description="emptyState.description"
        ><MobileAction
          class="secondary"
          @click="type === 'saved' ? uni.reLaunch({ url: emptyState.url }) : uni.navigateTo({ url: emptyState.url })"
          >{{ emptyState.action }}</MobileAction
        ></MobileEmptyState
      >
      <MobileListFooter :loading="more.busy.value" :error="more.error.value"
        :can-load-more="hasMore && !loading && !error" :finished="!hasMore && !loading && !error"
        :count="itemCount" loading-label="正在加载更多记录…" @more="loadMore" />
      <text v-if="mutation.error.value" class="error" role="alert">{{
        mutation.error.value
      }}</text>
    </view>
  </FishingShell>
</template>
<style scoped>
.publication-management {
  padding-top: 10px;
  border-top: 1px solid var(--line);
}
.publication-management :deep(.mobile-action) {
  height: 100%;
  min-height: max(48px, 3rem);
}
.publication-delete.mobile-action {
  min-width: 64px;
  color: var(--danger);
}
</style>
