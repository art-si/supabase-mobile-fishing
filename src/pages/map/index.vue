<script setup lang="ts">
import { computed, ref, watch, watchPostEffect, type ComponentPublicInstance } from 'vue'
import { onHide, onLoad, onReady, onShow, onUnload } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileSearch from '@mobile-core/components/MobileSearch.vue'
// #ifdef MP-WEIXIN
import MiniWaterMap from './components/MiniWaterMap.vue'
// #endif
import FishingEmptyState from '@/components/FishingEmptyState.vue'
import MapZones from '@/components/MapZones.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
// #ifdef H5
import MobileMap from '@mobile-core/components/MobileMap.vue'
import {
  createMapPin,
  createMapImagePin,
  type MapFence,
  type MapPoint,
  type MobileMapInstance,
  type MobileMapSdk
} from '@mobile-core/map'
import noFishingPin from '@/brand/no-fishing-pin.png'
// #endif
import { boundaryAnchor, boundaryBounds, boundaryPaths } from '@/domain/zone-geometry'
import { useAppearanceStore } from '@/stores/appearance'
import { zoneSourceLabels, type Zone, type ZoneBounds } from '@/domain/zones'
import { errorText, validCoordinates } from '@/domain/rules'
import { unknownErrorMessage } from '@/domain/user-errors'
import { sameMapBounds } from '@/domain/map-spots'
import { useAuthStore } from '@/stores/auth'
import { appForeground } from '@/services/app-activity'
import { usePageActivity } from '@mobile-core/page-activity'
import { returnMapSelection, type SelectedPlace } from '@/platforms/map-navigation'
import { formatMapCoordinates, placeSelection, waterSelection } from '@/domain/map'
import type { EntryLocation } from '@/platforms/entry-location'
// #ifdef H5
import { entryPosition } from '@/services/entry-location'
import {
  loadAmap,
  searchPlaces,
  suggestPlaces,
  locate,
  nearbyWaterPlaces,
  reverseGeocode,
  reversePlaceName,
  type AmapMap,
  type PlaceSuggestion
} from '@/platforms/amap'
import { waterTapRadiusM } from '@/domain/water-geometry'
import { resolveNearbyWater, type NearbyWater } from '@/services/nearby-water'
// #endif
const auth = useAuthStore(),
  pageOptionsReady = ref(false),
  pick = ref(false),
  waterPick = ref(false),
  requestId = ref(''),
  error = ref(''),
  loading = ref(false),
  mapReady = ref(false),
  query = ref(''),
  focusedPlace = ref(''),
  selected = ref<SelectedPlace | null>(null),
  locationHint = ref(''),
  waterAttribution = ref<'index' | 'live' | ''>(''),
  zoneAttribution = ref(false),
  locating = ref(false),
  searchLoading = ref(false),
  searchError = ref(''),
  searchHint = ref(''),
  results = ref<PlaceSuggestion[]>([])
