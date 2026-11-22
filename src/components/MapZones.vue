<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileBottomSheet from '@mobile-core/components/MobileBottomSheet.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileInlineLabel from '@mobile-core/components/MobileInlineLabel.vue'
import { elementOf, type ElementTarget } from '@mobile-core/form-focus'
import ZoneInfo from './ZoneInfo.vue'
import FishingLoadingStatus from './FishingLoadingStatus.vue'
import { zonesNearby } from '@/services/zones'
import { ApiError } from '@/services/http'
import { chinaDate, zoneSourceLabel, type Zone, type ZoneBounds } from '@/domain/zones'
import { spotReportZone } from '@/domain/spot-zone'
import { errorText } from '@/domain/rules'
// #ifdef H5
import { useAuthStore } from '@/stores/auth'
import { isDemo } from '@/config'
import { loadWaterNotices } from '@/services/discovery'
import { waterOutline } from '@/domain/water-surfaces'
import { boundaryAnchor, boundaryBounds } from '@/domain/zone-geometry'
import { governmentNoticeUrl } from '../../supabase/functions/_shared/discovery-contract'
const auth = useAuthStore()
// #endif

defineOptions({ options: { styleIsolation: 'apply-shared' } })
const props = defineProps<{
  bounds: ZoneBounds | null
  focusRequest?: { id: string } | null
  active: boolean
}>()
const emit = defineEmits<{ overlays: [zones: Zone[]] }>()
const items = ref<Zone[]>([])
const releasedItems = ref<Zone[]>([])
const selected = ref<Zone | null>(null)
const sheetOpen = ref(false)
const sheetView = ref<'list' | 'detail'>('list')
const listOrigin = ref('')
const listBody = ref<ElementTarget>()
const backAction = ref<ElementTarget>()
const loading = ref(false)
const error = ref('')
const zoomIn = ref(false)
let version = 0
let timer: ReturnType<typeof setTimeout> | undefined
let expiryTimer: ReturnType<typeof setInterval> | undefined

const zoneKey = (zone: Zone) => `${zone.source}:${zone.id}`

