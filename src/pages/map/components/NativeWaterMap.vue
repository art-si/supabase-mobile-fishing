<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import { useAuthStore } from '@/stores/auth'
import { useAppearanceStore } from '@/stores/appearance'
import { validCoordinates } from '@/domain/rules'
import { boundaryAnchor, boundaryPaths } from '@/domain/zone-geometry'
import noFishingPin from '@/brand/no-fishing-pin.png'
import { waterTapRadiusM, waterDistance, type MapPoint } from '@/domain/water-geometry'
import type { SelectedPlace } from '@/domain/map'
import type { NearbyWater } from '@/services/nearby-water'
import type { Zone, ZoneBounds } from '@/domain/zones'
import { traceMap } from '@/platforms/map-trace'
import {mapScreenPoint,mapCoordinate} from '@/domain/map-screen-point'

defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
const props = defineProps<{ center: { longitude: number; latitude: number }; zoom: number; size: { width: number; height: number }
  active: boolean; selected: SelectedPlace | null; water?: NearbyWater; zones: Zone[]; operationPending?: boolean; cameraRequest?: number; threeDimensional?:boolean }>()
const emit = defineEmits<{ interact: []; point: [{ longitude: number; latitude: number; radius: number }]; bounds: [ZoneBounds]
  busy: [boolean]; zoom: [number]; pan: [{ longitude: number; latitude: number }]; gesture: [boolean]
  pinDrag: [boolean]; pinDrop: [{ longitude: number; latitude: number; radius: number }]; pinError: [string]; zone: [string] }>()
const auth = useAuthStore()
const appearance = useAppearanceStore()
const instance = getCurrentInstance()
const scope = instance?.proxy
const mapId = `native-water-map-${instance?.uid ?? 0}`
type Location = { longitude: number; latitude: number }
type Camera = Location & { zoom: number }
type Region = { southwest: Location; northeast: Location }
type Detail = { type?: string; causedBy?: string; longitude?: number; latitude?: number; scale?: number
  centerLocation?: Location; region?: Region }
