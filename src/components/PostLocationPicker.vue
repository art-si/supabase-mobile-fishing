<script setup lang="ts">
defineOptions({ options: { styleIsolation: 'apply-shared' } })
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MobileSearch from '@mobile-core/components/MobileSearch.vue'
import MobileListFooter from '@mobile-core/components/MobileListFooter.vue'
import MobileField from '@mobile-core/components/MobileField.vue'
import FishingCityPicker from './FishingCityPicker.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'

import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileSkeleton from '@mobile-core/components/MobileSkeleton.vue'
import { useAuthStore } from '@/stores/auth'
import { errorText } from '@/domain/rules'
import { placeDistanceLabel } from '@/domain/place-distance'
import { validSelection, type MapPlace, type SelectedPlace } from '@/domain/map'
import {
  capturePostLocation,
  findPostPlaces,
  findNearbyPostPlaces
} from '@/platforms/post-location'

const props = defineProps<{ requestId: string }>()
const auth = useAuthStore()
const initialOwner = auth.userId
const query = ref(''),
  city = ref(''),
  cityOpen = ref(false)
const initial = ref<SelectedPlace | null>(null),
  current = ref<SelectedPlace | null>(null)
const results = ref<MapPlace[]>([]),
  nearby = ref<MapPlace[]>([])
const searching = ref(false),
  locating = ref(false),
  nearbyLoading = ref(false)
const searchError = ref(''),
  locationError = ref(''),
  nearbyError = ref('')
const needsLogin = ref(false),
  retryMore = ref(false),
  searched = ref(false),
  hasMore = ref(false),
  page = ref(1)
const accountChanged = ref(false)
let queryVersion = 0,
  locationVersion = 0,
  disposed = false
const distance = (place: MapPlace | SelectedPlace) => placeDistanceLabel(current.value, place)
const currentCaption = computed(() =>
  current.value?.accuracyM
    ? `当前位置 · 定位误差约 ${Math.ceil(current.value.accuracyM)} 米`
    : '当前位置'
)
const suggestions = computed(() =>
  results.value.map((place) => ({
    id: place.id,
    label: place.name,
    description: place.address,
    prefix: distance(place)
  }))
)
const hasQuery = computed(() => !!query.value.trim())
const currentSelected = computed(
  () =>
    !!initial.value &&
    !!current.value &&
    initial.value.name === current.value.name &&
    Math.round(initial.value.longitude / 0.02) === Math.round(current.value.longitude / 0.02) &&
    Math.round(initial.value.latitude / 0.02) === Math.round(current.value.latitude / 0.02)
)
const canChoose = computed(
  () => !!props.requestId && !accountChanged.value && initialOwner === auth.userId
)

function resetSearch() {
  queryVersion++
  searching.value = false
  searched.value = false
  searchError.value = ''
  needsLogin.value = false
  retryMore.value = false
  results.value = []
  hasMore.value = false
  page.value = 1
}
watch([query, city], resetSearch, { flush: 'sync' })
watch(city, () => { if (query.value.trim() && canChoose.value) void search(false) })
watch(
  () => auth.context,
  () => {
    queryVersion++
    locationVersion++
    searching.value = locating.value = nearbyLoading.value = false
    initial.value = current.value = null
    nearby.value = []
    results.value = []
    accountChanged.value = true
    searchError.value = '登录状态已变化，请返回发布页后重新选择。'
  },
  { flush: 'sync' }
)

