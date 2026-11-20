<script setup lang="ts">
import { computed, nextTick, ref, watch, onBeforeUnmount } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileField from '@mobile-core/components/MobileField.vue'
import MobileBottomSheet from '@mobile-core/components/MobileBottomSheet.vue'
import MobileConfirmDialog from '@mobile-core/components/MobileConfirmDialog.vue'
import ZoneInfo from './ZoneInfo.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileDateTimeField from '@mobile-core/components/MobileDateTimeField.vue'
import { revealControl } from '@mobile-core/form-focus'
// #ifdef H5
import { reverseAreaName } from '@/platforms/amap'
// #endif
import { useAuthStore } from '@/stores/auth'
import { zonesNearby, zonesWrite } from '@/services/zones'
import { chinaDate, safeSourceUrl, type Zone, type ZoneBounds } from '@/domain/zones'
import {
  boundaryAnchor,
  boundaryBounds,
  reportBoundary,
  validReportBoundary
} from '@/domain/zone-geometry'
import type { MapPoint } from '@mobile-core/map'
import { createId, errorText, validDate } from '@/domain/rules'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
const props = withDefaults(
  defineProps<{
    bounds: ZoneBounds | null
    center: { longitude: number; latitude: number; name?: string } | null
    point?: { longitude: number; latitude: number } | null
    pick?: boolean
    staticMode?: boolean
    focusRequest?: { id: string } | null
    active?: boolean
  }>(),
  { active: true }
)
const emit = defineEmits<{
  overlays: [zones: Zone[]]
  preview: [points: MapPoint[]]
  drawing: [value: boolean]
  focus: [zone: Zone]
}>()
const auth = useAuthStore()
const items = ref<Zone[]>([]),
  selected = ref<Zone | null>(null),
  detailsOpen = ref(false),
  listOpen = ref(false)
const releasedItems = ref<Zone[]>([])
const loading = ref(false),
  error = ref(''),
  zoomIn = ref(false),
  notice = ref('')
const drawing = ref(false),
  points = ref<MapPoint[]>([]),
  formOpen = ref(false)
const title = ref(''),
  description = ref(''),
  location = ref(''),
  source = ref('')
const observed = ref(chinaDate()),
  expires = ref(chinaDate(30)),
  consent = ref(false)
const fieldErrors = ref<Record<string, string>>({})
const busy = ref(false),
  formError = ref(''),
  discard = ref(false),
  extra = ref(false)
let version = 0,
  formVersion = 0,
  disposed = false,
  requestId = '',
  zoneId = '',
  attempted = ''
let timer: ReturnType<typeof setTimeout> | undefined,
  expiryTimer: ReturnType<typeof setInterval> | undefined
