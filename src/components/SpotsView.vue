<script setup lang="ts">
defineOptions({ options: { styleIsolation: 'apply-shared' } })
import { onMounted, onUnmounted, ref, watch } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileSearch from '@mobile-core/components/MobileSearch.vue'
import MobileSegmented from '@mobile-core/components/MobileSegmented.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileEmptyState from '@/components/FishingEmptyState.vue'
import MobileLoadingStatus from '@/components/FishingLoadingStatus.vue'
import SpotCard from './SpotCard.vue'
import { useResource } from '@/composables/useResource'
import { useAuthStore } from '@/stores/auth'
import { read } from '@/services/repository'
import type { Page, Spot } from '@/domain/models'
import { locateSpotDistance } from '@/platforms/spot-distance-location'
import { canLocateSpot } from '@/platforms/spot-location'
import { pickMap, consumeSelection } from '@/platforms/map-navigation'
import { validCoordinates } from '@/domain/rules'
import { onShow } from '@dcloudio/uni-app'
const origin = ref<{ longitude: number; latitude: number; crs: 'GCJ-02' } | null>(null)
const locating = ref(false),
  locationError = ref(''),
  locationRequest = ref('')
let locationVersion = 0,
  disposed = false
async function locateNearby() {
  if (locating.value) return
  if (!canLocateSpot) {
    selectOrigin()
    return
  }
  const version = ++locationVersion
  locating.value = true
  locationError.value = ''
  try {
    const point = await locateSpotDistance()
    if (
      disposed ||
      version !== locationVersion ||
      !validCoordinates(point.longitude, point.latitude)
    )
      return
    origin.value = point
    void load()
  } catch {
    if (!disposed && version === locationVersion)
      locationError.value = '暂时无法定位，可手动选择我的位置。'
  } finally {
    if (version === locationVersion) locating.value = false
  }
}
function selectOrigin() {
  locationRequest.value = pickMap()
}
onMounted(() => {
  if (canLocateSpot) void locateNearby()
})
onUnmounted(() => {
  disposed = true
  locationVersion++
})
function consumeOrigin() {
  const point = consumeSelection(locationRequest.value)
  if (!locationRequest.value || !point) return false
  locationRequest.value = ''
  origin.value = { longitude: point.longitude, latitude: point.latitude, crs: 'GCJ-02' }
  locationError.value = ''
  return true
}
function refresh() { consumeOrigin(); return load() }
onShow(() => { if (consumeOrigin()) void load() })
const auth = useAuthStore(),
  query = ref(''),
  submitted = ref(''),
  type = ref('')
const { data, loading, error, load, invalidate } = useResource(
  () =>
    read<Page<Spot>>('spots', {
      query: submitted.value,
      type: type.value,
      ...(origin.value ? { origin: origin.value } : {})
    }),
  { items: [], next: null }
)
watch([type, () => auth.userId], () => void load(), { immediate: true })
watch(
  query,
  () => {
    invalidate()
    data.value = { items: [], next: null }
  },
  { flush: 'sync' }
)
function search(value: string) {
  submitted.value = value
  void load()
}
watch(
  () => auth.context,
  () => {
    query.value = ''
    submitted.value = ''
  },
  { flush: 'sync' }
)
defineExpose({ refresh })
</script>
<template>
  <view class="stack">
    <view class="row row--between row--wrap spots-tools"
      ><MobileAction class="text-action" :disabled="locating" @click="locateNearby">{{
        locating
          ? '正在定位…'
          : origin
            ? '距离由近到远'
            : canLocateSpot
              ? '开启定位'
              : '选择我的位置'
      }}</MobileAction
      ><MobileAction class="secondary" @click="uni.navigateTo({ url: '/pages/map/index' })"
        ><MobileIcon name="location" :size="18" />水域地图</MobileAction
      ></view
    >
    <view v-if="locationError" class="row row--wrap"
      ><text class="caption" role="status">{{ locationError }}</text
      ><MobileAction class="text-action" @click="selectOrigin">选择我的位置</MobileAction></view
    >
    <MobileSearch
      :key="auth.context"
      v-model="query"
      name="spot-search"
      label="搜索钓位"
      placeholder="输入水域、城市或鱼种"
      action-label=""
      live
      @search="search"
    />
    <MobileSegmented
      v-model="type"
      label="水域类型"
      :options="[
        { value: '', label: '全部' },
        { value: '自然水域', label: '自然水域' },
        { value: '水库', label: '水库' },
        { value: '钓场', label: '钓场' }
      ]"
    />
    <MobileLoadError v-if="error" :message="error" @retry="load" />
    <MobileLoadingStatus v-if="loading" label="正在读取钓位…" />
    <SpotCard v-for="spot in data.items" :key="spot.id" :spot="spot" />
    <MobileEmptyState
      v-if="!loading && !error && !data.items.length"
      icon="location"
      title="暂时没找到合适的钓位"
      description="试试其他水域、城市或鱼种。"
    />
  </view>
</template>
<style scoped>
.spots-tools {
  gap: 8px;
}
</style>
