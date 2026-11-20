<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onLoad, onShow, onHide } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import FishingLoadingStatus from '@/components/FishingLoadingStatus.vue'
import PostCard from '@/components/PostCard.vue'
import SpotCard from '@/components/SpotCard.vue'
import FishFacts from '@/components/FishFacts.vue'
import TripCatchList from '@/components/TripCatchList.vue'
import FishingPhotos from '@/components/FishingPhotos.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileConfirmDialog from '@mobile-core/components/MobileConfirmDialog.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileEmptyState from '@/components/FishingEmptyState.vue'
import { read, write } from '@/services/repository'
import { useResource } from '@/composables/useResource'
import { useMutation } from '@/composables/useMutation'
import { useAuthStore } from '@/stores/auth'
import { prepareTripDraft, discardTripDraft } from '@/services/draft-handoff'
import { editRoute } from '@/domain/content-edit'
import type { Post, Spot, Trip } from '@/domain/models'
const auth = useAuthStore(),
  type = ref('trips'),
  titles: Record<string, string> = {
    trips: '出钓日志',
    saved: '我的收藏',
    posts: '我的记录',
    spots: '我的钓位'
  },
  title = computed(() => titles[type.value] || '我的记录'),
  mutation = useMutation()
const { data, error, loading, load } = useResource(
  async () => {
    const category = type.value
    if (category === 'posts') {
      const [records, legacy] = await Promise.all([
        read<{ posts: Post[]; spots: Spot[]; trips: Trip[] }>('library', { type: category }),
        read<{ trips: Trip[] }>('library', { type: 'trips' })
      ])
      return { ...records, trips: legacy.trips }
    }
    return read<{ posts: Post[]; spots: Spot[]; trips: Trip[] }>('library', { type: category })
  },
  { posts: [], spots: [], trips: [] }
)
onLoad((options) => {
  type.value = options?.type || 'trips'
  void load()
})
onShow(() => void load())
const empty = computed(() =>
  type.value === 'trips'
    ? !data.value.trips.length
    : type.value === 'spots'
      ? !data.value.spots.length
      : type.value === 'saved'
        ? !data.value.posts.length && !data.value.spots.length
        : !data.value.posts.length && !data.value.trips.length
)
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
const deleteOpen = ref(false)
watch(
  () => auth.context,
  () => {
    deleteOpen.value = false
    pendingDelete = undefined
  },
  { flush: 'sync' }
)
let pendingDelete: { id: string; type: string } | undefined
onHide(() => {
  deleteOpen.value = false
  pendingDelete = undefined
})
function remove(id: string, kind: string) {
  if (mutation.busy.value) return
  pendingDelete = { id, type: kind }
  deleteOpen.value = true
}
async function confirmDelete() {
  const target = pendingDelete
  pendingDelete = undefined
  if (!target) return
  await mutation.run(async () => {
    await write('delete_content', target)
    await load()
  })
}
</script>
<template>
  <FishingShell :title="title" back
    ><view class="fishing-content stack"
      ><MobileLoadError v-if="error" :message="error" @retry="load" />
      <FishingLoadingStatus v-if="loading && empty" label="正在翻阅你的出钓记录…" />
      <template v-if="type === 'posts' || type === 'saved'"
        ><view v-for="post in data.posts" :key="post.id" class="stack stack--tight"
          ><PostCard
            :post="post"
            @react="react(post, $event)"
            @open="uni.navigateTo({ url: `/pages/post/detail?id=${post.id}` })"
          >
            <template v-if="type === 'posts' && post.author.id === auth.userId" #management>
              <view class="mobile-action-group publication-management">
                <MobileAction class="secondary" @click="uni.navigateTo({ url: editRoute('post', post.id) })">编辑发布</MobileAction>
                <MobileAction class="danger publication-delete" @click="remove(post.id, 'post')">删除</MobileAction>
              </view>
            </template>
          </PostCard></view
        ></template
      >
      <template v-if="type === 'trips' || (type === 'posts' && data.trips.length)"
        ><view class="notice">以前的出钓日志仍仅自己可见。新的记录统一在“记录鱼情”里保存。</view
        ><view v-for="trip in data.trips" :key="trip.id" class="panel stack"
          ><text class="caption">{{ trip.occurred_on }} · 私人日志</text
          ><text class="heading">{{ trip.title }}</text
          ><text class="body">{{ trip.body }}</text
          ><FishingPhotos
            v-if="trip.media?.length"
            :media="trip.media"
            :label="`${trip.title}的照片`"
          /><FishFacts :method="trip.method" :bait="trip.bait" /><TripCatchList :trip="trip" />
          <view class="mobile-action-group"
            ><MobileAction
              class="text-action"
              @click="uni.navigateTo({ url: editRoute('trip', trip.id) })"
              >编辑日志</MobileAction
            ><MobileAction class="text-action" @click="useTrip(trip, 'repeat')"
              >再记一次</MobileAction
            ><MobileAction class="text-action" @click="useTrip(trip, 'share')"
              >生成分享草稿</MobileAction
            ><MobileAction class="text-action" @click="remove(trip.id, 'trip')"
              >删除日志</MobileAction
            ></view
          ></view
        ></template
      >
      <template v-if="type === 'spots' || type === 'saved'"
        ><view v-for="spot in data.spots" :key="spot.id" class="stack stack--tight"
          ><SpotCard :spot="spot" /><MobileAction
            v-if="type === 'spots'"
            class="text-action"
            @click="remove(spot.id, 'spot')"
            >删除这个钓位</MobileAction
          ></view
        ></template
      >
      <MobileEmptyState
        v-if="empty && !loading && !error"
        icon="document"
        title="留给下一次好时光"
        description="记录、发布或收藏后，就能在这里找到。"
        ><MobileAction
          class="secondary"
          @click="uni.navigateTo({ url: '/pages/post/compose' })"
          >记录鱼情</MobileAction
        ></MobileEmptyState
      >
      <text v-if="!empty && !loading" class="caption">当前显示最近 100 条记录。</text>
      <text v-if="mutation.error.value" class="error" role="alert">{{
        mutation.error.value
      }}</text> </view
    ><MobileConfirmDialog
      v-model="deleteOpen"
      title="删除这条记录？"
      message="删除后不再显示，请确认你不再需要它。"
      confirm-text="删除记录"
      @confirm="confirmDelete"
      @cancel="pendingDelete = undefined"
  /></FishingShell>
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
