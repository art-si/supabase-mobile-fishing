<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import StaticMapPreview from '@/components/StaticMapPreview.vue'
import MapZones from '@/components/MapZones.vue'
import MapWeather from '@/components/MapWeather.vue'
import PostLocationPicker from '@/components/PostLocationPicker.vue'
import { circleBounds, type ZoneCircle } from '@/domain/zones'
import MobileField from '@mobile-core/components/MobileField.vue'
import FishingCityPicker from '@/components/FishingCityPicker.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileSearch from '@mobile-core/components/MobileSearch.vue'
import MobileLoadingStatus from '@/components/FishingLoadingStatus.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import { useAuthStore } from '@/stores/auth'
import { appForeground } from '@/services/app-activity'
import { usePageActivity } from '@mobile-core/page-activity'
import { searchMapPlaces } from '@/services/amap'
import { errorText } from '@/domain/rules'
import { validSelection, type MapPlace, type SelectedPlace } from '@/domain/map'
const auth = useAuthStore(),
  pick = ref(false),
  postPicker = ref(false),
  requestId = ref(''),
  query = ref(''),
  city = ref('')
const items = ref<MapPlace[]>([]),
  selected = ref<MapPlace | null>(null),
  page = ref(1)
const error = ref(''),
  loading = ref(false),
  searched = ref(false),
  hasMore = ref(false)
const suggestions = computed(() =>
  selected.value
    ? []
    : items.value.map((p) => ({ id: p.id, label: p.name, description: p.address }))
)
const zonePreview = ref<ZoneCircle | null>(null)
const zoneDrawing = ref(false)
const weatherVisible = ref(true)
const zonesActive = ref(false)
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
})
onHide(() => {
  weatherVisible.value = false
})
const zonePanel = ref<InstanceType<typeof MapZones>>()
function confirmBack() {
  return zonePanel.value?.confirmLeave() || Promise.resolve(true)
}
let previewTimer: ReturnType<typeof setTimeout> | undefined
function previewCircle(value: ZoneCircle | null) {
  clearTimeout(previewTimer)
  if (!value) {
    zonePreview.value = null
    return
  }
  previewTimer = setTimeout(() => {
    zonePreview.value = value
  }, 600)
}
const zoneBounds = computed(() =>
  selected.value ? circleBounds({ ...selected.value, radius_m: 5000 }) : null
)
let version = 0,
  disposed = false
onLoad((options) => {
  pick.value = options?.pick === '1'
  postPicker.value = pick.value && options?.context === 'post'
  requestId.value = options?.requestId || ''
})
onUnload(() => {
  disposed = true
  version++
  clearTimeout(previewTimer)
})
function reset() {
  version++
  items.value = []
  selected.value = null
  zonePreview.value = null
  zoneDrawing.value = false
  clearTimeout(previewTimer)
  searched.value = false
  loading.value = false
  hasMore.value = false
  error.value = ''
  page.value = 1
}
watch([query, city], reset, { flush: 'sync' })
watch(city, liveSearch)
watch(
  () => auth.context,
  () => {
    if (postPicker.value) return
    query.value = ''
    city.value = ''
    requestId.value = ''
    reset()
  },
  { flush: 'sync' }
)
async function search(more = false) {
  if (loading.value) return
  if (!query.value.trim()) {
    error.value = '先输入水域、地标或地点名称'
    return
  }
  if (!auth.requireLogin()) return
  const current = ++version,
    nextPage = more ? page.value + 1 : 1
  loading.value = true
  error.value = ''
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
    if (!disposed && current === version) error.value = errorText(e)
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
}
function confirm() {
  if (!selected.value || !requestId.value || !auth.signedIn) return
  const place: SelectedPlace = {
    longitude: selected.value.longitude,
    latitude: selected.value.latitude,
    name: selected.value.name,
    address: selected.value.address.slice(0, 240),
    adcode: selected.value.adcode,
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
  <FishingShell :title="pick ? '选择地点' : '地点搜索'" back :confirm-back="confirmBack">
    <PostLocationPicker v-if="postPicker" :request-id="requestId" />
    <view v-else class="fishing-content stack">
      <view class="stack stack--tight">
        <text class="heading">先找到那片水</text>
        <text class="muted">搜索城市、水域或地标，查看高德静态地图。无需开启定位。</text>
      </view>
      <view :key="auth.context" class="panel stack">
        <MobileField field="map-city" label="城市（选填）" hint="选择后只搜索这个城市；留空搜索全国"
          ><FishingCityPicker
            v-model="city"
            field="map-city"
            label="选择搜索城市"
            clearable
            :disabled="zoneDrawing"
        /></MobileField>
        <MobileSearch
          v-model="query"
          :disabled="zoneDrawing"
          name="static-map-search"
          label="搜索高德地点"
          placeholder="水库、河流、桥或公园"
          :maxlength="80"
          action-label=""
          live
          :suggestions="suggestions"
          :suggestion-status="loading ? '正在查找地点…' : ''"
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
        v-if="error"
        title="地点搜索未完成"
        :message="error"
        @retry="search(false)"
      />
      <view v-if="selected" class="panel stack">
        <view class="stack stack--tight"
          ><text class="badge">{{ pick ? '待回填的位置' : '选中地点' }}</text
          ><text class="heading">{{ selected.name }}</text
          ><text class="caption">{{ selected.address }}</text></view
        >
        <StaticMapPreview
          :target="{
            longitude: selected.longitude,
            latitude: selected.latitude,
            ...(zonePreview ? { radiusM: zonePreview.radius_m } : {})
          }"
          automatic
        />
        <template v-if="pick">
          <text class="muted">确认后返回上一页，不会自动保存或公开。</text>
          <MobileAction class="primary" :disabled="!requestId" @click="confirm"
            >确认这个位置</MobileAction
          >
          <text v-if="!requestId" class="error">请从钓位编辑页重新进入选点。</text>
        </template>
      </view>
      <MapZones
        ref="zonePanel"
        v-if="selected"
        :key="auth.context"
        :bounds="zoneBounds"
        :center="selected"
        :pick="pick"
        :active="zonesActive"
        static-mode
        @drawing="zoneDrawing = $event"
      />
      <MapWeather
        v-if="selected && !pick && !zoneDrawing"
        :target="{ adcode: selected.adcode || '' }"
        :active="weatherVisible"
        static-mode
      />
      <MobileAction v-if="!selected && !loading && hasMore" class="secondary" @click="search(true)"
        >加载更多地点</MobileAction
      >
      <text v-if="searched && !items.length && !loading && !error" class="notice"
        >没有找到相关地点，试试附近的桥、公园或更换城市。</text
      >
      <text class="caption">地图与地点数据由高德提供。</text>
    </view>
  </FishingShell>
</template>
