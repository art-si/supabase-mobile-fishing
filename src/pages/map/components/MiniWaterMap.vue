<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { onHide, onShow } from '@dcloudio/uni-app'
import MobileSearch from '@mobile-core/components/MobileSearch.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import { activateButtonKey, preventActionKey } from '@mobile-core/action-keyboard'
import MapZones from '@/components/MapZones.vue'
import NativeWaterMap from './NativeWaterMap.vue'
import { useAuthStore } from '@/stores/auth'
import { entryPosition } from '@/services/entry-location'
import { captureEntryLocation, type EntryLocation } from '@/platforms/entry-location'
import { searchMapPlaces, searchMapWaterPlaces, lookupMapRegion } from '@/services/amap'
import { resolveNearbyWater, type NearbyWater } from '@/services/nearby-water'
import { errorText, validCoordinates } from '@/domain/rules'
import { formatMapCoordinates, placeSelection, waterSelection, type MapPlace, type SelectedPlace } from '@/domain/map'
import { returnMapSelection } from '@/platforms/map-navigation'
import { containsWaterPoint, waterTapRadiusM, type MapPoint } from '@/domain/water-geometry'
import { circleBounds, type Zone, type ZoneBounds } from '@/domain/zones'
import { traceMap } from '@/platforms/map-trace'

defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
const props = defineProps<{ pick: boolean; waterPick: boolean; requestId: string }>()
const auth = useAuthStore()
const scope = getCurrentInstance()?.proxy
const initial = entryPosition.value && validCoordinates(entryPosition.value.longitude, entryPosition.value.latitude) ? entryPosition.value : null
// An overview is only a map camera, never a substitute for a device position.
const center = ref({ longitude: initial?.longitude ?? 104, latitude: initial?.latitude ?? 34 })
const scale = ref(initial ? 15 : 8)
const viewportScale = ref(scale.value)
const viewportCenter = ref({ ...center.value })
const cameraRequest = ref(0)
function moveCamera(point: { longitude: number; latitude: number }, zoom: number, preserveNativeZoom = false) {
  center.value = { ...point }
  if (!preserveNativeZoom) scale.value = zoom
  viewportCenter.value = { ...point }; viewportScale.value = zoom
  cameraRequest.value++
}
const selected = ref<SelectedPlace | null>(null)
const positionMarker = ref<SelectedPlace | null>(null)
const water = ref<NearbyWater>()
// Public geometry already verified in this map session, never a guessed POI.
// An inside-water tap has distance zero and does not need another network lookup.
const knownWaters: NearbyWater[] = []
const query = ref(''), focusedPlace = ref(''), places = ref<MapPlace[]>([]), searching = ref(false)
const selecting = ref(false), locating = ref(false), hint = ref(''), searchHint = ref('')
const pinDragging = ref(false)
const threeDimensional=ref(false)
const visible = ref(true), mapBusy = ref(true)
let gestureActive = false
const idleWaiters = new Set<() => void>()
function gestureChanged(active: boolean) {
  gestureActive = active
  if (!active) { idleWaiters.forEach(resolve => resolve()); idleWaiters.clear() }
}
function waitForMapIdle() {
  return gestureActive ? new Promise<void>(resolve => idleWaiters.add(resolve)) : Promise.resolve()
}
const size = ref({ width: uni.getWindowInfo().windowWidth, height: 320 })
const frameHeight = ref(Math.max(220, uni.getWindowInfo().windowHeight - 160))
const zones = ref<Zone[]>([]), bounds = ref<ZoneBounds | null>(null)
const zonePanel = ref<InstanceType<typeof MapZones>>()
const zoneFocus = ref<{ id: string } | null>(null)
const suggestions = computed(() => places.value.map(place => ({ id: place.id, label: place.name, description: place.address })))
const waterCredit = computed(() => water.value?.source === 'index' || water.value?.source === 'live' || zones.value.some(zone => !!zone.water_attribution))
const status = computed(() => selecting.value ? (props.pick && !props.waterPick ? '正在识别地点…' : '正在识别水域…') : locating.value ? '正在定位…' : hint.value || (selected.value ? '' : props.waterPick || !props.pick ? '拖动或缩放地图，点按要选择的水面。' : '拖动或缩放地图，点按要选择的位置。'))
let disposed = false, revision = 0, searchRevision = 0, placePreviewRevision = 0
let initialState: 'waiting' | 'running' | 'done' = 'waiting', initialRevision = 0
// Both interactive engines use their native camera; no static-image zoom conversion.
const waterFocusZoom = 15
const current = (version: number) => !disposed && visible.value && version === revision
function clearSelection() { selected.value = null; positionMarker.value = null; water.value = undefined }
function interacted() { initialState = 'done'; initialRevision++ }
function measure() {
  void nextTick(() => {
    const selector = uni.createSelectorQuery().in(scope)
    selector.select('.mini-water-map').boundingClientRect()
    selector.select('.mini-water-map__canvas').boundingClientRect()
    selector.exec(([frame, canvas]) => {
      if (disposed || !frame || !canvas) return
      const height = Math.max(220, Math.floor(uni.getWindowInfo().windowHeight - frame.top))
      if (height !== frameHeight.value) { frameHeight.value = height; measure(); return }
      const width = Math.round(canvas.width), heightPx = Math.round(canvas.height)
      if (width > 0 && heightPx > 0 && (width !== size.value.width || heightPx !== size.value.height))
        size.value = { width, height: heightPx }
    })
  })
}
async function selectPoint(point: MapPoint, action: 'tap' | 'drag' | 'location' | 'search' = 'tap', { tapRadius, place }: { tapRadius?: number; place?: MapPlace } = {}) {
  if (!validCoordinates(...point) || !auth.requireLogin()) return
  const version = ++revision
  const previous={selected:selected.value,water:water.value,name:focusedPlace.value}
  const restoreDrag=()=>{if(action==='drag'){selected.value=previous.selected;water.value=previous.water;focusedPlace.value=previous.name}}
  traceMap('select-start', { action, version, tapRadius, zoom: viewportScale.value })
  placePreviewRevision++
  clearSelection(); hint.value = ''; selecting.value = true
  try {
    if (props.pick && !props.waterPick) {
      const label = place ?? await lookupMapRegion(...point).then(region => ({
        name: [region.city, region.district].filter(Boolean).join(' '), adcode: region.adcode
      })).catch(() => undefined)
      await waitForMapIdle()
      if (!current(version)) return
      selected.value = placeSelection(point, label)
    } else {
      const manual = action === 'tap' || action === 'drag'
      const radius = manual ? tapRadius ?? waterTapRadiusM(point[1], viewportScale.value, 160) : 2000
      const known = manual && knownWaters.find(item => item.name && item.polygon && containsWaterPoint(point, item.polygon))
      const result = known ? { ...known, point, distance: 0 } : await resolveNearbyWater(point, radius, searchMapWaterPlaces)
      await waitForMapIdle()
      traceMap('select-result', { action, version, current: current(version), found: !!result, distance: result?.distance, geometry: !!result?.polygon || !!result?.line })
      if (!current(version)) return
      if (!result) { focusedPlace.value = ''; restoreDrag(); hint.value = action==='drag'?'附近未识别到水域，已恢复原选点。':'附近未识别到水域，请放大后点按水面，或搜索水域名称。'; return }
      if (!known && result.polygon && result.name) {
        knownWaters.unshift(result)
        if (knownWaters.length > 8) knownWaters.pop()
      }
      water.value = result
      selected.value = waterSelection(result.point, result.name, result.nameUnavailable)
      if (result.nameUnavailable) hint.value = '水域名称暂未识别，可重新点选或保存时填写名称。'
      // Match H5: move to the nearest actual water, retaining the user's detail
      // zoom unless this was a city-level overview. Gesture reads never drive this.
      if (action !== 'drag') moveCamera({ longitude: result.point[0], latitude: result.point[1] },
        action === 'tap' ? (viewportScale.value < 14 ? 16 : viewportScale.value) : waterFocusZoom,
        action === 'tap' && viewportScale.value >= 14)
    }
    focusedPlace.value = selected.value?.name || ''
  } catch (error) {
    traceMap('select-error', { action, version, current: current(version) })
    if (current(version)) { focusedPlace.value = ''; restoreDrag(); hint.value = errorText(error) }
  } finally {
    if (current(version)) { selecting.value = false; locating.value = false; measure() }
  }
}
function tapMap(event: { longitude: number; latitude: number; radius: number }) {
  interacted()
  const { longitude, latitude } = event
  dismissSearch()
  if (typeof longitude === 'number' && typeof latitude === 'number') void selectPoint([longitude, latitude], 'tap', { tapRadius: event.radius })
}
function dragPin(active: boolean) {
  pinDragging.value = active
  if (!active) return
  // Keep the pin and outline visible under the finger, but invalidate older work.
  interacted(); revision++; placePreviewRevision++; dismissSearch()
  selecting.value = locating.value = false; hint.value = ''
}
function dropPin(event: { longitude: number; latitude: number; radius: number }) {
  void selectPoint([event.longitude, event.latitude], 'drag', { tapRadius: event.radius })
}
function interactMap() {
  // Only a committed tap or meaningful native movement cancels older work.
  interacted(); revision++; placePreviewRevision++; dismissSearch()
  selecting.value = locating.value = false; hint.value = ''
  clearSelection()
}
async function position() {
  if (locating.value || !auth.requireLogin()) return
  interacted(); dismissSearch()
  const version = ++revision
  clearSelection(); hint.value = ''; locating.value = true; selecting.value = false
  try {
    const point = await captureEntryLocation()
    if (!current(version)) return
    await focusDevicePoint(point)
  } catch (error) { if (current(version)) hint.value = errorText(error) }
  finally { if (!disposed && visible.value && (version === revision || !selecting.value)) locating.value = false }
}
async function focusDevicePoint(point: EntryLocation) {
  if (!validCoordinates(point.longitude, point.latitude)) throw new Error('暂时无法取得位置，请重新定位。')
  moveCamera({ longitude: point.longitude, latitude: point.latitude }, point.coarse ? 11 : waterFocusZoom)
  bounds.value = circleBounds({ ...center.value, radius_m: 5000 })
  if (props.pick && !props.waterPick) {
    // H5's general-place picker marks the device, but leaves the choice to the user.
    const label = point.coarse ? '当前位置附近' : '当前位置'
    positionMarker.value = { longitude: point.longitude, latitude: point.latitude, name: label, crs: 'GCJ-02', created_at: Date.now() }
    focusedPlace.value = label
    hint.value = '已定位到附近。请选点确认，不会自动保存或公开位置。'
    return
  }
  const version = revision + 1
  await selectPoint([point.longitude, point.latitude], 'location')
  if (current(version) && point.coarse && selected.value && !hint.value) hint.value = '已按大致位置查找附近水域，请核对或点选实际水面。'
}
async function initializePosition() {
  const point = entryPosition.value
  if (initialState !== 'waiting' || disposed || !visible.value || !auth.signedIn ||
      !point || !validCoordinates(point.longitude, point.latitude)) return
  // An existing choice or input owns the map, including a result restored before readiness.
  if (selected.value || positionMarker.value || query.value.trim() || focusedPlace.value || places.value.length) {
    initialState = 'done'; return
  }
  initialState = 'running'
  const version = ++initialRevision
  const selectionVersion = ++revision
  locating.value = true
  try {
    // The gate may have been passed hours ago or before travelling. Read a fresh
    // authorized position, just as H5 does when the map opens.
    const fresh = await captureEntryLocation()
    await waitForMapIdle()
    traceMap('first-location', { coarse: fresh.coarse, accuracyM: fresh.accuracyM, current: version === initialRevision && current(selectionVersion) })
    if (version !== initialRevision || !current(selectionVersion)) return
    await focusDevicePoint(fresh)
  } catch (error) {
    if (version === initialRevision && current(selectionVersion)) hint.value = errorText(error)
  } finally {
    if (version === initialRevision && initialState === 'running') { initialState = 'done'; locating.value = false }
  }
}
function editSearch(value: string) {
  interacted()
  query.value = value; focusedPlace.value = ''; searchRevision++; placePreviewRevision++; revision++
  places.value = []; searchHint.value = ''; hint.value = ''; searching.value = selecting.value = locating.value = false
  clearSelection()
}
function dismissSearch() { searchRevision++; placePreviewRevision++; places.value = []; searching.value = false; searchHint.value = '' }
async function search() {
  // A resolved label is a map selection, not a new query from the input watcher.
  if (focusedPlace.value || !query.value.trim() || !auth.requireLogin()) return
  const version = ++searchRevision
  searching.value = true; searchHint.value = ''
  try {
    const result = await searchMapPlaces(query.value, '')
    if (!disposed && visible.value && version === searchRevision) {
      places.value = result.items; searchHint.value = result.items.length ? '' : '没有找到地点，试试附近的桥、公园或补充城市名。'
    }
  } catch (error) { if (version === searchRevision) searchHint.value = errorText(error) }
  finally { if (version === searchRevision) searching.value = false }
}
async function previewPlace(id: string) {
  // Search suggestions only preview in browse mode. Pick mode needs an explicit choice.
  if (props.pick) return
  const place = places.value.find(item => item.id === id)
  if (!place || !validCoordinates(place.longitude, place.latitude) || !visible.value) return
  const previewVersion = ++placePreviewRevision, searchVersion = searchRevision, selectionVersion = revision
  const isCurrent = () => !disposed && visible.value && previewVersion === placePreviewRevision &&
    searchVersion === searchRevision && selectionVersion === revision && places.value.some(item => item.id === id)
  try {
    // Match H5's quiet, local preview. Committing a result below verifies live geometry/names.
    const result = await resolveNearbyWater([place.longitude, place.latitude], 2000)
    if (!isCurrent() || !result) return
    water.value = result
    selected.value = waterSelection(result.point, result.name, result.nameUnavailable)
    moveCamera({ longitude: result.point[0], latitude: result.point[1] }, waterFocusZoom)
  } catch { /* A suggestion preview must not interrupt text search. */ }
}
function choosePlace(id: string) {
  const place = places.value.find(item => item.id === id)
  if (!place || !validCoordinates(place.longitude, place.latitude) || !auth.requireLogin()) return
  interacted()
  dismissSearch(); focusedPlace.value = place.name
  moveCamera({ longitude: place.longitude, latitude: place.latitude }, props.pick && !props.waterPick ? 14 : waterFocusZoom)
  void selectPoint([place.longitude, place.latitude], 'search', { place })
}
function panMap(point: { longitude: number; latitude: number }) {
  // Native viewport observations are not navigation commands. In particular an
  // end notification must not cancel a water lookup started by the following tap.
  viewportCenter.value = point
}
function confirm() {
  if (!selected.value || pinDragging.value || selecting.value || locating.value || mapBusy.value || !props.requestId || !auth.signedIn) return
  returnMapSelection(props.requestId, selected.value, message => { hint.value = message })
}
onMounted(() => {
  measure()
  bounds.value = circleBounds({ ...center.value, radius_m: initial ? 5000 : 500000 })
  uni.onWindowResize(measure)
  void initializePosition()
})
onHide(() => {
  visible.value = false; revision++; searchRevision++; placePreviewRevision++
  pinDragging.value = false
  gestureChanged(false)
  if (initialState === 'running') { initialState = 'waiting'; initialRevision++ }
  selecting.value = locating.value = searching.value = false
})
onShow(() => { visible.value = true; measure(); void initializePosition() })
onUnmounted(() => { disposed = true; revision++; searchRevision++; placePreviewRevision++; initialRevision++; gestureChanged(false); uni.offWindowResize(measure) })
watch([selected, status, waterCredit], measure, { flush: 'post' })
watch([entryPosition, () => auth.signedIn], () => { void initializePosition() }, { flush: 'post' })
</script>