const appearance = useAppearanceStore()
const placePick = computed(() => pick.value && !waterPick.value)
const staticSearchUrl = computed(() =>
  `/pages/map/search?pick=${pick.value ? '1' : '0'}&requestId=${encodeURIComponent(requestId.value)}${waterPick.value ? '&context=water' : ''}`
)
const waterLookupHint = '正在查找附近水域…'
const waterTapPixels = 160
const fences = ref<MapFence[]>([])
const mapPanel = ref<InstanceType<typeof MobileMap>>()
// Start with an area overview until the device supplies its actual position.
const overview = { center: [104, 34], zoom: 4, viewMode: '3D', pitch: 0, rotateEnable: false }
const threeDimensional = ref(false), perspectiveAvailable = ref(false)
function togglePerspective() {
  // #ifdef H5
  if (!perspectiveAvailable.value || !map?.setPitch || !map.getPitch || pinDragging.value) return
  map.setPitch(threeDimensional.value ? 0 : 40, true)
  threeDimensional.value = map.getPitch() > 0
  // #endif
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
// #ifdef H5
const searchStack = ref<HTMLElement | ComponentPublicInstance>()
const waterCredit = ref<HTMLElement>()
const pinDragging = ref(false)
const creditHeight = ref(0)
watchPostEffect(cleanup => {
  const credit = waterCredit.value
  const measure = () => { creditHeight.value = credit?.offsetHeight ?? 0 }
  measure()
  if (!credit || typeof ResizeObserver === 'undefined') return
  const observer = new ResizeObserver(measure)
  observer.observe(credit)
  cleanup(() => observer.disconnect())
})
watchPostEffect(cleanup => {
  const element = searchStack.value instanceof HTMLElement ? searchStack.value : searchStack.value?.$el
  if (!(element instanceof HTMLElement)) return
  element.addEventListener('focusin', activateSearch)
  element.addEventListener('click', activateSearch)
  element.addEventListener('keydown', preserveSearchValue, true)
  cleanup(() => {
    element.removeEventListener('focusin', activateSearch)
    element.removeEventListener('click', activateSearch)
    element.removeEventListener('keydown', preserveSearchValue, true)
  })
})
// #endif
const suggestions = computed(() =>
  results.value.map((p) => ({ id: p.id, label: p.name, description: p.address }))
)
const zoneBounds = ref<ZoneBounds | null>(null),
  zoneFocusRequest = ref<{ id: string } | null>(null)
let disposed = false,
  selectionVersion = 0,
  searchVersion = 0,
  locationVersion = 0
// #ifdef H5
let map: AmapMap | undefined,
  mapSdk: MobileMapSdk | undefined,
  marker: InstanceType<Awaited<ReturnType<typeof loadAmap>>['Marker']> | undefined,
  locationMarker: InstanceType<Awaited<ReturnType<typeof loadAmap>>['Marker']> | undefined
let selectedWaterOverlay: unknown
const spotPins = new Map<string, {
  marker: InstanceType<MobileMapSdk['Marker']>
  button: HTMLButtonElement
  point: MapPoint
}>()
// #endif
onLoad((options) => {
  pick.value = options?.pick === '1'
  waterPick.value = pick.value && (options?.context === 'water' || options?.context === 'post')
  requestId.value = options?.requestId || ''
  // Native children can mount before this page receives its route options.
  // Start location lookup only after the requested picker mode is known.
  pageOptionsReady.value = true
})
onReady(() => {
  ready = true
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
  pinDragging.value = false
  locationVersion++
  selectionVersion++
  searchVersion++
  if (locating.value || locationHint.value === waterLookupHint) locationHint.value = ''
  locating.value = false
  searchLoading.value = false
  searchHint.value = ''
  results.value = []
})
onUnload(() => {
  disposed = true
  selectionVersion++
  searchVersion++
  locationVersion++
  // #ifdef H5
  map = undefined
  mapSdk = undefined
  selectedWaterOverlay = undefined
  spotPins.clear()
  // #endif
})
watch(
  () => auth.context,
  () => {
    selectionVersion++
    searchVersion++
    locationVersion++
    selected.value = null
    results.value = []
    query.value = ''
    focusedPlace.value = ''
    locationHint.value = ''
    waterAttribution.value = ''
    zoneAttribution.value = false
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
    mapSdk = undefined
    spotPins.clear()
    marker = undefined
    locationMarker = undefined
    selectedWaterOverlay = undefined
    fences.value = []
    zoneBounds.value = null
    zoneFocusRequest.value = null
    // #endif
  },
  { flush: 'sync' }
)
function interacted() {
  placePreviewVersion++
  locationVersion++
  locationHint.value = ''
  locating.value = false
}
function mapInteracted() {
  dismissSearch()
  interacted()
}
function openZonesList() {
  interacted()
  zonePanel.value?.openList()
}
function editSearch(value: string) {
  focusedPlace.value = ''
  query.value = value
  interacted()
  dismissSearch()
  searchError.value = ''
  clearWaterPick()
  if (placePick.value && selected.value) {
    selectionVersion++
    selected.value = null
    // #ifdef H5
    if (marker) map?.remove(marker)
    marker = undefined
    // #endif
  }
}
function clearWaterPick() {
  pinDragging.value = false
  if (!waterPick.value) return
  selected.value = null
  // #ifdef H5
  if (locationMarker) map?.remove(locationMarker)
  if (selectedWaterOverlay) map?.remove(selectedWaterOverlay)
  locationMarker = undefined
  selectedWaterOverlay = undefined
  waterAttribution.value = ''
  // #endif
}
// #ifdef H5
function activateSearch(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement) || target.name !== 'map-search' ||
      !mapReady.value || searchLoading.value || results.value.length) return
  const keyword = (focusedPlace.value || query.value).trim()
  if (keyword) void search(keyword, false, true)
}
function preserveSearchValue(event: KeyboardEvent) {
  if (event.key === 'Escape' && event.target instanceof HTMLInputElement &&
      event.target.name === 'map-search' && (focusedPlace.value || results.value.length)) {
    event.preventDefault()
  }
}
// #endif
function dismissSearch() {
  searchVersion++
  placePreviewVersion++
  results.value = []
  searchLoading.value = false
  searchHint.value = ''
  if (locationHint.value === waterLookupHint) locationHint.value = ''
}
function init() {
  error.value = ''
  void mapPanel.value?.reload()
}
function mapCreated(instance: MobileMapInstance, sdk: MobileMapSdk) {
  // #ifdef H5
  locationVersion++
  locating.value = false
  locationHint.value = ''
  focusedPlace.value = ''
  waterAttribution.value = ''
  zoneAttribution.value = false
  map = instance
  threeDimensional.value = false
  perspectiveAvailable.value = window.AMap?.Browser?.isWebGL !== false && !!map.setPitch && !!map.getPitch
  mapSdk = sdk
  selected.value = null
  spotPins.clear()
  marker = undefined
  locationMarker = undefined
  selectedWaterOverlay = undefined
  mapReady.value = true
  instance.on('complete', () => {
    if (disposed || map !== instance || !error.value) return
    error.value = ''
    mapReady.value = true
    if (pageVisible && entryPosition.value && !selected.value) void position(entryPosition.value)
  })
  map.on('dragend', updateZoneViewport)
  map.on('click', (event) => {
    mapInteracted()
    const point: MapPoint = [event.lnglat.getLng(), event.lnglat.getLat()]
    if (placePick.value) void selectPoint(...point)
    else void focusNearbyWater(point, 'tap').catch(() => {
      if (pageVisible) locationHint.value = '暂时无法显示附近水域。'
    })
  })
  for (const event of ['moveend', 'zoomend', 'complete']) map.on(event, updateZoneViewport)
  map.on('resize', () => requestAnimationFrame(() => {
    if (map === instance && pageVisible) updateZoneViewport()
  }))
  updateZoneViewport()
  if (pageVisible) void position(entryPosition.value)
  // #endif
}
function mapFailed(cause: unknown) {
  clearWaterPick()
  mapReady.value = false
  locationVersion++
  locating.value = false
  locationHint.value = ''
  focusedPlace.value = ''
  waterAttribution.value = ''
  const message = errorText(cause)
  error.value =
    message === unknownErrorMessage ? '地图服务暂时没有响应，请检查网络后重试。' : message
}
function updateZoneViewport() {
  // #ifdef H5
  if (!map) return
  const bounds = map.getBounds?.()
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
  // #endif
}
function drawZoneOverlays(zones: Zone[]) {
  zoneAttribution.value = zones.some(zone => !!zone.water_source_url)
  fences.value = zones
    .filter((zone) => zone.boundary && zone.source !== 'spot')
    .map((zone) => ({
      id: zone.id,
      label: `查看禁钓区域：${zone.title}，${zoneSourceLabels[zone.source]}`,
      paths: boundaryPaths(zone.boundary),
      point: boundaryAnchor(zone.boundary!),
      dashed: zone.source !== 'official'
    }))
  // #ifdef H5
  drawSpotPins(zones)
  // #endif
}
// #ifdef H5
function drawSpotPins(zones: Zone[]) {
  const instance = map, sdk = mapSdk
  if (!instance || !sdk) return

  const visible = new Set<string>()
  for (const zone of zones) {
    if ((zone.source !== 'spot' && zone.boundary) || !validCoordinates(zone.longitude, zone.latitude)) continue
    visible.add(zone.id)
    const point: MapPoint = [zone.longitude, zone.latitude]
    const label = `查看禁钓点位：${zone.title}`
    const existing = spotPins.get(zone.id)
    if (existing) {
      if (point[0] !== existing.point[0] || point[1] !== existing.point[1]) {
        existing.marker.setPosition(point)
        existing.point = point
      }
      existing.button.setAttribute('aria-label', label)
      continue
    }

    const button = createMapImagePin(noFishingPin, label)
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      interacted()
      zoneFocusRequest.value = { id: zone.id }
    })
    const pin = new sdk.Marker({
      position: point, content: button, anchor: 'bottom-center', zIndex: 95, bubble: false
    })
    instance.add(pin)
    spotPins.set(zone.id, { marker: pin, button, point })
  }
  for (const [id, pin] of spotPins) {
    if (visible.has(id)) continue
    instance.remove(pin.marker)
    spotPins.delete(id)
  }
}
// #endif
async function selectPoint(longitude: number, latitude: number, place?: PlaceSuggestion) {
  if (!validCoordinates(longitude, latitude)) return
  const version = ++selectionVersion
  selected.value = placeSelection([longitude, latitude], place)
  // #ifdef H5
  const amap = await loadAmap()
  if (disposed || version !== selectionVersion) return
  const pin = createMapPin(selected.value.name)
  if (marker) {
    marker.setPosition([longitude, latitude])
    marker.setContent(pin)
  } else {
    marker = new amap.Marker({
      position: [longitude, latitude],
      content: pin,
      anchor: 'bottom-center',
      offset: new amap.Pixel(0, 0),
      zIndex: 120
    })
    map?.add(marker)
  }
  if (!place) {
    try {
      const label = await reverseGeocode([longitude, latitude])
      if (!disposed && version === selectionVersion && selected.value) {
        selected.value = placeSelection([longitude, latitude], { name: label })
        pin.setAttribute('aria-label', selected.value.name)
      }
    } catch {
      /* Coordinates remain usable when geocoder fails. */
    }
  }
  // #endif
}
async function search(keyword = query.value, exact = false, activated = false) {
  // #ifdef H5
  if (focusedPlace.value && !activated && !exact) return
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
            address: typeof p.address === 'string' ? p.address : '',
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
// #ifdef H5
async function suggestionPoint(place: PlaceSuggestion): Promise<MapPoint | undefined> {
  if (validCoordinates(place.longitude, place.latitude)) return [place.longitude!, place.latitude!]
  const match = (await searchPlaces([place.address, place.name].filter(Boolean).join(' ')))
    .find(item => item.location)
  const longitude = match?.location.getLng(),
    latitude = match?.location.getLat()
  if (validCoordinates(longitude, latitude)) return [longitude!, latitude!]
}
// #endif
async function previewPlace(id: string) {
  if (pick.value) return
  const version = ++placePreviewVersion
  const place = results.value.find((p) => p.id === id)
  if (!place || !pageVisible) return
  // #ifdef H5
  const current = () => !disposed && pageVisible && version === placePreviewVersion &&
    results.value.some((result) => result.id === id)
  try {
    const point = await suggestionPoint(place)
    if (!current() || !point) return
    await focusNearbyWater(point, 'preview', current)
  } catch {
    // Preview should not interrupt the current text search.
  }
  // #endif
}
async function choosePlace(id: string) {
  const place = results.value.find((p) => p.id === id)
  if (!place) return
  interacted()
  clearWaterPick()
  const version = ++searchVersion
  // #ifdef H5
  if (!placePick.value) {
    const current = () => !disposed && pageVisible && version === searchVersion
    try {
      const point = await suggestionPoint(place)
      if (!current()) return
      if (point) await focusNearbyWater(point, 'search', current)
      else searchHint.value = '未找到这个地点，请换个关键词。'
    } catch (cause) {
      if (current()) searchError.value = errorText(cause)
    }
    return
  }
  // #endif
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
  dismissSearch()
  await selectPoint(longitude, latitude, place)
}
async function position(initial?: EntryLocation | null) {
  // #ifdef H5
  const instance = map
  if (!instance || !mapReady.value || !pageVisible || locating.value) return
  if (waterPick.value) {
    dismissSearch()
    clearWaterPick()
  }
  const version = ++locationVersion
  const current = () => !disposed && pageVisible && version === locationVersion && map === instance
  locating.value = true
  locationHint.value = ''
  try {
    const { point, accuracyM } = initial
      ? { point: [initial.longitude, initial.latitude] as MapPoint, accuracyM: initial.accuracyM }
      : await locate()
    if (!current()) return
    if (!validCoordinates(...point)) throw new Error('暂时无法取得位置，可以搜索地点或手动选点')
    if (!placePick.value) {
      await focusNearbyWater(point, 'location', current, accuracyM)
      return
    }
    const amap = await loadAmap()
    if (!current()) return
    dismissSearch()
    instance.setCenter(point)
    instance.setZoom(accuracyM !== undefined && accuracyM >= 1000 ? 12 : 15)
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
      instance.add(locationMarker)
    }
    updateZoneViewport()
    locationHint.value = '已定位到附近。请选点确认，不会自动保存或公开位置。'
    if (typeof accuracyM === 'number' && accuracyM >= 100)
      locationHint.value = `定位误差约 ${Math.ceil(accuracyM)} 米。${locationHint.value}`
    void displayPositionName(point, '当前位置', current)
  } catch (e) {
    if (current()) locationHint.value = errorText(e)
  } finally {
    if (current()) locating.value = false
  }
  // #endif
}
// #ifdef H5
async function displayPositionName(point: MapPoint, fallback: string, isCurrent: () => boolean) {
  focusedPlace.value = fallback
  const name = await reversePlaceName(point).catch(() => '')
  if (name && isCurrent()) focusedPlace.value = name
}