async function search(more = false) {
  if (!query.value.trim() || searching.value || disposed || (more && !hasMore.value)) return
  const version = ++queryVersion
  const next = more ? page.value + 1 : 1
  searching.value = true
  searchError.value = ''
  retryMore.value = false
  needsLogin.value = false
  try {
    const response = await findPostPlaces(query.value, city.value, next)
    if (disposed || version !== queryVersion) return
    const combined = more ? [...results.value, ...response.items] : response.items
    results.value = combined.filter(
      (place, index) => combined.findIndex((p) => p.id === place.id) === index
    )
    searched.value = true
    hasMore.value = response.hasMore
    page.value = next
  } catch (error) {
    if (disposed || version !== queryVersion) return
    const failure = error as { code?: string; status?: number }
    needsLogin.value =
      failure.status === 401 ||
      failure.code === 'NOT_AUTHENTICATED' ||
      failure.code === 'SESSION_EXPIRED'
    retryMore.value = more
    searchError.value = errorText(error)
  } finally {
    if (!disposed && version === queryVersion) searching.value = false
  }
}
defineExpose({ reachBottom: () => {
  if (hasMore.value && !searchError.value && canChoose.value) void search(true)
} })

async function locateCurrent() {
  if (locating.value || disposed) return
  const version = ++locationVersion
  locating.value = true
  locationError.value = ''
  nearbyError.value = ''
  try {
    const place = await capturePostLocation({ detailedLabel: true })
    if (disposed || version !== locationVersion) return
    current.value = place
    locating.value = false
    nearbyLoading.value = true
    try {
      const places = await findNearbyPostPlaces(place)
      if (!disposed && version === locationVersion) nearby.value = places
    } catch (error) {
      if (!disposed && version === locationVersion) nearbyError.value = errorText(error)
    }
  } catch (error) {
    if (!disposed && version === locationVersion) locationError.value = errorText(error)
  } finally {
    if (!disposed && version === locationVersion) locating.value = nearbyLoading.value = false
  }
}

function choose(place: SelectedPlace | MapPlace) {
  if (!canChoose.value || !auth.requireLogin()) return
  const selected: SelectedPlace = {
    longitude: place.longitude,
    latitude: place.latitude,
    name: place.name,
    crs: 'GCJ-02',
    created_at: Date.now()
  }
  if (!validSelection(selected)) {
    searchError.value = '地点信息不完整，请重新搜索'
    return
  }
  uni.setStorageSync(`dyj.map.selection.${props.requestId}`, selected)
  uni.navigateBack()
}
function chooseSuggestion(id: string) {
  const place = results.value.find((item) => item.id === id)
  if (place) choose(place)
}
function login() {
  uni.navigateTo({ url: '/pages/login/index' })
}
onMounted(() => {
  const key = `dyj.map.initial.${props.requestId}`
  const stored = uni.getStorageSync(key)
  uni.removeStorageSync(key)
  if (validSelection(stored)) initial.value = stored
  void locateCurrent()
})
onBeforeUnmount(() => {
  disposed = true
  queryVersion++
  locationVersion++
})
</script>