type MapEvent = { type?: string; causedBy?: string; detail?: Detail }
const validLocation = (point?: Location): point is Location => !!point && validCoordinates(point.longitude, point.latitude)
const nativeZoom = (zoom: number) => Number.isFinite(zoom) ? Math.max(3, Math.min(20, zoom)) : undefined
function targetCamera(): Camera | undefined {
  const zoom = nativeZoom(props.zoom)
  return validLocation(props.center) && zoom !== undefined ? { ...props.center, zoom } : undefined
}
const camera = shallowRef<Camera | undefined>(targetCamera())
// The native surface owns its camera during gestures. Writing its fractional
// scale back through the map attribute rounds it on Android (14.65 -> 14).
let observedCamera = targetCamera(), gestureOrigin = observedCamera
// Props describe explicit navigation, not the camera observed after a gesture.
// Comparing them with the live camera makes a layout/size update rewind a pinch.
let requestedCamera = targetCamera()
let requestVersion = props.cameraRequest
const ready = ref(false), error = ref(''), mapKey = ref(0)
const busy = computed(() => props.active && !ready.value && !error.value)
watch(busy, value => emit('busy', value), { immediate: true })
let mounted = false, disposed = false, generation = 0, readRevision = 0, tapRevision = 0, userGesture = false, needsViewportRead = true
let publishingRead: number | undefined
let context: ReturnType<typeof uni.createMapContext> | undefined, owner = auth.context, wasActive = props.active
let width = props.size.width, height = props.size.height
const pendingReads = new Set<() => void>()
// WeChat markers have no draggable option. Let the native movable-view track
// the finger, then ask MapContext to convert the pin tip to GCJ-02 once on release.
type ScreenPoint = { x: number; y: number }
const pinPosition = shallowRef<ScreenPoint>(), pinDragging = ref(false)
let pinRevision = 0, pinOffset: ScreenPoint | undefined, pinOrigin: ScreenPoint | undefined
let observedRegion: Region | undefined
const pinVisible = computed(() => !!pinPosition.value && props.active && !!props.selected && !props.threeDimensional)
async function syncPin() {
  if (pinDragging.value) return
  const version = ++pinRevision, map = nativeContext(), selected = props.selected
  pinPosition.value = undefined
  if (!props.active || disposed || userGesture || !validLocation(selected ?? undefined)) return
  // DevTools exposes projection methods but never calls their callbacks. Bounds
  // come from the actual native surface and also preserve fractional pinch zoom.
  const point = observedRegion ? mapScreenPoint(selected!,observedRegion,props.size) : map?.toScreenLocation ? await read<ScreenPoint>((success, fail) => map.toScreenLocation!({
    longitude: selected!.longitude, latitude: selected!.latitude, success: success as any, fail
  })) : undefined
  if (version !== pinRevision || disposed || userGesture || pinDragging.value || !props.active) return
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 24 || point.x > props.size.width - 24 || point.y < 48 || point.y > props.size.height - 8) return
  pinPosition.value = { x: point.x - 24, y: point.y - 48 }
}
function startPinDrag() {
  if (!pinPosition.value || !props.active || props.operationPending || disposed) return
  pinRevision++; tapRevision++; pinOrigin = pinOffset = { ...pinPosition.value }
  pinDragging.value = true; emit('pinDrag', true)
}
function movePin(event: { detail?: ScreenPoint & { source?: string } }) {
  const point = event.detail
  if (!pinDragging.value || !point || !['touch', 'touch-out-of-bounds'].includes(point.source ?? '')) return
  if (Number.isFinite(point.x) && Number.isFinite(point.y)) pinOffset = { x: point.x, y: point.y }
}
async function endPinDrag(cancelled = false) {
  if (!pinDragging.value) return
  await nextTick()
  const offset = pinOffset, origin = pinOrigin, map = nativeContext(), version = ++pinRevision
  const moved = offset && origin && Math.hypot(offset.x - origin.x, offset.y - origin.y) >= 2
  if (cancelled || !moved || (!observedRegion && !map?.fromScreenLocation)) {
    pinDragging.value = false; emit('pinDrag', false); void syncPin(); return
  }
  const tip={x:offset.x+24,y:offset.y+48}
  const point = observedRegion ? mapCoordinate(tip,observedRegion,props.size) : await read<Location>((success, fail) => map!.fromScreenLocation!({ ...tip, success, fail }))
  if (version !== pinRevision || disposed || !props.active) return
  pinDragging.value = false; emit('pinDrag', false)
  if (!validLocation(point)) {
    emit('pinError', '位置微调未完成，请重试拖动标记。'); void syncPin(); return
  }
  pinPosition.value = offset
  emit('pinDrop', { ...point, radius: waterTapRadiusM(point.latitude, observedCamera?.zoom ?? props.zoom, 160) })
}
const sameCamera = (one?: Camera, two?: Camera) => !!one && !!two && Math.abs(one.longitude - two.longitude) < 1e-7 &&
  Math.abs(one.latitude - two.latitude) < 1e-7 && Math.abs(one.zoom - two.zoom) < 0.001