let leaveDecision: ((value: boolean) => void) | undefined
const canFinish = computed(() => points.value.length >= 3)
function confirmLeave(): Promise<boolean> {
  if (!drawing.value) return Promise.resolve(true)
  if (busy.value) return Promise.resolve(false)
  discard.value = true
  return new Promise((resolve) => {
    leaveDecision?.(false)
    leaveDecision = resolve
  })
}
function resetForm() {
  formVersion++
  drawing.value = formOpen.value = false
  points.value = []
  title.value = description.value = location.value = source.value = ''
  observed.value = chinaDate()
  expires.value = chinaDate(30)
  consent.value = busy.value = discard.value = extra.value = false
  formError.value = attempted = ''
  fieldErrors.value = {}
  emit('drawing', false)
  emit('preview', [])
}
function discardConfirmed() {
  const resolve = leaveDecision
  leaveDecision = undefined
  resetForm()
  resolve?.(true)
}
function discardCancelled() {
  leaveDecision?.(false)
  leaveDecision = undefined
}
function start(initial?: { title?: string; location?: string }) {
  if (props.pick || !props.center || !auth.requireLogin()) return
  if (props.staticMode) {
    notice.value = '请在 App 或交互地图上沿水域边界标记禁钓区。'
    return
  }
  resetForm()
  selected.value = null
  detailsOpen.value = listOpen.value = false
  zoneId = createId()
  requestId = createId()
  drawing.value = true
  title.value = initial?.title || ''
  location.value = initial?.location || props.center.name || ''
  emit('drawing', true)
}
function addPoint(point: { longitude: number; latitude: number } | null | undefined) {
  if (!drawing.value || busy.value || formOpen.value || !point) return
  if (points.value.length >= 120) {
    formError.value = '最多 120 个边界点，请撤销多余的点。'
    return
  }
  points.value = [...points.value, [point.longitude, point.latitude]]
  formError.value = ''
  emit('preview', points.value)
}
function undoPoint() {
  points.value = points.value.slice(0, -1)
  formError.value = ''
  emit('preview', points.value)
}
function finish() {
  if (!canFinish.value || !validReportBoundary(reportBoundary(points.value))) {
    formError.value = '沿河湖水面顺序选至少 3 个边界点，边线不能交叉，范围不超过 10 公里。'
    return
  }
  formError.value = ''
  formOpen.value = true
  // #ifdef H5
  if (!location.value.trim()) {
    const anchor = boundaryAnchor(reportBoundary(points.value)),
      current = formVersion
    void reverseAreaName(anchor)
      .then((name) => {
        if (current === formVersion && !location.value.trim()) location.value = name
      })
      .catch(() => {})
  }
  // #endif
}
function choose(zone: Zone) {
  if (!drawing.value) {
    selected.value = zone
    listOpen.value = false
    detailsOpen.value = true
  }
}
function openList() {
  if (!drawing.value) {
    listOpen.value = true
    void load()
  }
}
function feedbackChanged(zone: Zone) {
  selected.value = zone
  items.value = items.value.filter((item) => item.id !== zone.id || item.source !== zone.source)
  releasedItems.value = releasedItems.value.filter(
    (item) => item.id !== zone.id || item.source !== zone.source
  )
  if (zone.feedback?.released) releasedItems.value.push(zone)
  else items.value.push(zone)
  emit('overlays', items.value)
}
defineExpose({ confirmLeave, start, openList })
watch(() => props.point, addPoint)
watch(
  () => props.focusRequest,
  (request) => {
    const zone = items.value.find((z) => z.id === request?.id)
    if (zone) choose(zone)
  }
)
async function load() {
  const current = ++version
  if (disposed || !props.active || !props.bounds) return
  loading.value = true
  error.value = ''
  try {
    const result = await zonesNearby(props.bounds)
    if (current !== version) return
    items.value = result.items
    releasedItems.value = result.released || []
    zoomIn.value = result.zoom_in
    emit('overlays', result.items)
    if (selected.value) {
      selected.value =
        [...items.value, ...releasedItems.value].find(
          (z) => z.id === selected.value?.id && z.source === selected.value?.source
        ) || null
      if (!selected.value) detailsOpen.value = false
    }
  } catch (cause) {
    if (current === version) error.value = errorText(cause)
  } finally {
    if (current === version) loading.value = false
  }
}
function schedule() {
  version++
  clearTimeout(timer)
  loading.value = false
  error.value = ''
  items.value = []
  releasedItems.value = []
  emit('overlays', [])
  if (!props.active) {
    selected.value = null
    detailsOpen.value = listOpen.value = false
    return
  }
  if (!disposed && props.bounds) timer = setTimeout(load, 250)
}
watch([() => props.bounds, () => props.active], schedule, { immediate: true, flush: 'sync' })
watch(
  () => auth.context,
  () => {
    resetForm()
    selected.value = null
    detailsOpen.value = listOpen.value = false
    notice.value = ''
    schedule()
  },
  { flush: 'sync' }
)
watch(
  () => props.active,
  (active) => {
    clearInterval(expiryTimer)
    if (active)
      expiryTimer = setInterval(() => {
        const current = items.value.filter((z) => !z.expires_on || z.expires_on >= chinaDate())
        if (current.length !== items.value.length) {
          items.value = current
          emit('overlays', current)
          if (selected.value && !current.some((z) => z.id === selected.value?.id)) {
            selected.value = null
            detailsOpen.value = false
          }
        }
      }, 60000)
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  disposed = true
  version++
  formVersion++
  clearTimeout(timer)
  clearInterval(expiryTimer)
  leaveDecision?.(false)
})
function cancelDrawing() {
  if (!points.value.length) resetForm()
  else discard.value = true
}
function invalid(field: string, message: string) {
  fieldErrors.value = { ...fieldErrors.value, [field]: message }
  formError.value = message
  void nextTick(() => revealControl(field))
}
watch([title, location, description, consent], () => {
  fieldErrors.value = {}
  formError.value = ''
})
async function submit() {
  if (busy.value) return
  formError.value = ''
  fieldErrors.value = {}
  const boundary = reportBoundary(points.value)
  if (!validReportBoundary(boundary)) {
    formError.value = '请返回地图检查水域边界。'
    return
  }
  if (title.value.trim().length < 2) {
    invalid('zone-title', '请填写至少 2 字的禁钓区名称')
    return
  }
  if (!location.value.trim()) {
    invalid('zone-location', '请填写水域的地理位置')
    return
  }
  if (description.value.trim().length < 10) {
    invalid('zone-description', '请用至少 10 字说明禁钓依据与水域范围')
    return
  }
  if (
    !validDate(observed.value) ||
    observed.value > chinaDate() ||
    observed.value < chinaDate(-90) ||
    !validDate(expires.value) ||
    expires.value < chinaDate() ||
    new Date(expires.value).getTime() - new Date(observed.value).getTime() > 180 * 86400000
  ) {
    formError.value = '发现日期需在近 90 天内，截止日期距发现日期不超过 180 天。'
    return
  }
  if (source.value.trim() && !safeSourceUrl(source.value.trim())) {
    formError.value = '来源请填写完整 HTTPS 链接，或留空。'
    return
  }
  if (!consent.value) {
    invalid('zone-consent', '请确认公开的范围与说明。')
    return
  }
  const extent = boundaryBounds(boundary),
    anchor = boundaryAnchor(boundary)
  const radius = Math.ceil(
    Math.hypot(
      (extent.east - extent.west) * 111320 * Math.cos((anchor[1] * Math.PI) / 180),
      (extent.north - extent.south) * 111320
    ) / 2
  )
  const payload = {
    id: zoneId,
    boundary,
    longitude: anchor[0],
    latitude: anchor[1],
    radius_m: Math.min(5000, Math.max(50, radius)),
    title: title.value.trim(),
    description: description.value.trim(),
    location_label: location.value.trim(),
    observed_on: observed.value,
    expires_on: expires.value,
    source_url: source.value.trim(),
    crs: 'GCJ-02',
    consent: true
  }
  const signature = JSON.stringify(payload)
  if (attempted && attempted !== signature) {
    formError.value = '上次结果尚未确认，请恢复原内容重试，或到“我的标记”检查。'
    return
  }
  attempted = signature
  const current = formVersion
  busy.value = true
  try {
    await zonesWrite('submit', { ...payload, request_id: requestId })
    if (current !== formVersion) return
    resetForm()
    uni.showToast({ title: '已公开禁钓标记', icon: 'none' })
    void load()
  } catch (cause) {
    if (current === formVersion) formError.value = errorText(cause)
  } finally {
    if (current === formVersion) busy.value = false
  }
}
</script>
<template>
  <view class="map-zones">
    <view v-if="error" class="zone-error" role="status"
      ><text>禁钓区域未加载</text
      ><MobileAction class="text-action" @click="load">重试</MobileAction></view
    >
    <view v-if="drawing && !formOpen" class="zone-drawing">
      <view class="zone-drawing__header"
        ><text class="name">圈出禁钓水域</text
        ><MobileAction variant="icon" aria-label="取消本次标记" @click="cancelDrawing"
          ><MobileIcon name="close" size="18px" /></MobileAction
      ></view>
      <text class="caption" role="status">{{
        points.length ? '已选 ' + points.length + ' 个边界点' : '沿水面依次点选，至少 3 个边界点'
      }}</text>
      <text v-if="formError" class="error" role="alert">{{ formError }}</text>
      <view class="zone-drawing__actions">
        <MobileAction
          variant="icon"
          class="secondary"
          aria-label="撤销上个边界点"
          :disabled="!points.length"
          @click="undoPoint"
          ><MobileIcon name="back" size="20px"
        /></MobileAction>
        <MobileAction class="secondary" @click="addPoint(center)">中心加点</MobileAction>
        <MobileAction
          class="primary"
          :disabled="!canFinish"
          aria-label="填写禁钓区说明"
          @click="finish"
          >继续</MobileAction
        >
      </view>
    </view>
    <MobileBottomSheet
      v-model="detailsOpen"
      :title="selected?.feedback?.released ? '已解除区域' : '禁钓区域'"
      close-label="关闭区域详情"
      :z-index="150"
      root-portal
    >
      <view v-if="selected && detailsOpen" class="zone-sheet"
        ><ZoneInfo :zone="selected" @feedback="feedbackChanged" @refresh="load"
      /></view>
    </MobileBottomSheet>
    <MobileBottomSheet
      v-model="listOpen"
      title="地图内禁钓区域"
      close-label="关闭区域列表"
      :z-index="150"
      root-portal
    >
      <view class="zone-sheet stack">
        <text v-if="loading" role="status">正在读取…</text>
        <text v-else-if="!items.length && !releasedItems.length" class="muted">{{
          zoomIn ? '请放大地图查看。' : '暂未收录此范围的禁钓区域，以当地公告和现场标牌为准。'
        }}</text>
        <MobileAction v-for="zone in items" :key="zone.id" class="list-row" @click="choose(zone)"
          ><text>{{ zone.title }}</text
          ><text class="caption">{{
            zone.source === 'official' ? '官方公告' : '钓友上报'
          }}</text></MobileAction
        >
        <text v-if="releasedItems.length" class="name">钓友反馈已解除</text>
        <MobileAction
          v-for="zone in releasedItems"
          :key="`${zone.source}-${zone.id}`"
          class="list-row"
          @click="choose(zone)"
          ><text>{{ zone.title }}</text
          ><text class="caption"
            >{{ zone.feedback?.can_fish }} / {{ zone.feedback?.total }} ·
            {{ zone.feedback?.percent }}%</text
          ></MobileAction
        >
        <text v-if="notice" class="notice">{{ notice }}</text>
      </view>
    </MobileBottomSheet>
    <MobileBottomSheet
      v-model="formOpen"
      title="禁钓区说明"
      tall
      close-label="返回地图边界"
      :busy="busy"
      :z-index="150"
      root-portal
    >
      <view class="zone-sheet stack">
        <text class="caption">保存后公开，来源显示为钓友标记。</text>
        <MobileField
          v-model="title"
          field="zone-title"
          label="禁钓区名称"
          :error="fieldErrors['zone-title']"
          :maxlength="80"
          required
          :disabled="busy"
          placeholder="水域或禁钓区域名称"
        />
        <MobileField
          v-model="location"
          field="zone-location"
          label="地理位置"
          :error="fieldErrors['zone-location']"
          :maxlength="160"
          required
          :disabled="busy"
          placeholder="省市、水域及附近地标"
        />
        <MobileField
          v-model="description"
          field="zone-description"
          label="禁钓依据与描述"
          :error="fieldErrors['zone-description']"
          multiline
          :maxlength="1000"
          required
          :disabled="busy"
          placeholder="说明水域边界、禁钓标牌或当地管理规定"
        />
        <text class="caption">发现于 {{ observed }} · 截至 {{ expires }}</text>
        <MobileAction class="text-action" :aria-expanded="extra" @click="extra = !extra">{{
          extra ? '收起日期与来源' : '修改日期 / 补充来源'
        }}</MobileAction>
        <template v-if="extra">
          <MobileDateTimeField
            v-model:date="observed"
            field="zone-observed"
            label="发现日期"
            :disabled="busy"
            date-only
          />
          <MobileDateTimeField
            v-model:date="expires"
            field="zone-expires"
            label="截止日期"
            :disabled="busy"
            date-only
          />
          <MobileField
            v-model="source"
            field="zone-source"
            label="依据链接（选填）"
            :maxlength="1000"
            :disabled="busy"
            placeholder="https://…"
          />
        </template>
        <MobileAction
          id="zone-consent"
          class="zone-consent"
          role="checkbox"
          :aria-checked="consent"
          :disabled="busy"
          @click="consent = !consent"
        >
          <view class="zone-consent__box" aria-hidden="true"
            ><wd-checkbox
              :model-value="consent"
              type="circle"
              :readonly="true"
              checked-color="var(--lake)"
              unchecked-color="var(--reed)"
              custom-style="--wot-checkbox-icon-size:22px;pointer-events:none;"
          /></view>
          <text>公开此范围和说明，标记为钓友提供。</text>
        </MobileAction>
        <text v-if="formError" class="error" role="alert">{{ formError }}</text>
      </view>
      <template #footer
        ><MobileAction
          class="primary zone-submit"
          :loading="busy"
          :disabled="busy"
          @click="submit"
          >{{ busy ? '正在保存…' : '保存禁钓标记' }}</MobileAction
        ></template
      >
    </MobileBottomSheet>
    <MobileConfirmDialog
      v-model="discard"
      title="放弃本次标记？"
      message="未提交的水域边界和描述不会保存。"
      confirm-text="放弃标记"
      @confirm="discardConfirmed"
      @cancel="discardCancelled"
    />
  </view>