<template>
  <view class="mini-water-map" :class="{ 'mini-water-map--credit': waterCredit }" :style="{ height: frameHeight + 'px' }">
    <view class="mini-water-map__search">
      <MobileSearch :model-value="focusedPlace || query" name="water-map-search" label="搜索高德地点" placeholder="城市或水域"
        action-label="" :live="!focusedPlace" :auto-select-first="!focusedPlace" suggestion-icon="location-fill"
        :maxlength="80" :suggestions="suggestions" :suggestion-status="searching ? '' : searchHint"
        :loading="mapBusy || searching || selecting || locating" loading-label="正在查找城市或水域"
        floating-suggestions @update:model-value="editSearch" @search="search" @select="choosePlace" @preview="previewPlace" @dismiss="dismissSearch" />
      <text v-if="hint" class="mini-water-map__hint" role="status">{{ hint }}</text>
    </view>
    <view class="mini-water-map__canvas">
      <NativeWaterMap :center="center" :zoom="scale" :camera-request="cameraRequest" :size="size" :active="visible" :selected="selected || positionMarker" :water="water" :zones="zones" :operation-pending="selecting || locating" :three-dimensional="threeDimensional"
        @interact="interactMap" @point="tapMap" @bounds="bounds = $event" @busy="mapBusy = $event" @zoom="viewportScale = $event"
        @pan="panMap" @gesture="gestureChanged" @pin-drag="dragPin" @pin-drop="dropPin" @pin-error="hint = $event" @zone="zoneFocus = { id: $event }" />
      <view class="mini-water-map__controls">
        <button class="mobile-action mini-water-map__control" role="button" :tabindex="pinDragging ? -1 : 0" hover-class="mobile-action--pressed" :aria-label="threeDimensional?'切换二维地图':'切换三维地图'" :aria-pressed="threeDimensional" :aria-disabled="pinDragging || undefined" :disabled="pinDragging" @click="threeDimensional=!threeDimensional" @keydown="preventActionKey" @keyup="activateButtonKey">{{threeDimensional?'2D':'3D'}}</button>
        <button class="mobile-action mini-water-map__control" role="button" tabindex="0" hover-class="mobile-action--pressed" aria-label="地图内禁钓区域" @click="zonePanel?.openList()" @keydown="preventActionKey" @keyup="activateButtonKey"><MobileIcon name="shield" :size="22" /></button>
        <button class="mobile-action mini-water-map__control" role="button" :tabindex="locating ? -1 : 0" hover-class="mobile-action--pressed" :aria-label="locating ? '定位中' : pick && !waterPick ? '回到当前位置' : '定位附近水域'" :aria-disabled="locating || undefined" :disabled="locating" @click="position" @keydown="preventActionKey" @keyup="activateButtonKey"><MobileIcon name="locate" :size="22" /></button>
      </view>
      <MapZones ref="zonePanel" :bounds="bounds" :active="visible" :focus-request="zoneFocus" @overlays="zones = $event" />
    </view>
    <view v-if="pick && selected && !searching && !places.length" class="mini-water-map__selection map-selection stack stack--tight">
      <text class="name" role="status">{{ selected.name }}</text>
      <text v-if="selected.address && selected.address !== selected.name" class="caption">{{ selected.address }}</text>
      <text v-if="waterPick || selected.name === '已选位置'" class="caption">{{ formatMapCoordinates(selected.longitude, selected.latitude) }}</text>
      <text v-if="waterPick" class="caption">{{threeDimensional?'切回 2D 可拖动标记微调位置':'拖动标记可微调位置'}}</text>
      <MobileAction class="primary" :disabled="pinDragging || selecting || locating || mapBusy || !requestId" @click="confirm">{{ waterPick ? '确认这处水域' : '确认这个位置' }}</MobileAction>
    </view>
    <text v-if="waterCredit" class="mini-water-map__water-credit">© OpenStreetMap</text>
    <text class="mini-water-map__announcement" role="status">{{ status }}</text>
  </view>