function waterDetailZoom(polygon: MapPoint[][]) {
  const { west, east, south, north } = boundaryBounds({ type: 'Polygon', coordinates: polygon })
  const longitudeScale = Math.cos((south + north) * Math.PI / 360)
  const sizeM = 111320 * Math.max((east - west) * longitudeScale, north - south)
  const zoom = Math.ceil(Math.log2(156543.034 * longitudeScale * 48 / sizeM))
  return Math.min(18, Math.max(16, zoom))
}

async function focusNearbyWater(
  point: MapPoint,
  action: 'location' | 'tap' | 'drag' | 'preview' | 'search',
  isCurrent?: () => boolean,
  accuracyM?: number
) {
  const instance = map
  if (!instance || !validCoordinates(...point)) return
  const version = locationVersion
  const current = () =>
    !disposed && map === instance && pageVisible && version === locationVersion && (isCurrent?.() ?? true)
  if (!current()) return
  const previousSelection=selected.value
  if(action==='drag')selected.value=null
  else clearWaterPick()
  const zoom = instance.getZoom()
  const overviewTap = action === 'tap' && zoom < 14
  const maxDistanceM = action === 'tap' || action === 'drag'
    ? waterTapRadiusM(point[1], zoom, waterTapPixels)
    : 2000
  let nearby: NearbyWater | undefined
  let indexUnavailable = false
  if (action !== 'preview') locationHint.value = waterLookupHint
  try {
    nearby = await resolveNearbyWater(point, maxDistanceM, action === 'preview' ? undefined : nearbyWaterPlaces)
  } catch {
    indexUnavailable = true
  }
  if (!current()) return
  // At close zoom levels, keep the shoreline within reach of the tap on screen.
  const withinTapReach = () => {
    if (action !== 'tap' && action !== 'drag' || !nearby || nearby.distance === 0) return true
    const tap = instance.lngLatToContainer(point)
    const water = instance.lngLatToContainer(nearby.point)
    return Math.hypot(tap.getX() - water.getX(), tap.getY() - water.getY()) <= waterTapPixels
  }
  if (!nearby || !withinTapReach()) {
    if(action==='drag' && previousSelection){
      selected.value=previousSelection
      locationMarker?.setPosition([previousSelection.longitude,previousSelection.latitude])
      locationHint.value='附近未识别到水域，已恢复原选点。'
      return
    }
    if (locationMarker) instance.remove(locationMarker)
    locationMarker = undefined
    if (selectedWaterOverlay) instance.remove(selectedWaterOverlay)
    selectedWaterOverlay = undefined
    waterAttribution.value = ''
    focusedPlace.value = ''
    if (action === 'location') {
      instance.setCenter(point)
      instance.setZoom(accuracyM !== undefined && accuracyM >= 1000 ? 12 : 15)
      updateZoneViewport()
    }
    if (action !== 'preview') {
      dismissSearch()
      locationHint.value = indexUnavailable
        ? '水域数据暂时无法读取，可重试或搜索地点。'
        : action === 'tap'
          ? '附近未识别到水域，可点按水面或搜索名称。'
          : '附近暂无可用的水域边界，可搜索水域名称。'
    }
    return
  }
  const amap = await loadAmap()
  if (!current()) return
  if (action !== 'preview') dismissSearch()
  selectionVersion++
  if (marker) instance.remove(marker)
  marker = undefined
  const animate = action === 'tap' && (overviewTap || nearby.distance > 0) &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const targetZoom = overviewTap ? (nearby.polygon ? waterDetailZoom(nearby.polygon) : 16) : undefined
  if (animate) instance.setStatus?.({ animateEnable: true })
  try {
    if (action === 'drag') {
      // A fine adjustment changes the pin, never the user's map camera.
    } else if (targetZoom !== undefined && instance.setZoomAndCenter) {
      instance.setZoomAndCenter(targetZoom, nearby.point, !animate, 620)
    } else {
      instance.setCenter(nearby.point, !animate, 380)
      if (targetZoom !== undefined) instance.setZoom(targetZoom)
      else if (action !== 'tap') instance.setZoom(15)
    }
  } finally {
    if (animate) instance.setStatus?.({ animateEnable: false })
  }
  if (selectedWaterOverlay) instance.remove(selectedWaterOverlay)
  selectedWaterOverlay = undefined
  if (action !== 'preview') {
    if (nearby.polygon) selectedWaterOverlay = new amap.Polygon({
      path: nearby.polygon, fillColor: '#4195c7', fillOpacity: 0.28, strokeColor: '#287baa',
      strokeWeight: 1, zIndex: 25, bubble: true
    })
    else if (nearby.line) selectedWaterOverlay = new amap.Polyline({
      path: nearby.line, strokeColor: '#287baa', strokeWeight: 3, zIndex: 25, bubble: true
    })
  }
  if (selectedWaterOverlay) instance.add(selectedWaterOverlay)
  if (locationMarker) instance.remove(locationMarker)
  const chosenPoint = nearby.point
  const water = waterSelection(chosenPoint, nearby.name, nearby.nameUnavailable)
  const pin = document.createElement('span')
  pin.className = 'water-map-drag-pin'
  pin.setAttribute('aria-label', '拖动标记微调位置')
  pin.addEventListener('pointerdown', event => event.stopPropagation())
  pin.append(createMapPin(water.name))
  locationMarker = new amap.Marker({
    position: chosenPoint,
    title: water.name,
    content: pin,
    anchor: 'bottom-center',
    offset: new amap.Pixel(0, 8),
    draggable: true,
    bubble: false,
    // Keep interactive fence labels above the water selection marker.
    zIndex: 60
  })
  instance.add(locationMarker)
  const draggableMarker = locationMarker
  draggableMarker.on('dragstart', () => {
    if (disposed || !pageVisible || locationMarker !== draggableMarker) return
    locationVersion++; selectionVersion++; dismissSearch(); locating.value = false
    locationHint.value = ''; pinDragging.value = true
  })
  draggableMarker.on('dragend', event => {
    if (disposed || !pageVisible || locationMarker !== draggableMarker || !pinDragging.value) return
    pinDragging.value = false
    const target: MapPoint = [event.lnglat.getLng(), event.lnglat.getLat()]
    if (validCoordinates(...target)) void focusNearbyWater(target, 'drag')
  })
  if (action !== 'preview') {
    focusedPlace.value = water.name
    if (waterPick.value) selected.value = water
  }
  locationHint.value = nearby.nameUnavailable ? '水域名称暂时无法读取，可重新点按水面。' :
    !nearby.name && !waterPick.value && action !== 'preview' ? '已选中附近水面。' : ''
  waterAttribution.value = nearby.source === 'amap' ? '' : nearby.source
  updateZoneViewport()
}
// #endif
function confirm() {
  if (!selected.value || pinDragging.value || locating.value || !requestId.value) return
  // #ifdef H5
  returnMapSelection(requestId.value, selected.value, message => { locationHint.value = message })
  // #endif
}
</script>
<template>
  <FishingShell
    :title="placePick ? '选择地点' : '水域地图'"
    back
    edge-to-bottom
  >
    <!-- #ifdef MP-WEIXIN -->
    <MiniWaterMap v-if="pageOptionsReady" :key="auth.context" :pick="pick" :water-pick="waterPick" :request-id="requestId" />
    <!-- #endif -->
    <!-- #ifdef H5 -->
    <view
      class="map-stage"
      :class="{ 'map-stage--failed': !!error && !loading, 'map-stage--credit': !!(waterAttribution || zoneAttribution) && mapReady && !loading && !error }"
      :style="{ '--water-credit-height': creditHeight + 'px' }"
    >
      <MobileMap
        ref="mapPanel"
        :load="loadAmap"
        :options="overview"
        :reload-key="auth.context"
        :fences="fences"
        :fence-pin-image="noFishingPin"
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
          <view ref="searchStack" class="map-search-stack">
            <MobileSearch
              :key="auth.context"
              :model-value="focusedPlace || query"
              name="map-search"
              label="搜索高德地点"
              placeholder="城市或水域"
              action-label=""
              :live="!focusedPlace"
              :auto-select-first="!focusedPlace"
              floating-suggestions
              suggestion-icon="location-fill"
              :suggestions="suggestions"
              :suggestion-status="searchLoading ? '' : searchHint"
              :loading="loading || searchLoading || locating || locationHint === waterLookupHint"
              loading-label="正在查找城市或水域"
              :disabled="!mapReady"
              @update:model-value="editSearch"
              @search="search($event)"
              @select="choosePlace"
              @preview="previewPlace"
              @dismiss="dismissSearch"
            />
            <view v-if="error && !loading" class="map-unavailable">
              <FishingEmptyState
                class="map-unavailable__content"
                icon="location"
                title="地图暂时未能加载"
                :description="error"
                announce="alert"
              >
                <MobileAction class="primary map-unavailable__retry" @click="init">重新加载地图</MobileAction>
                <MobileAction
                  class="text-action"
                  @click="uni.redirectTo({ url: staticSearchUrl })"
                  >改用地点搜索与静态预览</MobileAction
                >
              </FishingEmptyState>
            </view>
            <text v-else-if="searchError" class="map-status" role="alert">{{ searchError }}</text>
            <text v-else-if="locationHint && locationHint !== waterLookupHint" class="map-status" role="status">{{ locationHint }}</text>
            <text class="map-place-announcement" role="status">{{ focusedPlace }}</text>
          </view>
        </template>
        <template #controls>
          <MobileAction
            v-if="mapReady && perspectiveAvailable"
            class="map-control"
            variant="icon"
            :aria-label="threeDimensional ? '切换二维地图' : '切换三维地图'"
            :aria-pressed="threeDimensional"
            :disabled="pinDragging"
            @click="togglePerspective"
          >{{ threeDimensional ? '2D' : '3D' }}</MobileAction>
          <MobileAction
            v-if="mapReady"
            class="map-control"
            variant="icon"
            aria-label="地图内禁钓区域"
            @click="openZonesList"
          ><MobileIcon name="shield" size="22px" /></MobileAction>
          <MobileAction
            v-if="mapReady"
            class="map-control"
            variant="icon"
            :aria-label="locating ? '定位中' : placePick ? '回到当前位置' : '定位附近水域'"
            :disabled="locating"
            @click="position()"
          ><MobileIcon name="locate" size="22px" /></MobileAction>
        </template>
        <template v-if="pick && selected && !searchLoading && !results.length" #selection
          ><view class="map-selection stack stack--tight"
            ><text class="name" role="status">{{ selected.name }}</text
            ><text v-if="selected.address && selected.address !== selected.name" class="caption">{{ selected.address }}</text
            ><text v-if="waterPick || selected.name === '已选位置'" class="caption">{{ formatMapCoordinates(selected.longitude, selected.latitude) }}</text
            ><text v-if="waterPick" class="caption">拖动标记可微调位置</text
            ><MobileAction class="primary" :disabled="pinDragging || locating || !requestId" @click="confirm"
              >{{ waterPick ? '确认这处水域' : '确认这个位置' }}</MobileAction
            ></view
          ></template
        >
      </MobileMap>
      <div ref="waterCredit" v-if="(waterAttribution || zoneAttribution) && mapReady && !loading && !error"
        class="map-water-credit">
        <template v-if="waterAttribution === 'live'">
          <a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>
          <a href="https://openmaptiles.org/" target="_blank" rel="noopener noreferrer">© OpenMapTiles</a>
        </template>
        <a href="https://www.openstreetmap.org/copyright"
          target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>
      </div>
      <MapZones
        ref="zonePanel"
        v-if="mapReady"
        :key="auth.context"
        :bounds="zoneBounds"
        :active="zonesActive"
        :focus-request="zoneFocusRequest"
        @overlays="drawZoneOverlays"
      />
    </view>
    <!-- #endif -->
  </FishingShell>
