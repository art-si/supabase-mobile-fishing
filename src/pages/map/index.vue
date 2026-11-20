<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { onHide, onLoad, onReady, onShow, onUnload } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileSearch from '@mobile-core/components/MobileSearch.vue'
import MobileLoadingStatus from '@/components/FishingLoadingStatus.vue'
import FishingEmptyState from '@/components/FishingEmptyState.vue'
import MapZones from '@/components/MapZones.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
// #ifdef H5
import MobileMap from '@mobile-core/components/MobileMap.vue'
import {
  createMapPin,
  type MapFence,
  type MapPoint,
  type MobileMapInstance
} from '@mobile-core/map'
// #endif
import { boundaryAnchor, boundaryPaths } from '@/domain/zone-geometry'
import { useAppearanceStore } from '@/stores/appearance'
import type { Zone, ZoneBounds } from '@/domain/zones'
import { errorText, validCoordinates } from '@/domain/rules'
import { unknownErrorMessage } from '@/domain/user-errors'
import { sameMapBounds } from '@/domain/map-spots'
import { useAuthStore } from '@/stores/auth'
import { read } from '@/services/repository'
import type { Spot } from '@/domain/models'
import { appForeground } from '@/services/app-activity'
import { usePageActivity } from '@mobile-core/page-activity'
import type { SelectedPlace } from '@/platforms/map-navigation'
// #ifdef H5
import {
  loadAmap,
  searchPlaces,
  suggestPlaces,
  locate,
  reverseGeocode,
  type AmapMap,
  type PlaceSuggestion
} from '@/platforms/amap'
// #endif
const auth = useAuthStore(),
  pick = ref(false),
  requestId = ref(''),
  markSpot = ref(''),
  error = ref(''),
  loading = ref(false),
  mapReady = ref(false),
  query = ref(''),
  selected = ref<SelectedPlace | null>(null),
  locationHint = ref(''),
  locating = ref(false),
  searchLoading = ref(false),
  searchError = ref(''),
  searchHint = ref(''),
  results = ref<PlaceSuggestion[]>([])
const appearance = useAppearanceStore()
const stageTop = ref(88)
const fences = ref<MapFence[]>([])
const draftFence = ref<MapPoint[]>([])
const mapPanel = ref<InstanceType<typeof MobileMap>>()
let stageObserver: ResizeObserver | undefined
function measureStage() {
  const node = document.querySelector('.map-stage')
  if (node) stageTop.value = Math.max(0, Math.round(node.getBoundingClientRect().top))
}
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
let pageVisible = true,
  ready = false
const zonePanel = ref<InstanceType<typeof MapZones>>()
function confirmBack() {
  return zonePanel.value?.confirmLeave() || Promise.resolve(true)
}
const suggestions = computed(() =>
  results.value.map((p) => ({ id: p.id, label: p.name, description: p.address }))
)
const zoneBounds = ref<ZoneBounds | null>(null),
  zoneCenter = ref<{ longitude: number; latitude: number; name?: string } | null>(null),
  zonePoint = ref<{ longitude: number; latitude: number } | null>(null),
  zoneDrawing = ref(false),
  zoneFocusRequest = ref<{ id: string } | null>(null)
let disposed = false,
  initVersion = 0,
  selectionVersion = 0,
  searchVersion = 0,
  locationVersion = 0,
  interactionVersion = 0
// #ifdef H5
let map: AmapMap | undefined,
  marker: InstanceType<Awaited<ReturnType<typeof loadAmap>>['Marker']> | undefined,
  locationMarker: InstanceType<Awaited<ReturnType<typeof loadAmap>>['Marker']> | undefined
