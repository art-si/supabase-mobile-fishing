<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onHide, onLoad, onReachBottom, onShow, onUnload } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import StaticMapPreview from '@/components/StaticMapPreview.vue'
import MapZones from '@/components/MapZones.vue'
import MapWeather from '@/components/MapWeather.vue'
import { circleBounds } from '@/domain/zones'
import MobileField from '@mobile-core/components/MobileField.vue'
import FishingCityPicker from '@/components/FishingCityPicker.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileSearch from '@mobile-core/components/MobileSearch.vue'
import MobileLoadingStatus from '@/components/FishingLoadingStatus.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileListFooter from '@mobile-core/components/MobileListFooter.vue'
import { useAuthStore } from '@/stores/auth'
import { appForeground } from '@/services/app-activity'
import { usePageActivity } from '@mobile-core/page-activity'
import { searchMapPlaces, searchMapWaterPlaces } from '@/services/amap'
import { resolveNearbyWater, type NearbyWater } from '@/services/nearby-water'
import { errorText } from '@/domain/rules'
import { formatMapCoordinates, validSelection, waterSelection, type MapPlace, type SelectedPlace } from '@/domain/map'
const auth = useAuthStore(),
  pick = ref(false),
  waterPick = ref(false),
  requestId = ref(''),
  query = ref(''),
  city = ref('')
const items = ref<MapPlace[]>([]),
  selected = ref<MapPlace | null>(null),
  page = ref(1)
const error = ref(''),
  retryMore = ref(false),
  loading = ref(false),
  searched = ref(false),
  hasMore = ref(false)
onReachBottom(() => {
  if (!selected.value && !error.value && hasMore.value) void search(true)
})
const suggestions = computed(() =>
  selected.value
    ? []
    : items.value.map((p) => ({ id: p.id, label: p.name, description: p.address }))
)
const weatherVisible = ref(true)
const zonesActive = ref(false)
const waterTarget = ref<SelectedPlace>()
const waterSource = ref<NearbyWater['source']>()
const waterLoading = ref(false)
const waterHint = ref('')
const previewTarget = computed(() => waterTarget.value ?? (waterPick.value ? null : selected.value))
let waterVersion = 0
usePageActivity(
  appForeground,
  () => {
    zonesActive.value = true
  },
  () => {
    zonesActive.value = false
  }
)
onShow(() => {
  weatherVisible.value = true
  if (waterPick.value && selected.value && !waterTarget.value && !waterHint.value) void findNearbyWater()
})
onHide(() => {
  weatherVisible.value = false
  waterVersion++
  waterLoading.value = false
})
const zonePanel = ref<InstanceType<typeof MapZones>>()
const zoneBounds = computed(() =>
  previewTarget.value ? circleBounds({ ...previewTarget.value, radius_m: 5000 }) : null
)
let version = 0,
  disposed = false
