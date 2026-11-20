<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MobileSearch from '@mobile-core/components/MobileSearch.vue'
import MobileField from '@mobile-core/components/MobileField.vue'
import FishingCityPicker from './FishingCityPicker.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import { activateActionKey, preventActionKey } from '@mobile-core/action-keyboard'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileLoadingStatus from '@/components/FishingLoadingStatus.vue'
import { useAuthStore } from '@/stores/auth'
import { errorText } from '@/domain/rules'
import { placeDistanceLabel } from '@/domain/place-distance'
import { validSelection, type MapPlace, type SelectedPlace } from '@/domain/map'
import {
  canCapturePostLocation,
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
  if (!query.value.trim() || searching.value || disposed) return
  const version = ++queryVersion
  const next = more ? page.value + 1 : 1
  searching.value = true
  searchError.value = ''
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
    searchError.value = errorText(error)
  } finally {
    if (!disposed && version === queryVersion) searching.value = false
  }
}

async function locateCurrent() {
  if (!canCapturePostLocation || locating.value || disposed) return
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
  if (canCapturePostLocation) void locateCurrent()
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
        class="location-filter"
        variant="link"
        :aria-pressed="cityOpen"
        @click="cityOpen = !cityOpen"
        >{{ cityOpen ? '收起城市筛选' : city ? `城市：${city}` : '全部城市' }}</MobileAction
      >
      <MobileField
        v-if="cityOpen"
        field="post-place-city"
        label="城市（选填）"
        hint="留空搜索全国"
      ><FishingCityPicker v-model="city" field="post-place-city" label="选择搜索城市" clearable :disabled="accountChanged" /></MobileField>
    </view>

    <view v-if="searchError" class="notice stack stack--tight" role="alert">
      <text>{{ searchError }}</text>
      <MobileAction
        v-if="!accountChanged"
        variant="link"
        @click="needsLogin ? login() : search(false)"
        >{{ needsLogin ? '去登录' : '重新搜索' }}</MobileAction
      >
    </view>
    <text v-if="hasQuery && searched && !results.length && !searching && !searchError" class="muted"
      >没有找到相关地点，试试附近的桥、公园或城市。</text
    >
    <MobileAction
      v-if="hasQuery && hasMore"
      class="secondary"
      :disabled="searching"
      @click="search(true)"
      >更多地点</MobileAction
    >

    <template v-if="!hasQuery">
      <view v-if="initial || current" class="panel place-list">
        <button
          v-if="initial && !currentSelected"
          role="button"
          :tabindex="canChoose ? 0 : -1"
          :aria-disabled="!canChoose || undefined"
          class="mobile-action place-row"
          hover-class="mobile-action--pressed"
          :disabled="!canChoose"
          @click="choose(initial)"
          @keydown="preventActionKey"
          @keyup="activateActionKey($event, () => initial && choose(initial))"
        >
          <MobileIcon name="location" :size="22" />
          <view class="place-copy"
            ><text class="name">{{ initial.name }}</text
            ><text class="caption">当前选择 · 大致位置</text></view
          >
          <MobileIcon name="check" :size="22" />
        </button>
        <button
          v-if="current"
          role="button"
          :tabindex="canChoose ? 0 : -1"
          :aria-disabled="!canChoose || undefined"
          class="mobile-action place-row"
          hover-class="mobile-action--pressed"
          :disabled="!canChoose"
          @click="choose(current)"
          @keydown="preventActionKey"
          @keyup="activateActionKey($event, () => current && choose(current))"
        >
          <MobileIcon name="location" :size="22" />
          <view class="place-copy"
            ><text class="name">{{ current.name }}</text
            ><text class="caption">{{ currentCaption }}</text></view
          >
          <MobileIcon :name="currentSelected ? 'check' : 'chevron'" :size="22" />
        </button>
      </view>
      <view v-if="canCapturePostLocation && (locating || locationError)" class="stack stack--tight">
        <MobileLoadingStatus v-if="locating" label="正在定位当前位置…" />
        <text v-if="locationError" class="muted" role="status">{{ locationError }}</text>
        <MobileAction
          v-if="locationError && !locating"
          class="location-filter"
          variant="link"
          @click="locateCurrent"
          >重新定位</MobileAction
        >
      </view>
      <text v-if="!canCapturePostLocation" class="caption"
        >搜索城市或附近水域，选择要展示的地点。</text
      >

      <view
        v-if="current || nearby.length || nearbyLoading || nearbyError"
        class="stack stack--tight"
      >
        <view class="row row--between row--wrap">
          <text class="name">附近地点</text>
          <MobileAction
            v-if="canCapturePostLocation"
            variant="link"
            :disabled="locating || nearbyLoading"
            @click="locateCurrent"
            >刷新位置</MobileAction
          >
        </view>
        <MobileLoadingStatus v-if="nearbyLoading" label="正在查找附近地点…" />
        <text v-if="nearbyError" class="muted" role="status">附近地点暂未加载，可以直接搜索。</text>
        <view v-if="nearby.length" class="panel place-list">
          <button
            v-for="place in nearby"
            :key="place.id"
            role="button"
            :tabindex="canChoose ? 0 : -1"
            :aria-disabled="!canChoose || undefined"
            class="mobile-action place-row"
            hover-class="mobile-action--pressed"
            :disabled="!canChoose"
            @click="choose(place)"
            @keydown="preventActionKey"
            @keyup="activateActionKey($event, () => choose(place))"
          >
            <text v-if="distance(place)" class="place-distance">{{ distance(place) }}</text>
            <view class="place-copy"
              ><text class="name">{{ place.name }}</text
              ><text v-if="place.address" class="caption">{{ place.address }}</text></view
            >
            <MobileIcon name="chevron" :size="18" />
          </button>
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
  font-size: 0.8125rem;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
</style>