function invalidate() {
  pinRevision++; pinPosition.value = undefined
  if (pinDragging.value) { pinDragging.value = false; emit('pinDrag', false) }
  generation++; readRevision++; userGesture = false; publishingRead = undefined; needsViewportRead = true
  pendingReads.forEach(cancel => cancel()); pendingReads.clear()
}
function nativeContext() {
  if (!context && mounted && !disposed && camera.value) {
    try { context = uni.createMapContext(mapId, scope) } catch { /* The native updated event can retry context creation. */ }
  }
  return context
}
function read<T>(invoke: (success: (value: T) => void, fail: () => void) => void): Promise<T | undefined> {
  return new Promise(resolve => {
    let settled = false
    const finish = (value?: T) => {
      if (settled) return
      settled = true; clearTimeout(timer); pendingReads.delete(cancel); resolve(value)
    }
    const cancel = () => finish()
    const timer = setTimeout(cancel, 2000)
    pendingReads.add(cancel)
    try { invoke(value => finish(value), cancel) } catch { finish() }
  })
}
function regionBounds(region?: Region): ZoneBounds | undefined {
  if (!region || !validLocation(region.southwest) || !validLocation(region.northeast)) return
  const { southwest, northeast } = region
  if (southwest.longitude >= northeast.longitude || southwest.latitude >= northeast.latitude) return
  return { west: southwest.longitude, south: southwest.latitude, east: northeast.longitude, north: northeast.latitude }
}
async function readViewport(publish: boolean, detail: Detail = {}) {
  // A passive tile/render notification cannot discard an in-flight user-end
  // capture, otherwise the parent could retain the camera from before the drag.
  if (!publish && publishingRead !== undefined) return
  const map = nativeContext()
  if (!map || !props.active || disposed) return
  const version = ++readRevision, epoch = generation
  if (publish) publishingRead = version
  needsViewportRead = false
  pendingReads.forEach(cancel => cancel()); pendingReads.clear()
  const [center, scale, region] = await Promise.all([
    read<Location>((success, fail) => map.getCenterLocation({ success, fail }))
      .then(value => validLocation(value) ? value : detail.centerLocation),
    read<{ scale: number }>((success, fail) => map.getScale({ success, fail }))
      .then(value => nativeZoom(value?.scale ?? NaN) !== undefined ? value : { scale: detail.scale ?? NaN }),
    regionBounds(detail.region) ? Promise.resolve(detail.region)
      : read<Region>((success, fail) => map.getRegion({ success, fail }))
  ])
  if (publishingRead === version) publishingRead = undefined
  if (disposed || !props.active || epoch !== generation || version !== readRevision) return
  traceMap('viewport', { publish, nativeScale: scale?.scale, eventScale: detail.scale, boundScale: camera.value?.zoom, centerChanged: validLocation(center) && !sameCamera(camera.value, { ...center, zoom: scale?.scale ?? 0 }) })
  const bounds = regionBounds(region)
  if(bounds)observedRegion=region
  if (bounds) emit('bounds', bounds)
  if (bounds || validLocation(center)) { ready.value = true; error.value = '' }
  if (!validLocation(center)) { if (publish) emit('gesture', false); return }
  const zoom = nativeZoom(scale?.scale ?? NaN) ?? camera.value?.zoom
  if (zoom === undefined) { if (publish) emit('gesture', false); return }
  const next = { longitude: center.longitude, latitude: center.latitude, zoom }
  observedCamera = next
  if (!publish) { void syncPin(); return }
  const moved = !gestureOrigin || waterDistance([gestureOrigin.longitude, gestureOrigin.latitude],
    [next.longitude, next.latitude]) > 8 * 156543.034 * Math.cos(next.latitude * Math.PI / 180) / 2 ** next.zoom ||
    Math.abs(next.zoom - gestureOrigin.zoom) > 0.02
  // Native touch jitter also produces begin/end drag events. Only a real change
  // may cancel the water lookup; tapping with slight finger movement must work.
  if (moved) { tapRevision++; emit('interact') }
  emit('zoom', zoom); emit('pan', { longitude: next.longitude, latitude: next.latitude })
  emit('gesture', false)
  void syncPin()
}
function onRegionChange(event: MapEvent) {
  if (!props.active || disposed) return
  const detail = event.detail ?? {}, phase = detail.type ?? event.type, cause = event.causedBy ?? detail.causedBy
  traceMap('region', { phase, cause, scale: detail.scale, gesture: userGesture })
  if (phase === 'begin') {
    if (['gesture', 'drag', 'scale'].includes(cause ?? '') && !userGesture) {
      gestureOrigin = observedCamera; invalidate(); userGesture = true; emit('gesture', true)
    }
    return
  }
  if (phase !== 'end') return
  if (cause === 'update') {
    if (!userGesture) void readViewport(false, detail)
    return
  }
  // Current supported native libraries send a gesture begin/end pair. An orphan
  // old end after a new programmatic camera must not overwrite that newer intent.
  if (!userGesture || cause && cause !== 'drag' && cause !== 'scale' && cause !== 'gesture') return
  userGesture = false
  void readViewport(true, detail)
}
function onUpdated() {
  if (!props.active || disposed) return
  ready.value = true; error.value = ''
  if (!userGesture && needsViewportRead) void readViewport(false)
}
async function onTap(event: MapEvent) {
  traceMap('tap', { type: event.type, keys: Object.keys(event.detail ?? {}), valid: validLocation(event.detail as Location) })
  if (!props.active || disposed || pinDragging.value || !validLocation(event.detail as Location)) return
  invalidate(); emit('interact'); emit('gesture', false)
  const point = event.detail as Location
  const version = ++tapRevision, map = nativeContext()
  // Some native engines do not emit regionchange for mouse-wheel zoom, and a
  // camera animation can report an intermediate scale. Read the tap's real scale.
  const actual = map ? await read<{ scale: number }>((success, fail) => map.getScale({ success, fail })) : undefined
  if (version !== tapRevision || disposed || !props.active) return
  const zoom = nativeZoom(actual?.scale ?? NaN) ?? observedCamera?.zoom ?? props.zoom
  if (observedCamera) observedCamera = { ...observedCamera, zoom }
  emit('zoom', zoom)
  emit('point', { longitude: point.longitude, latitude: point.latitude,
    radius: waterTapRadiusM(point.latitude, zoom, 160) })
}
function onError() {
  if (!props.active || disposed) return
  tapRevision++; invalidate(); emit('gesture', false); ready.value = false; error.value = '地图未能加载，请重试。'
}
function retry() {
  tapRevision++; invalidate(); context = undefined; ready.value = false; error.value = ''; mapKey.value++
  void nextTick(() => { if (props.active && !disposed) void readViewport(false) })
}
function syncProps() {
  const next = targetCamera(), changed = requestVersion !== props.cameraRequest || !sameCamera(requestedCamera, next)
  const boundary = owner !== auth.context || wasActive !== props.active
  const resized = width !== props.size.width || height !== props.size.height
  if (!changed && !boundary && !resized) return
  traceMap('props', { changed, boundary, resized, scale: next?.zoom, gesture: userGesture })
  width = props.size.width; height = props.size.height
  // Resizing a native surface is not a request to restore its initial coordinates.
  if (!changed && !boundary) {
    if (!userGesture) void readViewport(false)
    return
  }
  tapRevision++; invalidate(); owner = auth.context; wasActive = props.active; requestedCamera = next; requestVersion = props.cameraRequest
  if (!next) { ready.value = false; error.value = '地图位置无效，请重新定位。'; camera.value = undefined; return }
  if (changed) { camera.value = next; observedCamera = next }
  emit('gesture', false)
  error.value = ''
  if (props.active && mounted && (!changed || !ready.value)) void nextTick(() => { if (!disposed && props.active) void readViewport(false) })
}
function points(path?: MapPoint[]) {
  if (!path || !path.every(point => Array.isArray(point) && validCoordinates(point[0], point[1]))) return []
  return path.map(([longitude, latitude]) => ({ longitude, latitude }))
}
let nextZoneId = 2, visibleZoneIds = new Map<string, number>()
const zonePins = computed(() => {
  const next = new Map<string, number>()
  const pins = props.zones.flatMap(zone => {
    const point = zone.source !== 'spot' && zone.boundary && boundaryPaths(zone.boundary)[0]?.[0]?.length
      ? boundaryAnchor(zone.boundary) : [zone.longitude, zone.latitude]
    if (!zone.id || !validCoordinates(point[0], point[1])) return []
    const key = `${zone.source}:${zone.id}`, id = visibleZoneIds.get(key) ?? nextZoneId++
    next.set(key, id)
    return [{ zoneId: zone.id, marker: { id, longitude: point[0]!, latitude: point[1]!, iconPath: noFishingPin,
      width: 48, height: 48, anchor: { x: 0.5, y: 1 }, zIndex: 95, title: `查看禁钓区域：${zone.title}` } }]
  })
  visibleZoneIds = next
  return pins
})
function onZoneTap(event: { detail?: { markerId?: number }; markerId?: number }) {
  if (!props.active || disposed) return
  const pin = zonePins.value.find(item => item.marker.id === (event.detail?.markerId ?? event.markerId))
  if (pin) emit('zone', pin.zoneId)
}
const markers = computed(() => [...zonePins.value.map(pin => pin.marker), ...(!pinVisible.value && validLocation(props.selected ?? undefined) ? [{ id: 1,
  longitude: props.selected!.longitude, latitude: props.selected!.latitude, iconPath: '/static/map/water-pin.png',
  width: 30, height: 40, anchor: { x: 0.5, y: 1 }, zIndex: 40 }] : [])])