<template>
  <view class="fishing-content stack post-location-picker">
    <view class="stack stack--tight">
      <MobileSearch
        v-model="query"
        name="post-place-search"
        label="搜索所在位置"
        placeholder="搜索地点"
        :maxlength="80"
        action-label=""
        live
        :suggestions="suggestions"
        :suggestion-status="searching ? '正在查找地点…' : ''"
        @search="search(false)"
        @select="chooseSuggestion"
        @dismiss="resetSearch"
      />
      <MobileAction
        class="mobile-action--link location-filter"
        :aria-pressed="cityOpen"
        @click="cityOpen = !cityOpen"
        >{{ cityOpen ? '收起城市筛选' : city ? `城市：${city}` : '全部城市' }}</MobileAction>
      <MobileField
        v-if="cityOpen"
        field="post-place-city"
        label="城市（选填）"
        hint="留空搜索全国"
      ><FishingCityPicker v-model="city" field="post-place-city" label="选择搜索城市" clearable :disabled="accountChanged" /></MobileField>
    </view>

    <view v-if="searchError && (!retryMore || needsLogin || accountChanged)" class="notice stack stack--tight" role="alert">
      <text>{{ searchError }}</text>
      <MobileAction
        v-if="!accountChanged"
        variant="link"
        @click="needsLogin ? login() : search(retryMore)"
        >{{ needsLogin ? '去登录' : '重新搜索' }}</MobileAction
      >
    </view>
    <text v-if="hasQuery && searched && !results.length && !hasMore && !searching && !searchError" class="muted"
      >没有找到相关地点，试试附近的桥、公园或城市。</text
    >
    <MobileListFooter v-if="hasQuery && canChoose && !needsLogin"
      :loading="searching && (!!results.length || hasMore)" :error="retryMore ? searchError : ''"
      :can-load-more="hasMore && !searching" :finished="searched && !hasMore && !searching && !searchError"
      :count="results.length" loading-label="正在加载更多地点…" more-text="加载更多地点"
      error-title="更多地点暂未加载" @more="search(true)" />

    <template v-if="!hasQuery">
      <view v-if="initial || current" class="panel place-list">
        <MobileAction
          v-if="initial && !currentSelected"
          class="place-row"
          :disabled="!canChoose"
          @click="choose(initial)"
        >
          <MobileIcon name="location" :size="22" />
          <view class="place-copy"
            ><text class="name">{{ initial.name }}</text
            ><text class="caption">当前选择 · 大致位置</text></view
          >
          <MobileIcon name="check" :size="22" />
        </MobileAction>
        <MobileAction
          v-if="current"
          class="place-row"
          :disabled="!canChoose"
          @click="choose(current)"
        >
          <MobileIcon name="location" :size="22" />
          <view class="place-copy"
            ><text class="name">{{ current.name }}</text
            ><text class="caption">{{ currentCaption }}</text></view
          >
          <MobileIcon :name="currentSelected ? 'check' : 'chevron'" :size="22" />
        </MobileAction>
      </view>
      <view v-if="locating || locationError" class="stack stack--tight">
        <MobileSkeleton v-if="locating" label="正在定位当前位置…" />
        <text v-if="locationError" class="muted" role="status">{{ locationError }}</text>
        <MobileAction
          v-if="locationError && !locating"
          class="mobile-action--link location-filter"
          @click="locateCurrent"
          >重新定位</MobileAction>
      </view>

      <view
        v-if="current || nearby.length || nearbyLoading || nearbyError"
        class="stack stack--tight"
      >
        <view class="row row--between row--wrap">
          <text class="name">附近地点</text>
          <MobileAction
            variant="link"
            :disabled="locating || nearbyLoading"
            @click="locateCurrent"
            >刷新位置</MobileAction
          >
        </view>
        <MobileSkeleton v-if="nearbyLoading" label="正在查找附近地点…" />
        <text v-if="nearbyError" class="muted" role="status">附近地点暂未加载，可以直接搜索。</text>
        <view v-if="nearby.length" class="panel place-list">
          <MobileAction
            v-for="place in nearby"
            :key="place.id"
            class="place-row"
            :disabled="!canChoose"
            @click="choose(place)"
          >
            <text v-if="distance(place)" class="place-distance">{{ distance(place) }}</text>
            <view class="place-copy"
              ><text class="name">{{ place.name }}</text
              ><text v-if="place.address" class="caption">{{ place.address }}</text></view
            >
            <MobileIcon name="chevron" :size="18" />
          </MobileAction>
        </view>
      </view>
    </template>
    <text v-if="!requestId || accountChanged" class="notice">请返回发布页后重新选择地点。</text>
    <text class="caption"
      >距离为直线距离。地点由高德提供；选择后回填草稿，发布时展示所选地点。</text
    >
  </view>
</template>

<style scoped>
.location-filter {
  align-self: flex-start;
  max-width: 100%;
  white-space: normal;
  text-align: left;
}
.place-list {
  padding: 0 var(--space-4, 16px);
}
.place-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 64px;
  padding: 14px 0;
  text-align: left;
  white-space: normal;
  background: transparent;
  border-radius: 0;
}
.place-row + .place-row {
  border-top: 1px solid var(--line);
}
.place-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-wrap: anywhere;
}
.place-row :deep(.mobile-icon) {
  flex-shrink: 0;
}
.place-distance {
  flex: 0 0 3.5rem;
  color: var(--reed);
  font-size: var(--fishing-caption-size);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
</style>