onLoad((options) => {
  pick.value = options?.pick === '1'
  waterPick.value = pick.value && (options?.context === 'water' || options?.context === 'post')
  requestId.value = options?.requestId || ''
})
onUnload(() => {
  disposed = true
  version++
  waterVersion++
})
function reset() {
  version++
  items.value = []
  selected.value = null
  searched.value = false
  loading.value = false
  hasMore.value = false
  error.value = ''
  retryMore.value = false
  page.value = 1
}
watch([query, city], reset, { flush: 'sync' })
watch(selected, clearWater, { flush: 'sync' })
watch(city, liveSearch)
watch(
  () => auth.context,
  () => {
    query.value = ''
    city.value = ''
    requestId.value = ''
    reset()
  },
  { flush: 'sync' }
)
async function search(more = false) {
  if (loading.value || (more && !hasMore.value)) return
  if (!query.value.trim()) {
    error.value = '先输入水域、地标或地点名称'
    return
  }
  if (!auth.requireLogin()) return
  const current = ++version,
    nextPage = more ? page.value + 1 : 1
  loading.value = true
  error.value = ''
  retryMore.value = false
  if (!more) {
    items.value = []
    selected.value = null
    hasMore.value = false
  }
  try {
    const result = await searchMapPlaces(query.value, city.value, nextPage)
    if (disposed || current !== version) return
    const combined = more ? [...items.value, ...result.items] : result.items
    items.value = combined.filter(
      (place, index) => combined.findIndex((p) => p.id === place.id) === index
    )
    hasMore.value = result.hasMore
    page.value = nextPage
    searched.value = true
  } catch (e) {
    if (!disposed && current === version) {
      error.value = errorText(e)
      retryMore.value = more
    }
  } finally {
    if (!disposed && current === version) loading.value = false
  }
}
function liveSearch() {
  // Typing must never redirect a guest to login or interrupt the IME.
  if (!query.value.trim()) {
    reset()
    return
  }
  if (auth.signedIn) void search()
}
function choose(id: string) {
  selected.value = items.value.find((p) => p.id === id) || null
  if (waterPick.value) void findNearbyWater()
}
function clearWater() {
  waterVersion++
  waterTarget.value = undefined
  waterSource.value = undefined
  waterLoading.value = false
  waterHint.value = ''
}
async function findNearbyWater() {
  const place = selected.value
  if (!place || waterLoading.value) return
  const current = ++waterVersion
  waterLoading.value = true
  waterHint.value = ''
  try {
    const match = await resolveNearbyWater([place.longitude, place.latitude], 2000, searchMapWaterPlaces)
    if (current !== waterVersion) return
    if (match) {
      waterTarget.value = waterSelection(match.point, match.name, match.nameUnavailable)
      waterSource.value = match.source
      if (match.nameUnavailable) waterHint.value = '水域名称暂时无法读取，可重试。'
    } else {
      waterHint.value = '附近暂无已收录的水域，可换个地点搜索。'
    }
  } catch {
    if (current === waterVersion) waterHint.value = '水域数据暂时无法读取，可重试。'
  } finally {
    if (current === waterVersion) waterLoading.value = false
  }
}
function confirm() {
  const target = waterPick.value ? waterTarget.value : selected.value
  if (!target || !requestId.value || !auth.signedIn) return
  const place: SelectedPlace = {
    longitude: target.longitude,
    latitude: target.latitude,
    name: target.name,
    address: target.address?.slice(0, 240),
    adcode: target.adcode,
    ...(waterPick.value ? { kind: 'water' as const } : {}),
    crs: 'GCJ-02',
    created_at: Date.now()
  }
  if (!validSelection(place)) {
    error.value = '地点信息不完整，请重新搜索'
    return
  }
  uni.setStorageSync(`dyj.map.selection.${requestId.value}`, place)
  uni.navigateBack()
}
</script>
<template>
  <FishingShell :title="waterPick ? '水域地图' : pick ? '选择地点' : '地点搜索'" back>
    <view class="fishing-content stack">
      <view class="stack stack--tight">
        <text class="heading">先找到那片水</text>
        <text class="muted">搜索城市、水域或地标，查看高德静态地图。</text>
      </view>
      <view :key="auth.context" class="panel stack">
        <MobileField field="map-city" label="城市（选填）" hint="选择后只搜索这个城市；留空搜索全国"
          ><FishingCityPicker
            v-model="city"
            field="map-city"
            label="选择搜索城市"
            clearable
        /></MobileField>
        <MobileSearch
          v-model="query"
          name="static-map-search"
          label="搜索高德地点"
          placeholder="水域或地标"
          :maxlength="80"
          action-label=""
          live
          :suggestions="suggestions"
          @search="liveSearch"
          @select="choose"
          @dismiss="reset"
        />
        <MobileAction v-if="!auth.signedIn" class="secondary" @click="auth.requireLogin()"
          >登录后搜索地点</MobileAction
        >
      </view>
      <text class="caption"
        >搜索结果是高德地点，不是钓友认证的钓位。禁钓、开放和安全情况需现场核实。</text
      >
      <MobileLoadError
        v-if="error && (!retryMore || selected)"
        title="地点搜索未完成"
        :message="error"
        @retry="search(retryMore)"
      />
      <MobileLoadingStatus v-if="loading && !items.length" label="正在查找地点…" />
      <view v-if="selected" class="panel stack">
        <text v-if="waterPick" class="caption">搜索地点：{{ selected.name }}</text>
        <view v-else class="stack stack--tight"
          ><text class="badge">{{ pick ? '待回填的位置' : '选中地点' }}</text
          ><text class="heading">{{ selected.name }}</text
          ><text class="caption">{{ selected.address }}</text></view
        >
        <text v-if="waterTarget" :class="waterPick ? 'heading' : 'name'" role="status">{{
          waterTarget.name
        }}</text>
        <text v-if="waterPick && waterTarget" class="caption">{{ formatMapCoordinates(waterTarget.longitude, waterTarget.latitude) }}</text>
        <text v-if="waterPick && waterLoading" class="caption" role="status">正在查找附近水域…</text>
        <MobileAction v-if="waterPick && waterHint" class="secondary" @click="findNearbyWater">重新查找水域</MobileAction>
        <template v-if="!pick">
          <MobileAction
            class="secondary"
            :aria-disabled="waterLoading || undefined"
            @click="waterTarget ? clearWater() : findNearbyWater()"
            >{{ waterTarget ? '查看原地点' : waterLoading ? '正在查找附近水域…' : '查找附近水域' }}</MobileAction
          >
        </template>
        <text v-if="waterHint" class="caption" role="status">{{ waterHint }}</text>
        <StaticMapPreview
          v-if="previewTarget"
          :target="{ longitude: previewTarget.longitude, latitude: previewTarget.latitude }"
          automatic
        />
        <template v-if="pick">
          <text class="muted">确认后返回上一页，不会自动保存或公开。</text>
          <MobileAction class="primary" :disabled="!requestId || (waterPick && !waterTarget)" @click="confirm"
            >{{ waterPick ? '确认这处水域' : '确认这个位置' }}</MobileAction
          >
          <text v-if="!requestId" class="error">请返回表单，重新进入地图选点。</text>
        </template>
        <template v-else>
          <MobileAction class="secondary" @click="zonePanel?.openList()">查看附近禁钓区域</MobileAction>
        </template>
        <text v-if="waterSource === 'index'" class="caption">岸线数据 © OpenStreetMap</text>
        <text v-if="waterSource === 'live'" class="caption">OpenFreeMap · © OpenMapTiles · © OpenStreetMap</text>
      </view>
      <MapZones
        ref="zonePanel"
        v-if="selected && !pick"
        :key="auth.context"
        :bounds="zoneBounds"
        :active="zonesActive"
      />
      <MapWeather
        v-if="selected && !pick"
        :target="{ adcode: selected.adcode || '' }"
        :active="weatherVisible"
        static-mode
      />
      <MobileListFooter v-if="!selected" :loading="loading && (!!items.length || hasMore)"
        :error="retryMore ? error : ''" :can-load-more="hasMore && !loading"
        :finished="searched && !hasMore && !loading && !error" :count="items.length"
        loading-label="正在加载更多地点…" more-text="加载更多地点"
        error-title="更多地点暂未加载" @more="search(true)" />
      <text v-if="searched && !items.length && !hasMore && !loading && !error" class="notice"
        >没有找到相关地点，试试附近的桥、公园或更换城市。</text
      >
      <text class="caption">地图与地点数据由高德提供。</text>
    </view>
  </FishingShell>
</template>