const overlays = computed(() => {
  const polygons: { points: Location[]; strokeWidth: number; strokeColor: string; fillColor: string; zIndex: number }[] = []
  const polyline: { points: Location[]; color: string; width: number; zIndex: number }[] = []
  const danger = appearance.palette.danger
  const polygon = (rings: MapPoint[][], color: string, fill: string, zIndex: number) => {
    const outer = points(rings[0])
    if (outer.length < 3) return
    // Native polygons have no hole field. Keep outlines and a transparent fill
    // when islands/holes exist instead of painting those land areas as water.
    polygons.push({ points: outer, strokeWidth: 2, strokeColor: color, fillColor: rings.length > 1 ? '#00000000' : fill, zIndex })
    for (const ring of rings.slice(1)) {
      const inner = points(ring)
      if (inner.length > 2) polyline.push({ points: inner, color, width: 2, zIndex })
    }
  }
  if (props.water?.polygon) polygon(props.water.polygon, '#287baa', '#4195c747', 20)
  const line = points(props.water?.line)
  if (line.length > 1) polyline.push({ points: line, color: '#287baa', width: 3, zIndex: 20 })
  for (const zone of props.zones) {
    if (zone.source !== 'spot' && zone.boundary) for (const rings of boundaryPaths(zone.boundary)) polygon(rings, danger, `${danger}1f`, 30)
  }
  return { polygons, polyline }
})
watch(() => [props.center.longitude, props.center.latitude, props.zoom, props.cameraRequest, props.size.width, props.size.height, props.active, auth.context],
  syncProps, { immediate: true, flush: 'post' })