function choose(zone: Zone, fromList = false) {
  listOrigin.value = fromList ? zoneKey(zone) : ''
  selected.value = zone
  sheetView.value = 'detail'
  sheetOpen.value = true
}
function openList() {
  listOrigin.value = ''
  sheetView.value = 'list'
  sheetOpen.value = true
  if (!loading.value || timer) void load()
}
function resetClosedSheet() {
  if (!sheetOpen.value) {
    selected.value = null
    listOrigin.value = ''
  }
}
function removeSelection() {
  selected.value = null
  if (sheetView.value !== 'detail') return
  if (listOrigin.value) sheetView.value = 'list'
  else sheetOpen.value = false
}
defineExpose({ openList })
// #ifdef H5
watch(sheetView, (view) => {
  if (!sheetOpen.value) return
  if (view === 'detail') {
    elementOf(backAction.value)?.focus({ preventScroll: true })
  } else if (listOrigin.value) {
    const list = elementOf(listBody.value)
    const target = list?.querySelector<HTMLElement>('.zone-sheet__last-row')
      || list?.closest('[role="dialog"]')?.querySelector<HTMLElement>('.mobile-sheet__close')
    target?.focus()
  }
}, { flush: 'post' })
// #endif
function feedbackChanged(zone: Zone) {
  selected.value = zone
  const other = (item: Zone) => item.id !== zone.id || item.source !== zone.source
  items.value = items.value.filter(other)
  releasedItems.value = releasedItems.value.filter(other)
  if (zone.feedback?.released) releasedItems.value.push(zone)
  else items.value.push(zone)
  emit('overlays', items.value)
}
// #ifdef H5
async function addWaterNotices(bounds: ZoneBounds, current: number) {
  if (isDemo || !auth.signedIn || bounds.east < 114.16 || bounds.west > 114.22 ||
      bounds.north < 30.47 || bounds.south > 30.54) return
  const notices = await loadWaterNotices()
  if (current !== version) return
  const today = chinaDate()
  const added = notices.flatMap((notice): Zone[] => {
    if (!governmentNoticeUrl(notice.sourceUrl) || notice.validFrom > today || notice.validUntil < today ||
        items.value.some(zone => zone.source === 'official' && zone.title.includes(notice.name))) return []
    const boundary = waterOutline(notice.name)
    if (!boundary) return []
    const extent = boundaryBounds(boundary)
    if (extent.east < bounds.west || extent.west > bounds.east ||
        extent.north < bounds.south || extent.south > bounds.north) return []
    const [longitude, latitude] = boundaryAnchor(boundary)
    return [{
      id: 'notice-' + notice.name, source: 'notice', title: notice.name,
      description: notice.evidence, location_label: '武汉市 ' + notice.name,
      longitude, latitude, radius_m: 0, boundary, crs: 'GCJ-02',
      boundary_note: '按公告中所列全水域限制和已收录水面自动显示，实际范围以公告和现场标识为准。',
      water_attribution: '© OpenStreetMap', water_source_url: 'https://www.openstreetmap.org/copyright',
      source_url: notice.sourceUrl, observed_on: notice.validFrom, expires_on: notice.validUntil,
      status: 'published', revision: 1, created_at: notice.validFrom
    }]
  })
  if (!added.length) return
  items.value = [...items.value, ...added]
  emit('overlays', items.value)
}
// #endif
watch(() => props.focusRequest, request => {
  const zone = items.value.find(item => item.id === request?.id)
  if (zone) choose(zone)
})
async function load(retried = false) {
  clearTimeout(timer)
  timer = undefined
  if (!props.active || !props.bounds) return
  const current = ++version
  loading.value = true
  error.value = ''
  try {
    const result = await zonesNearby(props.bounds)
    if (current !== version) return
    const reported = (result.spot_points || []).flatMap(point => {
      const zone = spotReportZone(point)
      return zone ? [zone] : []
    })
    items.value = [...result.items, ...reported]
    releasedItems.value = result.released || []
    zoomIn.value = result.zoom_in
    emit('overlays', items.value)
    const existing = selected.value
    if (existing) {
      selected.value = [...items.value, ...releasedItems.value].find(
        item => item.id === existing.id && item.source === existing.source
      ) || null
      if (!selected.value) removeSelection()
    }
    // #ifdef H5
    if (!result.zoom_in) void addWaterNotices(props.bounds, current)
    // #endif
  } catch (cause) {
    if (current !== version) return
    error.value = errorText(cause)
    if (!retried && cause instanceof ApiError && (cause.code === 'NETWORK_ERROR' || cause.status >= 500)) {
      timer = setTimeout(() => void load(true), 1000)
    }
  } finally {
    if (current === version) loading.value = false
  }
}
watch([() => props.bounds, () => props.active], () => {
  version++
  clearTimeout(timer)
  timer = undefined
  loading.value = !!(props.active && props.bounds)
  error.value = ''
  if (props.active && props.bounds) {
    // Keep the current overlays visible until the next viewport response arrives.
    timer = setTimeout(() => void load(), 250)
  } else {
    items.value = []
    releasedItems.value = []
    zoomIn.value = false
    emit('overlays', [])
    if (!props.active) {
      selected.value = null
      sheetOpen.value = false
    }
  }
}, { immediate: true, flush: 'sync' })
watch(() => props.active, active => {
  clearInterval(expiryTimer)
  if (!active) return
  expiryTimer = setInterval(() => {
    const current = items.value.filter(zone => !zone.expires_on || zone.expires_on >= chinaDate())
    if (current.length === items.value.length) return
    items.value = current
    emit('overlays', current)
    if (selected.value && !current.some(zone => zone.id === selected.value?.id)) removeSelection()
  }, 60000)
}, { immediate: true })
onBeforeUnmount(() => {
  version++
  clearTimeout(timer)
  clearInterval(expiryTimer)
})
</script>