</template>

<style scoped>
.mini-water-map { position: relative; flex: 1; min-height: 220px; min-width: 0; isolation: isolate; overflow: hidden; --map-control-bottom: calc(30px + var(--mobile-safe-bottom, 0px)); --water-credit-height: 0px; }
.mini-water-map--credit { --water-credit-height: 18px; }
.mini-water-map__search { position: absolute; z-index: 130; top: var(--fishing-page-top); inset-inline: var(--fishing-page-start) var(--fishing-page-end); --mobile-search-selection: var(--lake-soft); }
.mini-water-map__canvas { position: absolute; inset: 0; min-height: 220px; overflow: hidden; background: var(--lake-soft); }
.mini-water-map--credit .mini-water-map__canvas { bottom: 16px; }
.mini-water-map__selection { position: absolute; z-index: 101; inset-inline-start: var(--fishing-page-start); inset-inline-end: calc(var(--fishing-page-end) + var(--fishing-target) + var(--fishing-gap-small)); bottom: max(var(--map-control-bottom), calc(42px + var(--water-credit-height) + var(--mobile-safe-bottom, 0px))); max-width: 420px; padding: 12px; border-radius: 16px; background: var(--paper); box-shadow: 0 1px 6px #0002; }
.mini-water-map__controls { position: absolute; z-index: 100; right: var(--fishing-page-end); bottom: var(--map-control-bottom); display: flex; flex-direction: column; gap: var(--fishing-gap-small); }
.mini-water-map__control { display: flex; align-items: center; justify-content: center; width: 48px; height: 48px; min-height: 48px; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: var(--fishing-control-radius); background: var(--paper); color: var(--ink); box-shadow: 0 1px 6px #0002; }
.mini-water-map__water-credit { position: absolute; z-index: 1; left: 4px; bottom: 2px; max-width: calc(100% - 100px); padding: 0 3px; background: var(--paper); color: var(--muted); font-size: 11px; line-height: 1.3; }
.mini-water-map__hint { display: block; margin-top: var(--fishing-gap-small); padding: 10px 12px; border-radius: 12px; background: var(--paper); color: var(--ink); font-size: var(--fishing-label-size); overflow-wrap: anywhere; }
.mini-water-map__announcement { position: absolute; width: 1px; height: 1px; clip-path: inset(50%); overflow: hidden; white-space: nowrap; }
@media (orientation: landscape) and (max-height: 500px) { .mini-water-map__search { --mobile-search-suggestions-height: 38vh; } }
</style>