watch(() => [props.selected?.longitude, props.selected?.latitude, props.operationPending], () => { if (!pinDragging.value) void syncPin() }, { flush: 'post' })
onMounted(() => { mounted = true; if (props.active && camera.value) void readViewport(false) })
onUnmounted(() => { disposed = true; invalidate(); context = undefined })
</script>

<template>
  <view class="native-water-map">
    <map v-if="!!camera" :id="mapId" :key="mapKey" class="native-water-map__surface"
      :style="{ width: size.width + 'px', height: size.height + 'px' }"
      :longitude="camera.longitude" :latitude="camera.latitude" :scale="camera.zoom"
      :markers="markers" :polygons="overlays.polygons" :polyline="overlays.polyline" @markertap.stop="onZoneTap" @callouttap.stop="onZoneTap"
      :show-location="false" :enable-scroll="active && !pinDragging" :enable-zoom="active && !pinDragging" :enable-rotate="false" :enable-overlooking="false"
      :enable-3D="!!threeDimensional" :skew="threeDimensional ? 40 : 0" :show-compass="false" :enable-traffic="false" aria-label="水域地图"
      @regionchange="onRegionChange" @updated="onUpdated" @tap="onTap" @poitap="onTap" @error="onError" />
    <movable-area v-if="pinVisible" class="native-water-map__pin-area" :style="{ width: size.width + 'px', height: size.height + 'px' }">
      <movable-view class="native-water-map__pin" direction="all" :x="pinPosition!.x" :y="pinPosition!.y"
        :animation="false" :inertia="false" :disabled="operationPending" :scale="false" aria-label="拖动标记微调位置"
        @touchstart.stop="startPinDrag" @change="movePin" @touchend.stop="endPinDrag()" @touchcancel.stop="endPinDrag(true)" @tap.stop>
        <image class="native-water-map__pin-image" src="/static/map/water-pin.png" mode="aspectFit" />
      </movable-view>
    </movable-area>
    <view v-if="error" class="native-water-map__error" role="alert">
      <text>{{ error }}</text><MobileAction variant="link" @click="retry">重新加载地图</MobileAction>
    </view>
  </view>
</template>

<style scoped>
.native-water-map { position: absolute; inset: 0; overflow: hidden; background: var(--lake-soft); }
.native-water-map__surface { position: absolute; inset: 0; width: 100%; height: 100%; }
.native-water-map__pin-area { position: absolute; inset: 0; z-index: 60; pointer-events: none; }
.native-water-map__pin { width: 48px; height: 56px; pointer-events: auto; touch-action: none; }
.native-water-map__pin-image { position: absolute; left: 9px; top: 8px; width: 30px; height: 40px; pointer-events: none; }
.native-water-map__error { position: absolute; z-index: 90; top: 68px; inset-inline: var(--fishing-page-start) var(--fishing-page-end); display: flex; flex-direction: column; gap: 4px; padding: 12px; border-radius: 12px; background: var(--paper); color: var(--danger); }
</style>