</template>
<style scoped>
.map-zones {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 120;
}
.map-zones :deep(.mobile-sheet),
.map-zones :deep(.wd-overlay) {
  pointer-events: auto;
}
.zone-error {
  position: absolute;
  top: 76px;
  left: 12px;
  right: 72px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-inline: 12px;
  background: var(--paper);
  border-radius: 12px;
  pointer-events: auto;
  font-size: 0.875rem;
}
.zone-drawing {
  position: absolute;
  bottom: max(32px, env(safe-area-inset-bottom));
  left: 12px;
  right: 12px;
  max-width: 460px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--paper);
  pointer-events: auto;
  box-shadow: 0 2px 12px #0002;
}
.zone-drawing__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.zone-drawing__actions {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
  margin-top: 12px;
}
.zone-drawing__actions .mobile-action {
  padding-inline: 8px;
}
.zone-sheet {
  padding: 12px 20px 24px;
  pointer-events: auto;
}
.zone-submit {
  width: 100%;
  margin-block: 12px;
}
.zone-consent {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-height: 48px;
  padding: 12px 0;
  color: var(--ink);
  text-align: start;
  white-space: normal;
  font-size: max(14px, 0.875rem);
  line-height: 1.6;
}
.zone-consent__box {
  flex: 0 0 22px;
  display: grid;
  place-items: center;
  height: 1.6em;
  min-height: 22px;
  pointer-events: none;
}
</style>