// #endif
onLoad((options) => {
  pick.value = options?.pick === '1'
  requestId.value = options?.requestId || ''
  markSpot.value = options?.markSpot || ''
})
onReady(() => {
  ready = true
  // #ifdef MP-WEIXIN
  uni.redirectTo({
    url: `/pages/map/search?pick=${pick.value ? '1' : '0'}&requestId=${encodeURIComponent(requestId.value)}`
  })
  // #endif
  // #ifdef H5
  void nextTick(() => {
    measureStage()
    stageObserver = new ResizeObserver(measureStage)
    const header = document.querySelector('.top-bar')
    if (header) stageObserver.observe(header)
    window.addEventListener('resize', measureStage)
  })
  // #endif
})
onShow(() => {
  pageVisible = true
  updateZoneViewport()
  // #ifdef H5
  if (ready && !mapReady.value && !loading.value) void init()
  // #endif
})
onHide(() => {
  pageVisible = false
  locationVersion++
  selectionVersion++
  searchVersion++
  if (locating.value) locationHint.value = ''
  locating.value = false
  searchLoading.value = false
  searchHint.value = ''
  results.value = []
})
onUnload(() => {
  disposed = true
  initVersion++
  selectionVersion++
  searchVersion++
  locationVersion++
  // #ifdef H5
  stageObserver?.disconnect()
  window.removeEventListener('resize', measureStage)
  map = undefined
  // #endif
})
watch(
  () => auth.context,
  () => {
    initVersion++
    selectionVersion++
    searchVersion++
    locationVersion++
    interactionVersion++
    selected.value = null
    results.value = []
    query.value = ''
    locationHint.value = ''
    locating.value = false
    searchError.value = ''
    searchHint.value = ''
    searchLoading.value = false
    error.value = ''
    loading.value = false
    mapReady.value = false
    requestId.value = ''
    // Recreate the map so the previous account’s center and area details disappear.
    // #ifdef H5
    map = undefined
    marker = undefined
    locationMarker = undefined
    fences.value = []
    draftFence.value = []
    zoneBounds.value = null
    zoneCenter.value = null
    zonePoint.value = null
    zoneDrawing.value = false
    zoneFocusRequest.value = null
    // #endif
  },
  { flush: 'sync' }
)
function interacted() {
  placePreviewVersion++
  interactionVersion++
  locationVersion++
  if (locating.value) locationHint.value = ''
  locating.value = false
}
function mapInteracted() {
  dismissSearch()
  interacted()
}
watch(
  query,
  () => {
    interacted()
    searchVersion++
    results.value = []
    searchError.value = ''
    searchHint.value = ''
    searchLoading.value = false
  },
  { flush: 'sync' }
)
function dismissSearch() {
  searchVersion++
  placePreviewVersion++
  results.value = []
  searchLoading.value = false
  searchHint.value = ''
}
function init() {
  error.value = ''
  void mapPanel.value?.reload()
}
function mapCreated(instance: MobileMapInstance) {
  // #ifdef H5
  map = instance
  mapReady.value = true
  const interaction = interactionVersion
  map.on('dragend', updateZoneViewport)
  map.on('click', (event) => {
    interacted()
    if (zoneDrawing.value)
      zonePoint.value = { longitude: event.lnglat.getLng(), latitude: event.lnglat.getLat() }
    else if (pick.value) void selectPoint(event.lnglat.getLng(), event.lnglat.getLat())
  })
  map.on('dblclick', (event) => {
    if (!zoneDrawing.value) return
    // AMap emits dblclick instead of the second click for quick consecutive taps,
    // even with doubleClickZoom disabled. Keep that second boundary point.
    const longitude = event.lnglat.getLng(),
      latitude = event.lnglat.getLat()
    if (zonePoint.value?.longitude === longitude && zonePoint.value?.latitude === latitude) return
    interacted()
    zonePoint.value = { longitude, latitude }
  })
  for (const event of ['moveend', 'zoomend', 'complete']) map.on(event, updateZoneViewport)
  updateZoneViewport()
  void nextTick(measureStage)
  if (markSpot.value) void startSpotFence(markSpot.value)
  else if (interaction === interactionVersion) void position(true)
  // #endif
}
async function startSpotFence(id: string) {
  // #ifdef H5
  const scope = auth.context
  try {
    const spot = await read<Spot>('spot', { id })
    if (disposed || auth.context !== scope || !map) return
    if (spot.author.id !== auth.userId || !validCoordinates(spot.longitude, spot.latitude))
      throw new Error('请先为自己的钓位选择地图位置')
    interacted()
    map.setCenter([spot.longitude!, spot.latitude!])
    map.setZoom(16)
    updateZoneViewport()
    await nextTick()
    zonePanel.value?.start({
      title: `${spot.name}禁钓区`.slice(0, 60),
      location: spot.location_label || `${spot.city} ${spot.name}`
    })
    markSpot.value = ''
  } catch (cause) {
    if (auth.context === scope && !disposed) error.value = errorText(cause)
  }
  // #endif
}
function mapFailed(cause: unknown) {
  mapReady.value = false
  const message = errorText(cause)
  error.value =
    message === unknownErrorMessage ? '地图服务暂时没有响应，请检查网络后重试。' : message
}
function updateZoneViewport() {
  // #ifdef H5
  if (!map) return
  const bounds = map.getBounds?.(),
    center = map.getCenter()
  if (bounds) {
    const sw = bounds.getSouthWest(),
      ne = bounds.getNorthEast()
    const nextBounds = {
      west: Math.max(-180, sw.getLng()),
      south: Math.max(-85, sw.getLat()),
      east: Math.min(180, ne.getLng()),
      north: Math.min(85, ne.getLat())
    }
    if (!sameMapBounds(zoneBounds.value, nextBounds)) {
      zoneBounds.value = nextBounds
    }
  }
  zoneCenter.value = { longitude: center.getLng(), latitude: center.getLat() }
  // #endif
}
function drawZoneOverlays(zones: Zone[]) {
  fences.value = zones
    .filter((zone) => zone.boundary)
    .map((zone) => ({
      id: zone.id,
      label: `查看禁钓区域：${zone.title}，${zone.source === 'official' ? '官方公告' : '钓友上报'}`,
      paths: boundaryPaths(zone.boundary),
      point: boundaryAnchor(zone.boundary!),
      dashed: zone.source === 'community'
    }))
}
function drawZonePreview(points: MapPoint[]) {
  draftFence.value = points
}
function drawingZone(value: boolean) {
  zoneDrawing.value = value
  // #ifdef H5
  map?.setStatus?.({ doubleClickZoom: !value })
  if (value) {
    dismissSearch()
    if (marker) map?.remove(marker)
    marker = undefined
    selected.value = null
  }
  // #endif
  if (value) interacted()
}
function focusZone(zone: Zone) {
  // #ifdef H5
  interacted()
  map?.setCenter([zone.longitude, zone.latitude])
  // #endif
}
async function selectPoint(longitude: number, latitude: number, name?: string) {
  if (!validCoordinates(longitude, latitude)) return
  const version = ++selectionVersion
  selected.value = {
    longitude,
    latitude,
    name: name || '已选位置',
    crs: 'GCJ-02',
    created_at: Date.now()
  }
  // #ifdef H5
  const amap = await loadAmap()
  if (disposed || version !== selectionVersion) return
  if (marker) marker.setPosition([longitude, latitude])
  else {
    marker = new amap.Marker({
      position: [longitude, latitude],
      content: createMapPin(name || '已选地点'),
      anchor: 'bottom-center',
      offset: new amap.Pixel(0, 0),
      zIndex: 120
    })
    map?.add(marker)
  }
  if (!name) {
    try {
      const label = await reverseGeocode([longitude, latitude])
      if (!disposed && version === selectionVersion && selected.value) selected.value.name = label
    } catch {
      /* Coordinates remain usable when geocoder fails. */
    }
  }
  // #endif
}
async function search(keyword = query.value, exact = false) {
  // #ifdef H5
  const version = ++searchVersion
  searchError.value = ''
  searchHint.value = ''
  if (!keyword.trim()) {
    results.value = []
    searchLoading.value = false
    return
  }
  searchLoading.value = true
  try {
    const list: PlaceSuggestion[] = exact
      ? (await searchPlaces(keyword))
          .filter((p) => p.location)
          .map((p) => ({
            id: p.id,
            name: p.name,
            address: p.address,
            longitude: p.location.getLng(),
            latitude: p.location.getLat()
          }))
      : await suggestPlaces(keyword)
    if (disposed || version !== searchVersion) return
    results.value = list
    if (!list.length) searchHint.value = '没有找到地点，试试附近的桥、公园或补充城市名。'
  } catch (e) {
    if (!disposed && version === searchVersion) searchError.value = errorText(e)
  } finally {
    if (!disposed && version === searchVersion) searchLoading.value = false
  }
  // #endif
}
let placePreviewVersion = 0
async function previewPlace(id: string) {
  const version = ++placePreviewVersion
  const place = results.value.find((p) => p.id === id)
  if (!place || !pageVisible) return
  let longitude = place.longitude,
    latitude = place.latitude
  // #ifdef H5
  if (!validCoordinates(longitude, latitude)) {
    try {
      const found = (
        await searchPlaces([place.address, place.name].filter(Boolean).join(' '))
      ).find((p) => p.location)
      if (disposed || version !== placePreviewVersion || !results.value.some((p) => p.id === id))
        return
      longitude = found?.location.getLng()
      latitude = found?.location.getLat()
    } catch {
      return
    }
  }
  if (disposed || version !== placePreviewVersion || !validCoordinates(longitude, latitude)) return
  map?.setCenter([longitude!, latitude!])
  map?.setZoom(14)
  await selectPoint(longitude!, latitude!, place.name)
  // #endif
}
async function choosePlace(id: string) {
  const place = results.value.find((p) => p.id === id)
  if (!place) return
  interacted()
  searchVersion++
  if (!validCoordinates(place.longitude, place.latitude)) {
    await search(place.name, true)
    return
  }
  const longitude = place.longitude!,
    latitude = place.latitude!
  // #ifdef H5
  map?.setCenter([longitude, latitude])
  map?.setZoom(14)
  // #endif
  results.value = []
  searchHint.value = ''
  await selectPoint(longitude, latitude, place.name)
}
async function position(silent = false) {
  // #ifdef H5
  if (locating.value) return
  const version = ++locationVersion
  locating.value = true
  locationHint.value = ''
  try {
    const { point, accuracyM } = await locate()
    if (disposed || version !== locationVersion || !map) return
    if (!validCoordinates(...point)) throw new Error('暂时无法取得位置，可以搜索地点或手动选点')
    map?.setCenter(point)
    map?.setZoom(15)
    const amap = await loadAmap()
    if (disposed || version !== locationVersion || !map) return
    if (locationMarker) locationMarker.setPosition(point)
    else {
      locationMarker = new amap.Marker({
        position: point,
        title: '当前位置',
        content: createMapPin('当前位置'),
        anchor: 'bottom-center',
        offset: new amap.Pixel(0, 0),
        zIndex: 110
      })
      map.add(locationMarker)
    }
    locationHint.value = pick.value
      ? '已定位到附近。请选点确认，不会自动保存或公开位置。'
      : '已定位到附近，当前位置不会自动保存或公开。'
    if (typeof accuracyM === 'number' && accuracyM >= 100)
      locationHint.value = `定位误差约 ${Math.ceil(accuracyM)} 米。${locationHint.value}`
  } catch (e) {
    if (!disposed && version === locationVersion && !silent)
      uni.showToast({ title: errorText(e), icon: 'none', duration: 4000 })
  } finally {
    if (!disposed && version === locationVersion) locating.value = false
  }
  // #endif
}
async function confirm() {
  if (!selected.value || !requestId.value) return
  // #ifdef H5
  try {
    uni.setStorageSync(`dyj.map.selection.${requestId.value}`, {
      ...selected.value,
      created_at: Date.now()
    })
    uni.navigateBack()
  } catch (e) {
    error.value = errorText(e)
  }
  // #endif
}
</script>
<template>
  <FishingShell
    :title="pick ? '选择地点' : '水域地图'"
    back
    edge-to-bottom
    :confirm-back="confirmBack"
    :action="pick || !mapReady || loading ? undefined : '标记禁钓区'"
    action-icon="flag"
    @action="zonePanel?.start()"
  >
    <view
      class="map-stage"
      :class="{ 'map-stage--failed': !!error && !loading }"
      :style="{ '--map-stage-top': stageTop + 'px' }"
    >
      <!-- #ifdef H5 -->
      <MobileMap
        ref="mapPanel"
        :load="loadAmap"
        :reload-key="auth.context"
        :fences="zoneDrawing ? [] : fences"
        :draft="draftFence"
        :selected-fence="zoneFocusRequest?.id"
        :fence-color="appearance.palette.danger"
        label="高德互动地图"
        @ready="mapCreated"
        @loading="loading = $event"
        @error="mapFailed"
        @fence="zoneFocusRequest = { id: $event }"
        @interact="mapInteracted"
      >
        <template #search>
          <MobileSearch
            :key="auth.context"
            v-model="query"
            name="map-search"
            label="搜索高德地点"
            placeholder="城市、水域或地点"
            action-label=""
            live
            auto-select-first
            floating-suggestions
            suggestion-icon="location-fill"
            :suggestions="suggestions"
            :suggestion-status="searchLoading ? '正在查找地点…' : searchHint"
            :disabled="!mapReady || zoneDrawing"
            @search="search($event)"
            @select="choosePlace"
            @preview="previewPlace"
            @dismiss="dismissSearch"
          />
        </template>
        <template #controls>
          <MobileAction
            v-if="mapReady && !zoneDrawing"
            variant="icon"
            class="map-control"
            aria-label="地图内禁钓区域"
            @click="zonePanel?.openList()"
            ><MobileIcon name="shield" size="22px"
          /></MobileAction>
          <MobileAction
            v-if="mapReady && !zoneDrawing"
            variant="icon"
            class="map-control"
            :aria-label="locating ? '定位中' : '回到当前位置'"
            :disabled="locating"
            @click="position()"
            ><MobileIcon name="locate" size="22px"
          /></MobileAction>
        </template>
        <template #loading><MobileLoadingStatus label="正在加载地图…" /></template>
        <template #status>
          <text v-if="searchError" class="map-status" role="status">{{ searchError }}</text>
        </template>
        <template v-if="pick && selected" #selection
          ><view class="map-selection stack stack--tight"
            ><text class="name">{{ selected.name }}</text
            ><MobileAction class="primary" :disabled="!requestId" @click="confirm"
              >确认这个位置</MobileAction
            ></view
          ></template
        >
      </MobileMap>
      <view v-if="error && !loading" class="map-unavailable">
        <view class="map-unavailable__content stack">
          <FishingEmptyState icon="location" title="地图暂时未能加载" :description="error" />
          <MobileAction class="primary" @click="init">重新加载地图</MobileAction>
        </view>
      </view>
      <!-- #endif -->
      <MapZones
        ref="zonePanel"
        v-if="mapReady"
        :key="auth.context"
        :bounds="zoneBounds"
        :center="zoneCenter"
        :point="zonePoint"
        :pick="pick"
        :active="zonesActive"
        :focus-request="zoneFocusRequest"
        @overlays="drawZoneOverlays"
        @preview="drawZonePreview"
        @drawing="drawingZone"
        @focus="focusZone"
      />
    </view>
  </FishingShell>
