<script setup lang="ts">

import { computed, ref, watch } from 'vue'
import { onLoad, onShow, onHide, onUnload } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import ContentEditState from '@/components/ContentEditState.vue'
import SpotDeleteAction from '@/components/SpotDeleteAction.vue'
import { useContentEdit } from '@/composables/useContentEdit'
import { editFields } from '@/domain/content-edit'
import MobileField from '@mobile-core/components/MobileField.vue'
import MobileSelect from '@mobile-core/components/MobileSelect.vue'
import MobileSegmented from '@mobile-core/components/MobileSegmented.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileMediaUploader from '@mobile-core/components/MobileMediaUploader.vue'
import { preserveMediaPickerPage, resumeMediaPickerPage } from '@mobile-core/media-picker-session'
import MobileMultiChoice from '@mobile-core/components/MobileMultiChoice.vue'
import MobileComboField from '@mobile-core/components/MobileComboField.vue'
import MobileDateTimeField from '@mobile-core/components/MobileDateTimeField.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import { locateSpot, describeSpotWater } from '@/platforms/spot-location'
import { spotEntryName, canSaveSpotPoint } from '@/domain/spot-entry'
import type { SelectedPlace } from '@/domain/map'
import { fishSpeciesOptions } from '@/domain/fishing-presets'
import type { CompositionPhoto } from '@/domain/composition'
import { uploadPhoto, canRetryPhoto, resolvePhotos } from '@/services/media'
import { sessionScope, assertSession } from '@/services/session'
import {
  freshSpot,
  createId,
  audienceOptions,
  validCoordinates,
  validDate,
  errorText
} from '@/domain/rules'
import { pickMap, consumeSelection } from '@/platforms/map-navigation'
import { useAuthStore } from '@/stores/auth'
import { useMutation } from '@/composables/useMutation'
import { write } from '@/services/repository'
import { ApiError } from '@/services/http'
import { checkSpotProhibition, type SpotProhibition } from '@/services/spot-prohibition'
import type { Spot, SpotDraft, Media } from '@/domain/models'
import { useDraftOwner } from '@/composables/useDraftOwner'
import { leadSourceName, shareSources } from '../../../supabase/functions/_shared/discovery-contract'
const auth = useAuthStore(),
  draft = ref(freshSpot()),
  requestId = ref(''),
  errors = ref<Record<string, string>>({})
const photos = ref<CompositionPhoto[]>([]),
  pageVisible = ref(true)
const locating = ref(false),
  locationResolved = ref(false),
  locationLabel = ref(''),
  locationError = ref(''),
  detailsOpen = ref(false)
const exactPoint = computed(() => canSaveSpotPoint(draft.value, locationResolved.value))
const prohibition = ref<SpotProhibition | null>(null)
const prohibited = computed(() => prohibition.value?.blocked && !(editor.editing.value && draft.value.fishing_status === 'prohibited'))
const sourceHint = computed(() => {
  const platforms = [...new Set(shareSources(draft.value.description || '').map(leadSourceName))]
  return platforms.length ? `保存后可查看${platforms.join('、')}原文。`
    : '可粘贴小红书、抖音、微信公众号、头条、B 站分享链接。'
})
let locationVersion = 0
function invalidateLocation() {
  locationVersion++
  locating.value = false
}
function resetLocation() {
  invalidateLocation()
  locationResolved.value = false
  locationLabel.value = ''
  locationError.value = ''
  prohibition.value = null
}
const uploading = computed(() => photos.value.some((p) => p.busy || (!p.asset && !p.error)))
const fromAsset = (asset: Media): CompositionPhoto => ({
  key: createId(),
  path: asset.url || '',
  kind: 'image',
  asset,
  busy: false,
  error: ''
})
function uploadRecovery(value: unknown): 'login' | 'retry' | 'remove' {
  if (
    value &&
    typeof value === 'object' &&
    (('status' in value && value.status === 401) ||
      ('code' in value &&
        ['NOT_AUTHENTICATED', 'AUTH_REQUIRED', 'SESSION_EXPIRED'].includes(String(value.code))))
  )
    return 'login'
  return canRetryPhoto(value) ? 'retry' : 'remove'
}
function uploadLogin() {
  uni.navigateTo({ url: '/pages/login/index' })
}
function syncPhotos() {
  draft.value.media = photos.value.flatMap((p) => (p.asset ? [p.asset] : []))
}
function releasePhotos() {
  photos.value.forEach((p) => p.release?.())
  photos.value = []
}
let mediaOwner = auth.userId,
  active = true