</template>
<style scoped>
.map-stage {
  position: relative;
  flex: 1 0 220px;
  min-height: 220px;
  margin-bottom: var(--mobile-safe-bottom, 0px);
  --map-control-bottom: 30px;
  --mobile-map-fence-color: var(--danger);
  --mobile-map-search-max-width: none;
  --mobile-search-selection: var(--lake-soft);
}
.map-stage :deep(.mobile-map__search) {
  top: var(--fishing-page-top);
  inset-inline: var(--fishing-page-start) var(--fishing-page-end);
}
.map-stage :deep(.mobile-map__loading) {
  display: none;
}
.map-stage--credit :deep(.mobile-map) { height: calc(100% - max(16px, var(--water-credit-height, 0px))); }
.map-stage :deep(.mobile-map__controls) {
  inset-inline-end: var(--fishing-page-end);
  bottom: var(--map-control-bottom);
  gap: var(--fishing-gap-small);
}
.map-stage :deep(.mobile-map__selection) {
  inset-inline-start: var(--fishing-page-start);
  inset-inline-end: calc(var(--fishing-page-end) + var(--fishing-target) + var(--fishing-gap-small));
  bottom: max(var(--map-control-bottom), calc(21px + var(--water-credit-height, 0px)));
}
.map-control {
  width: var(--fishing-target);
  height: var(--fishing-target);
  border: 1px solid var(--line);
  border-radius: var(--fishing-control-radius);
  background: var(--paper);
  color: var(--ink);
  box-shadow: 0 1px 6px #0002;
}
.map-search-stack {
  display: flex;
  flex-direction: column;
  gap: var(--fishing-gap-small);
}
.map-water-credit {
  position: absolute;
  display: flex;
  flex-wrap: wrap;
  column-gap: 6px;
  max-inline-size: calc(100% - 72px);
  inset-inline-start: 4px;
  inset-block-end: 2px;
  z-index: 1;
  padding: 0 4px;
  background: var(--paper);
  color: var(--muted);
  font-size: 11px;
  line-height: 1.3;
}
.map-stage :deep(.water-map-drag-pin) { display: flex; align-items: flex-start; justify-content: center; width: 48px; height: 56px; padding-top: 6px; box-sizing: border-box; cursor: grab; touch-action: none; }
.map-stage :deep(.water-map-drag-pin:active) { cursor: grabbing; }
.map-water-credit a {
  color: inherit;
}
.map-place-announcement {
  position: absolute;
  clip-path: inset(50%);
  white-space: nowrap;
  width: 1px;
  height: 1px;
  overflow: hidden;
}
.map-status {
  display: block;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--paper);
  color: var(--ink);
  font-size: var(--fishing-label-size);
  overflow-wrap: anywhere;
}
.map-stage--failed :deep(.mobile-map__canvas) {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}
.map-stage--failed :deep(.mobile-map__search) {
  bottom: var(--fishing-gap-small);
}
.map-stage--failed .map-search-stack {
  height: 100%;
}
.map-unavailable {
  flex: 1;
  min-height: 0;
  display: flex;
  justify-content: center;
  overflow-y: auto;
}
.map-unavailable :deep(.map-unavailable__content) {
  width: 100%;
  max-width: 320px;
  margin-block: auto;
  padding: 12px 0;
}
.map-unavailable__retry {
  width: 100%;
}
@media (orientation: landscape) and (max-height: 500px) {
  .map-unavailable :deep(.fish-scene) {
    display: none;
  }
}
.map-selection {
  padding: 12px;
  border-radius: 16px;
  background: var(--paper);
  box-shadow: 0 1px 6px #0002;
}
</style>