</template>
<style scoped>
.map-stage {
  position: relative;
  height: calc(100vh - var(--map-stage-top));
  height: calc(100dvh - var(--map-stage-top));
  min-height: 220px;
  --mobile-map-fence-color: var(--danger);
  --mobile-map-search-max-width: none;
  --mobile-search-selection: var(--lake-soft);
}
.map-control {
  width: 48px;
  height: 48px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--paper);
  color: var(--ink);
  box-shadow: 0 1px 6px #0002;
}
.map-status {
  display: block;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--paper);
  color: var(--ink);
  font-size: 0.875rem;
  pointer-events: auto;
}
.map-stage--failed :deep(.mobile-map__canvas) {
  visibility: hidden;
}
.map-unavailable {
  position: absolute;
  inset: 76px 16px 32px;
  z-index: 96;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow-y: auto;
}
.map-unavailable__content {
  width: 100%;
  max-width: 320px;
  margin-block: auto;
  padding: 16px 0;
}
@media (orientation: landscape) and (max-height: 500px) {
  .map-unavailable {
    align-items: flex-start;
  }
  .map-unavailable__content {
    max-width: 460px;
  }
}
.map-selection {
  padding: 12px;
  border-radius: 16px;
  background: var(--paper);
  margin-right: 60px;
  box-shadow: 0 1px 6px #0002;
}
</style>