<template>
  <view class="map-zones">
    <view v-if="error && !sheetOpen" class="zone-error" role="status">
      <text>禁钓区域未加载</text>
      <MobileAction class="text-action" @click="load()">重试</MobileAction>
    </view>
    <MobileBottomSheet
      v-model="sheetOpen"
      :title="sheetView === 'list' ? '地图内禁钓区域' : selected?.feedback?.released ? '已解除区域' : '禁钓提醒'"
      :close-label="sheetView === 'list' ? '关闭区域列表' : '关闭区域详情'"
      :z-index="150"
      root-portal
      @after-leave="resetClosedSheet"
    >
      <template v-if="sheetView === 'detail' && listOrigin" #toolbar>
        <MobileAction ref="backAction" class="text-action zone-sheet__back" @click="sheetView = 'list'">
          <MobileInlineLabel icon="back" label="返回区域列表" />
        </MobileAction>
      </template>
      <view class="zone-sheet stack">
        <MobileLoadError v-if="error" inline title="禁钓区域未加载" :message="error" @retry="load()" />
        <view v-if="sheetView === 'list'" ref="listBody" class="zone-sheet__list">
          <FishingLoadingStatus v-if="loading && !items.length" label="正在读取禁钓区域…" />
          <text v-else-if="!error && !items.length && !releasedItems.length" class="muted">{{
            zoomIn ? '请放大地图查看。' : '暂未收录此范围的禁钓区域，请核对现场标识和最新公告。'
          }}</text>
          <MobileAction v-for="zone in items" :key="zoneKey(zone)" class="zone-sheet__row"
            :class="{ 'zone-sheet__last-row': listOrigin === zoneKey(zone) }" @click="choose(zone, true)">
            <view class="zone-sheet__row-copy">
              <text class="name">{{ zone.title }}</text>
              <text class="caption">{{ zoneSourceLabel(zone) }}</text>
            </view>
            <MobileIcon class="zone-sheet__chevron" name="chevron" :size="16" aria-hidden="true" />
          </MobileAction>
          <text v-if="releasedItems.length" class="name zone-sheet__group-heading">钓友反馈已解除</text>
          <MobileAction v-for="zone in releasedItems" :key="zoneKey(zone)" class="zone-sheet__row"
            :class="{ 'zone-sheet__last-row': listOrigin === zoneKey(zone) }" @click="choose(zone, true)">
            <view class="zone-sheet__row-copy">
              <text class="name">{{ zone.title }}</text>
              <text class="caption">
                {{ zone.feedback?.can_fish }} / {{ zone.feedback?.total }} · {{ zone.feedback?.percent }}%
              </text>
            </view>
            <MobileIcon class="zone-sheet__chevron" name="chevron" :size="16" aria-hidden="true" />
          </MobileAction>
        </view>
        <ZoneInfo v-else-if="selected" :zone="selected" @feedback="feedbackChanged" @refresh="load()" />
      </view>
    </MobileBottomSheet>
  </view>
</template>

<style scoped>
.map-zones {
  position: absolute;
  inset: 0;
  z-index: 120;
  pointer-events: none;
}
.map-zones :deep(.mobile-sheet),
.map-zones :deep(.wd-overlay) {
  pointer-events: auto;
}
.zone-error {
  position: absolute;
  left: 12px;
  bottom: max(32px, env(safe-area-inset-bottom));
  max-width: calc(100% - 24px);
  display: flex;
  align-items: center;
  gap: 8px;
  padding-inline: 12px;
  background: var(--paper);
  border-radius: 12px;
  pointer-events: auto;
  font-size: var(--fishing-label-size);
}
.zone-sheet {
  padding: 12px max(16px, var(--mobile-safe-right, 0px)) 16px max(16px, var(--mobile-safe-left, 0px));
  pointer-events: auto;
}
.zone-sheet__list {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.zone-sheet__row.mobile-action {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: var(--fishing-target);
  padding: 12px 4px;
  border-radius: 10px;
  text-align: start;
  white-space: normal;
}
.zone-sheet__row + .zone-sheet__row {
  border-top: 1px solid var(--line);
}
.zone-sheet__row-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.zone-sheet__row-copy .name {
  font-size: var(--fishing-text-size);
  font-weight: 600;
  line-height: 1.42;
}
.zone-sheet__chevron {
  color: var(--reed);
}
.zone-sheet__group-heading {
  margin-top: 12px;
}
.zone-sheet__back.mobile-action {
  width: fit-content;
  max-width: 100%;
  min-height: 44px;
}
</style>