const { busy, error, run } = useMutation()
const { owner, available, resetting } = useDraftOwner(() => {
  resetLocation()
  const retain =
    mediaOwner === auth.userId && !editor.editing.value && !!uni.getStorageSync(draftKey())
  const pending = retain ? photos.value.filter((p) => !p.asset) : []
  for (const photo of photos.value) if (!pending.includes(photo)) photo.release?.()
  mediaOwner = auth.userId
  photos.value = []
  editor.reset()
  draft.value = freshSpot()
  requestId.value = ''
  errors.value = {}
  saved = false
  if (editor.editing.value) void loadEdit()
  else {
    restore()
    void initializeLocation()
  }
  for (const photo of pending) {
    photo.error = ''
    photo.needsLogin = false
    photo.busy = false
  }
  photos.value.push(...pending)
  uni.closePreviewImage({ fail: () => {} })
})
const editor = useContentEdit({
  latest: true,
  type: () => 'spot',
  owner,
  draft,
  hydrate: ({ item }) => {
    draft.value = {
      ...editFields('spot', item as SpotDraft),
      media: (item as Spot).media || []
    } as unknown as SpotDraft
  }
})
async function loadEdit(discard = false) {
  resetLocation()
  await editor.load(discard)
  if (editor.ready.value) {
    releasePhotos()
    photos.value = (draft.value.media || []).map(fromAsset)
    error.value = ''
    if (draft.value.precision === 'exact') void resolveStoredLocation()
  }
}
function restore() {
  try {
    const existing = uni.getStorageSync(draftKey())
    if (existing?.id) {
      draft.value = existing
      photos.value = (existing.media || []).map(fromAsset)
      void refreshPhotos()
    }
  } catch {
    /* keep a fresh draft */
  }
}
const draftKey = () => `dyj.live.spot-draft.${owner.value || 'guest'}`
let saved = false
onLoad((options) => {
  if (options?.id) {
    editor.id.value = options.id
    void loadEdit()
  } else if (owner.value) {
    restore()
    void initializeLocation()
  }
})
watch(
  draft,
  () => {
    if (!editor.editing.value && !saved && available.value && !resetting.value)
      try {
        uni.setStorageSync(draftKey(), draft.value)
      } catch {
        error.value = '草稿保存失败，请检查设备空间'
      }
  },
  { deep: true }
)
onShow(() => {
  pageVisible.value = true
  // #ifdef MP-WEIXIN
  if (resumeMediaPickerPage()) return
  // #endif
  if (!available.value) return
  const result = consumeSelection(requestId.value)
  if (result) {
    requestId.value = ''
    void applySelectedPlace(result)
  } else if (
    !locating.value &&
    !locationResolved.value &&
    draft.value.precision === 'exact' &&
    validCoordinates(draft.value.longitude, draft.value.latitude)
  )
    void resolveStoredLocation()
})
onHide(() => {
  // #ifdef MP-WEIXIN
  if (preserveMediaPickerPage()) return
  // #endif
  pageVisible.value = false
  invalidateLocation()
})
onUnload(() => {
  active = false
  invalidateLocation()
  releasePhotos()
})
async function refreshPhotos() {
  const scope = sessionScope.value,
    current = photos.value.filter((p) => p.asset)
  try {
    await resolvePhotos([{ media: current.map((p) => p.asset!) }])
    assertSession(scope)
    if (!active) return
    for (const photo of current)
      if (photos.value.includes(photo)) {
        photo.path = photo.asset!.url || ''
        photo.previewFailed = !photo.path
      }
  } catch {
    /* A stale session must not restore a private preview. */
  }
}
function select() {
  if (!available.value) return
  try {
    invalidateLocation()
    requestId.value = pickMap('water')
  } catch (e) {
    error.value = errorText(e)
  }
}
async function initializeLocation() {
  if (!available.value || editor.editing.value) return
  if (
    draft.value.precision === 'exact' &&
    validCoordinates(draft.value.longitude, draft.value.latitude)
  )
    return resolveStoredLocation()
  if (!validCoordinates(draft.value.longitude, draft.value.latitude))
    await locateCurrentPoint()
}
function resolveStoredLocation() {
  if (!validCoordinates(draft.value.longitude, draft.value.latitude)) return
  const place = {
    longitude: draft.value.longitude!,
    latitude: draft.value.latitude!,
    name: locationLabel.value || '已选位置',
    address: draft.value.location_label,
    crs: 'GCJ-02' as const,
    created_at: Date.now()
  }
  return resolvePoint(() => describeSpotWater(place), editor.editing.value)
}
async function resolvePoint(
  load: () => Promise<{ longitude: number; latitude: number; city: string; label: string }>,
  preserveDraft = false
) {
  if (!active || !pageVisible.value || !available.value) return
  const version = ++locationVersion,
    scope = sessionScope.value
  const current = () =>
    active &&
    pageVisible.value &&
    available.value &&
    version === locationVersion &&
    scope === sessionScope.value
  locating.value = true
  locationResolved.value = false
  locationError.value = ''
  prohibition.value = null
  errors.value.location = ''
  try {
    const place = await load()
    if (!current()) return
    if (preserveDraft && (Math.abs(draft.value.longitude! - place.longitude) > .00001 ||
        Math.abs(draft.value.latitude! - place.latitude) > .00001)) {
      locationLabel.value = ''
      locationError.value = '原钓位坐标在岸上，请在水域地图确认新位置。'
      return
    }
    if (!place.city.trim() || !validCoordinates(place.longitude, place.latitude))
      throw new Error('未能识别这个地点，请重新选点。')
    locationLabel.value = place.label === '已选位置' ? '' : place.label
    if (!preserveDraft || !draft.value.city) {
      draft.value.longitude = place.longitude
      draft.value.latitude = place.latitude
      draft.value.city = place.city
      draft.value.precision = 'exact'
      draft.value.location_label = locationLabel.value.slice(0, 240)
    }
    try {
      const restriction = await checkSpotProhibition(place.longitude, place.latitude)
      if (!current()) return
      prohibition.value = restriction
      locationResolved.value = true
      if (prohibited.value) locationError.value = '此位置已标记为禁钓，请重新选择水域。'
    } catch {
      if (current()) locationError.value = '禁钓范围暂未核对，请稍后重试或重新选点。'
    }
  } catch (cause) {
    if (current()) {
      locationLabel.value = ''
      locationError.value = cause instanceof ApiError ? errorText(cause)
        : cause instanceof Error && cause.message === '附近未找到水域，请在水域地图选点。' ? cause.message
        : '附近水域或所在城市暂未确认，请重试或在水域地图选点。'
    }
  } finally {
    if (current()) locating.value = false
  }
}
async function locateCurrentPoint() {
  if (!available.value || locating.value) return
  await resolvePoint(locateSpot)
}
async function applySelectedPlace(place: SelectedPlace) {
  if (!available.value || !validCoordinates(place.longitude, place.latitude)) return
  // Clear the previous city immediately; a failed or delayed lookup cannot pair it with this new point.
  draft.value.longitude = place.kind === 'water' ? place.longitude : null
  draft.value.latitude = place.kind === 'water' ? place.latitude : null
  draft.value.city = ''
  draft.value.location_label = ''
  draft.value.precision = 'exact'
  locationLabel.value = place.kind === 'water' ? place.name : ''
  await resolvePoint(() => describeSpotWater(place))
}
async function submit() {
  if (editor.editing.value && !editor.dirty.value) return
  if (!available.value) {
    auth.requireLogin()
    return
  }
  errors.value = {}
  if (photos.value.some((p) => p.busy || p.error || !p.asset))
    errors.value.media = '请等待照片上传完成，失败的照片可重试或移除'
  if (!validDate(draft.value.observed_on)) errors.value.observed_on = '请选择有效的信息核实日期'
  if (!exactPoint.value && !editor.onlyFishingStatusChanged.value)
    errors.value.location = '请先确认实际钓位位置和所在城市，再保存。'
  if (prohibited.value) errors.value.location = '此位置已标记为禁钓，不能创建钓位。'
  if (Object.keys(errors.value).length || !auth.requireLogin()) return
  await run(async () => {
    if (!editor.onlyFishingStatusChanged.value) {
      prohibition.value = await checkSpotProhibition(draft.value.longitude!, draft.value.latitude!)
      if (prohibited.value) {
        errors.value.location = '此位置已标记为禁钓，不能创建钓位。'
        return
      }
    }
    draft.value.name = spotEntryName(draft.value.name, locationLabel.value)
    if (!editor.editing.value) draft.value.fishing_status = 'allowed'
    if (!draft.value.location_label) draft.value.location_label = locationLabel.value.slice(0, 240)
    if (editor.editing.value) await editor.save()
    else await write<{ id: string }>('save_spot', editFields('spot', draft.value))
    saved = true
    if (!editor.editing.value) uni.removeStorageSync(draftKey())
    uni.reLaunch({ url: '/pages/home/index?tab=spots' })
  })
}
</script>
<template>
  <FishingShell :title="editor.editing.value ? '编辑钓位' : '记下一个钓位'" back>
    <view v-if="available" :key="draft.id" class="fishing-content stack spot-entry">
      <ContentEditState
        v-if="editor.editing.value"
        direct-publication
        :loading="editor.loading.value"
        :ready="editor.ready.value"
        :error="editor.error.value"
        :conflict="editor.conflict.value"
        :restored="false"
        :publication="editor.publication.value"
        :update="editor.contentUpdate.value"
        :audience="draft.audience"
        @reload="loadEdit"
      />
      <template v-if="!editor.editing.value || editor.ready.value">
        <view class="panel stack">
          <view class="spot-entry__place">
            <MobileIcon name="location" :size="22" class="spot-entry__pin" />
            <view class="stack stack--tight spot-entry__address" aria-live="polite">
              <text class="name">{{
                locating
                  ? '正在确认水域…'
                  : locationLabel || '选择钓位水域'
              }}</text>
              <text v-if="exactPoint" class="caption">{{ draft.city }}</text>
              <text v-else-if="editor.editing.value && draft.precision !== 'exact'" class="caption"
                >原记录未开放精确位置，请重新选点后保存。</text
              >
              <text v-else class="caption">定位附近水域，也可以在地图上点选水面。</text>
            </view>
          </view>
          <view class="mobile-action-group">
            <MobileAction class="secondary" :disabled="busy" @click="select">{{
              exactPoint ? '更换水域' : '水域地图选点'
            }}</MobileAction>
            <MobileAction
              class="text-action"
              :disabled="busy || locating"
              @click="locateCurrentPoint"
              >{{ locating ? '正在定位…' : '重新定位' }}</MobileAction
            >
          </view>
          <text v-if="locationError || errors.location" class="error" role="alert">{{
            errors.location || locationError
          }}</text>
          <MobileField
            v-model="draft.name"
            field="spot-name"
            label="钓位名称（选填）"
            :maxlength="60"
            hint="留空时使用所选地点的名称。"
          />
          <MobileField field="water-type" label="水域类型"
            ><MobileSelect
              v-model="draft.water_type"
              field="water-type"
              label="水域类型"
              placeholder="选择水域类型"
              :options="['自然水域', '水库', '钓场', '其他'].map((id) => ({ id, name: id }))"
          /></MobileField>
          <view v-if="editor.editing.value" class="stack stack--tight">
            <text class="name">垂钓状态</text>
            <MobileSegmented
              label="垂钓状态"
              :model-value="draft.fishing_status || 'allowed'"
              :options="[
                { value: 'allowed', label: '可钓' },
                { value: 'prohibited', label: '禁钓' }
              ]"
              :disabled="busy"
              @update:model-value="draft.fishing_status = $event as 'allowed' | 'prohibited'"
            />
            <text v-if="draft.fishing_status === 'prohibited' && draft.audience === 'public' && draft.precision === 'exact'" class="caption">
              保存后会在水域地图的这个位置显示禁钓图钉。
            </text>
          </view>
        </view>
        <view class="panel stack">
          <MobileAction
            class="spot-entry__disclosure"
            :aria-expanded="detailsOpen"
            aria-controls="spot-details"
            @click="detailsOpen = !detailsOpen"
          >
            <view class="stack stack--tight"
              ><text class="name">补充钓位信息（选填）</text
              ><text class="caption">到达说明、鱼情和现场照片</text></view
            >
            <MobileIcon
              name="chevron"
              :size="18"
              :class="['spot-entry__chevron', { 'spot-entry__chevron--open': detailsOpen }]"
            />
          </MobileAction>
          <view v-show="detailsOpen" id="spot-details" class="stack">
            <MobileField
              v-model="draft.access_note"
              field="spot-access"
              label="到达说明"
              :maxlength="500"
              multiline
              placeholder="记录停车入口、步行路线和岸边位置"
            />
            <MobileMultiChoice
              v-model="draft.species"
              field="spot-species"
              label="常见鱼种"
              :maxlength="60"
              :options="fishSpeciesOptions"
              placeholder="选择见过的鱼种（可多选）"
            />
            <MobileField
              v-model="draft.description"
              field="spot-description"
              label="水域与鱼情"
              :maxlength="1000"
              multiline
              placeholder="水情、钓法、环境和安全提醒"
              :hint="sourceHint"
            />
            <view class="stack stack--tight">
              <view class="row row--between row--wrap"
                ><text class="name">现场照片（选填）</text
                ><text class="caption">{{ photos.length }} / 9</text></view
              >
              <MobileMediaUploader
                v-model="photos"
                :scope="`${auth.context}:${draft.id}`"
                :active="pageVisible"
                :accept="['image']"
                :limit="9"
                :upload-image="uploadPhoto"
                :error-text="errorText"
                :recovery="uploadRecovery"
                :disabled="busy || !auth.signedIn || editor.conflict.value"
                upload-label="添加照片"
                @change="syncPhotos"
                @login="uploadLogin"
              />
              <text v-if="errors.media" class="error" role="alert">{{ errors.media }}</text>
            </view>
            <MobileComboField
              v-model="draft.fee_note"
              field="spot-fee"
              label="费用与来源"
              :maxlength="200"
              :options="
                ['未核实', '免费', '收费，出行前向经营方核实'].map((name) => ({ id: name, name }))
              "
              placeholder="选择或补充费用说明"
            />
            <MobileDateTimeField
              v-model:date="draft.observed_on"
              field="spot-date"
              label="信息核实日期"
              :error="errors.observed_on"
              date-only
            />
          </view>
        </view>
        <view class="panel stack">
          <MobileField field="spot-audience" label="谁可以看"
            ><MobileSelect
              v-model="draft.audience"
              field="spot-audience"
              label="钓位分享范围"
              placeholder="选择分享范围"
              :options="audienceOptions(draft.audience)"
          /></MobileField>
          <text class="caption">{{
            draft.audience === 'public'
              ? '公开位置和钓位信息。'
              : draft.audience === 'friends'
                ? '仅好友可见。'
                : '仅自己可见。'
          }}</text>
        </view>
        <text v-if="error && !editor.conflict.value" class="error" role="alert">{{ error }}</text>
        <MobileAction
          class="primary"
          :disabled="
            busy ||
            uploading ||
            locating ||
            prohibited ||
            editor.conflict.value ||
            (editor.editing.value && !editor.dirty.value)
          "
          @click="submit"
          >{{ busy ? '正在保存…' : editor.editing.value ? '保存修改' : '保存钓位' }}</MobileAction
        >
        <SpotDeleteAction v-if="editor.editing.value" :id="draft.id" :owner="auth.userId" />
      </template>
    </view>
    <view v-else class="fishing-content stack"
      ><text class="notice">{{
        owner
          ? '原账号钓位草稿已隐藏。登录原账号后可继续编辑。'
          : '登录后记录钓位，草稿只归属于你的账号。'
      }}</text
      ><MobileAction class="primary" @click="auth.requireLogin()">手机号登录</MobileAction></view
    >
  </FishingShell>
</template>
<style scoped>
.spot-entry__place {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.spot-entry__pin {
  color: var(--lake);
  flex: 0 0 auto;
  margin-top: 3px;
  font-size: 22px;
}
.spot-entry__address {
  min-width: 0;
  overflow-wrap: anywhere;
}
.spot-entry__disclosure {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 48px;
  padding: 0;
  text-align: left;
  background: transparent;
  border: 0;
  color: var(--ink);
}
.spot-entry__disclosure > .stack {
  min-width: 0;
}
.spot-entry__chevron {
  transform: rotate(90deg);
}
.spot-entry__chevron--open {
  transform: rotate(-90deg);
}
.spot-entry__disclosure:focus-visible {
  outline: 2px solid var(--lake);
  outline-offset: 4px;
  border-radius: 6px;
}
</style>
