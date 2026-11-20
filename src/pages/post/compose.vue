<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onLoad, onShow, onHide, onUnload } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import ContentEditState from '@/components/ContentEditState.vue'
import TripCatchesEditor from '@/components/TripCatchesEditor.vue'
import CatchWeightField from '@/components/CatchWeightField.vue'
import { useContentEdit } from '@/composables/useContentEdit'
import { editFields, postEditDraft } from '@/domain/content-edit'
import { compositionLimits, type CompositionPhoto } from '@/domain/composition'
import { ensureTripCatches, validateCatches } from '@/domain/trip-catches'
import { revealControl } from '@mobile-core/form-focus'
import MobileField from '@mobile-core/components/MobileField.vue'
import MobileMultiChoice from '@mobile-core/components/MobileMultiChoice.vue'
import MobileComboField from '@mobile-core/components/MobileComboField.vue'
import MobileDateTimeField from '@mobile-core/components/MobileDateTimeField.vue'
import MobileMediaUploader from '@mobile-core/components/MobileMediaUploader.vue'
import MobilePickerTrigger from '@mobile-core/components/MobilePickerTrigger.vue'
import MobileSelect from '@mobile-core/components/MobileSelect.vue'
import MobileSegmented from '@mobile-core/components/MobileSegmented.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileConfirmDialog from '@mobile-core/components/MobileConfirmDialog.vue'
import {
  audienceOptions,
  audienceLabels,
  freshDraft,
  createId,
  validateDraft,
  errorText
} from '@/domain/rules'
import { useAuthStore } from '@/stores/auth'
import { useMutation } from '@/composables/useMutation'
import { canRetryPhoto, uploadPhoto, resolvePhotos, uploadVideo } from '@/services/media'
import {
  fishSpeciesOptions,
  fishingMethodOptions,
  fishingBaitOptions,
  fishingAdditiveOptions,
  experienceTopicOptions
} from '@/domain/fishing-presets'
import { validSelection } from '@/domain/map'
import { canCapturePostLocation, capturePostLocation } from '@/platforms/post-location'
import { catchNumber } from '@/domain/catch-measurements'
import { write } from '@/services/repository'
import { isDemo } from '@/config'
import { takeTripDraft } from '@/services/draft-handoff'
import { useDraftOwner } from '@/composables/useDraftOwner'
import { sessionScope, assertSession } from '@/services/session'
import type { PostDraft, Post, Trip, Media } from '@/domain/models'
const pageVisible = ref(true)
function uploadRecovery(error: unknown): 'login' | 'retry' | 'remove' {
  if (
    error &&
    typeof error === 'object' &&
    (('status' in error && error.status === 401) ||
      ('code' in error &&
        ['NOT_AUTHENTICATED', 'AUTH_REQUIRED', 'SESSION_EXPIRED'].includes(String(error.code))))
  )
    return 'login'
  return canRetryPhoto(error) ? 'retry' : 'remove'
}
function uploadLogin() {
  uni.navigateTo({ url: '/pages/login/index' })
}
const auth = useAuthStore(),
  mode = ref('post'),
  draft = ref<PostDraft>(freshDraft()),
  errors = ref<Record<string, string>>({}),
  submitted = ref(false),
  detailsOpen = ref(false),
  restored = ref(false),
  transferNotice = ref(''),
  saved = ref(false)
const { busy, error, run } = useMutation()
const photos = ref<CompositionPhoto[]>([])

let locationRequestId = '',
  locationRequestScope = 0
const locationBusy = ref(false),
  locationNotice = ref('')
let locationVersion = 0,
  attemptedLocationDraft = ''
async function startPostLocation() {
  if (
    !canCapturePostLocation ||
    mode.value !== 'post' ||
    editor.editing.value ||
    !available.value ||
    !active ||
    attemptedLocationDraft === draft.value.id ||
    (draft.value.location_label &&
      draft.value.location_longitude != null &&
      draft.value.location_latitude != null)
  )
    return
  attemptedLocationDraft = draft.value.id
  const id = draft.value.id,
    scope = sessionScope.value,
    version = ++locationVersion
  locationBusy.value = true
  locationNotice.value = ''
  try {
    const place = await capturePostLocation()
    if (
      !active ||
      version !== locationVersion ||
      scope !== sessionScope.value ||
      draft.value.id !== id ||
      !available.value ||
      !validSelection(place) ||
      draft.value.location_label
    )
      return
    draft.value.location_label = place.name.slice(0, 80)
    draft.value.location_longitude = Math.round(place.longitude / 0.02) * 0.02
    draft.value.location_latitude = Math.round(place.latitude / 0.02) * 0.02
  } catch {
    if (version === locationVersion) locationNotice.value = '暂时无法定位，可点此选择附近地点。'
  } finally {
    if (version === locationVersion) locationBusy.value = false
  }
}

function selectLocation() {
  if (!available.value || !auth.requireLogin()) return
  locationVersion++
  locationBusy.value = false
  if (locationRequestId) uni.removeStorageSync(`dyj.map.selection.${locationRequestId}`)
  locationRequestId = createId()
  locationRequestScope = sessionScope.value
  if (
    draft.value.location_label &&
    draft.value.location_longitude != null &&
    draft.value.location_latitude != null
  ) {
    uni.setStorageSync(`dyj.map.initial.${locationRequestId}`, {
      name: draft.value.location_label,
      longitude: draft.value.location_longitude,
      latitude: draft.value.location_latitude,
      crs: 'GCJ-02',
      created_at: Date.now()
    })
  }
  uni.navigateTo({
    url: `/pages/map/search?pick=1&context=post&requestId=${encodeURIComponent(locationRequestId)}`
  })
}
function receiveLocation() {
  if (!locationRequestId) return
  const key = `dyj.map.selection.${locationRequestId}`
  try {
    const place = uni.getStorageSync(key)
    if (!place) return
    uni.removeStorageSync(key)
    if (!available.value || locationRequestScope !== sessionScope.value || !validSelection(place))
      return
    draft.value.location_label = place.name.slice(0, 80)
    draft.value.location_longitude = Math.round(place.longitude / 0.02) * 0.02
    draft.value.location_latitude = Math.round(place.latitude / 0.02) * 0.02
    locationNotice.value = ''
    delete errors.value['post-location']
  } finally {
    locationRequestId = ''
  }
}
function checkCount(value: string) {
  try {
    catchNumber(value, 'count')
    delete errors.value.count
  } catch (error) {
    errors.value.count = (error as Error).message
  }
}
const fromAsset = (asset: Media): CompositionPhoto => ({
  key: createId(),
  path: asset.url || '',
  kind: asset.kind || 'image',
  duration: asset.duration,
  asset,
  error: '',
  busy: false
})
const uploading = computed(() => photos.value.some((p) => p.busy || (!p.asset && !p.error)))
watch(
  [mode, draft],
  () => {
    if (mode.value === 'trip') ensureTripCatches(draft.value)
  },
  { flush: 'sync' }
)
let mediaOwner = auth.userId
const { owner, available, resetting } = useDraftOwner(() => {
  const retain =
    mediaOwner === auth.userId && !editor.editing.value && !!uni.getStorageSync(draftKey.value)
  const pending = retain ? photos.value.filter((p) => !p.asset) : []
  for (const photo of photos.value) if (!pending.includes(photo)) photo.release?.()
  mediaOwner = auth.userId
  editor.reset()
  settleDraftChoice(false)
  draft.value = freshDraft()
  photos.value = []
  if (locationRequestId) uni.removeStorageSync(`dyj.map.selection.${locationRequestId}`)
  locationRequestId = ''
  locationVersion++
  attemptedLocationDraft = ''
  locationBusy.value = false
  locationNotice.value = ''
  uni.closePreviewImage({ fail: () => {} })
  restored.value = false
  transferNotice.value = ''
  errors.value = {}
  submitted.value = false
  saved.value = false
  if (editor.editing.value) void loadEdit()
  else restore()
  for (const photo of pending) {
    photo.error = ''
    photo.needsLogin = false
    photo.busy = false
  }
  photos.value.push(...pending)
})
const editor = useContentEdit({
  type: () => (mode.value === 'trip' ? 'trip' : 'post'),
  owner,
  draft,
  hydrate: ({ item }) => {
    draft.value = postEditDraft(item as Post | Trip)
  }
})
async function loadEdit(discard = false) {
  await editor.load(discard)
  if (editor.ready.value) {
    photos.value = draft.value.media.map(fromAsset)
    detailsOpen.value = true
    error.value = ''
  }
}
const draftKey = computed(
  () => `dyj.${isDemo ? 'demo' : 'live'}.draft.${owner.value || 'guest'}.${mode.value}`
)
function restore() {
  if (!owner.value || editor.editing.value) return
  try {
    const value = uni.getStorageSync(draftKey.value)
    if (value?.id) {
      draft.value = value
      restored.value = true
      photos.value = value.media.map(fromAsset)
      void refreshDraftPhotos()
    }
  } catch {
    /* keep empty draft */
  }
}
let active = true
const confirmOpen = ref(false),
  confirmKind = ref<'replace' | 'leave'>('replace')
let resolveDraftChoice: ((value: boolean) => void) | undefined
function settleDraftChoice(value: boolean) {
  confirmOpen.value = false
  const settle = resolveDraftChoice
  resolveDraftChoice = undefined
  settle?.(value)
}
function askDraftChoice(kind: 'replace' | 'leave') {
  if (resolveDraftChoice) return Promise.resolve(false)
  confirmKind.value = kind
  confirmOpen.value = true
  return new Promise<boolean>((resolve) => {
    resolveDraftChoice = resolve
  })
}
onHide(() => {
  pageVisible.value = false
  locationVersion++
  locationBusy.value = false
  settleDraftChoice(false)
})
watch(
  () => auth.context,
  () => {
    settleDraftChoice(false)
    uni.closePreviewImage({ fail: () => {} })
  },
  { flush: 'sync' }
)
onUnload(() => {
  active = false
  locationVersion++
  photos.value.forEach((photo) => photo.release?.())
  settleDraftChoice(false)
})
onLoad(async (options) => {
  mode.value = options?.mode === 'trip' ? 'trip' : 'post'
  if (options?.edit) {
    editor.id.value = options.edit
    await loadEdit()
    return
  }
  restore()
  if (!options?.fromTrip) return
  const owner = auth.userId
  const incoming = takeTripDraft(options.fromTrip, owner, mode.value as 'trip' | 'post')
  if (!incoming) {
    if (!restored.value) transferNotice.value = '这次草稿转入已失效，请从出钓日志重新打开。'
    return
  }
  if (restored.value) {
    const replace = await askDraftChoice('replace')
    if (!replace || !active || owner !== auth.userId) return
  }
  draft.value = incoming.draft
  photos.value = []
  restored.value = false
  detailsOpen.value = true
  transferNotice.value =
    incoming.intent === 'repeat'
      ? '已沿用鱼种、钓法和饵料。日期为今天，请记录本次鱼情。'
      : '已生成独立草稿。请检查正文，分享范围默认公开。照片和位置未带入。'
})
watch(
  draft,
  () => {
    if (!editor.editing.value && !saved.value && available.value && !resetting.value) {
      try {
        uni.setStorageSync(draftKey.value, draft.value)
      } catch {
        error.value = '设备存储不足，草稿暂时无法自动保存'
      }
    }
  },
  { deep: true }
)
onShow(() => {
  pageVisible.value = true
  receiveLocation()
  void startPostLocation()

  /* Account restoration is handled by useDraftOwner; guest keys are never imported. */
})
watch(
  () => [draft.value.id, mode.value, available.value],
  () => {
    void startPostLocation()
  },
  { flush: 'post' }
)

function syncPhotos() {
  draft.value.media = photos.value.flatMap((p) => (p.asset ? [p.asset] : []))
}

async function refreshDraftPhotos() {
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
    /* Stale sessions must not restore private previews. */
  }
}

function formErrors() {
  return mode.value === 'trip'
    ? {
        ...validateDraft({ ...draft.value, weight: '', count: '' }, 'trip'),
        ...validateCatches(draft.value.catches || [])
      }
    : validateDraft(draft.value)
}
watch(
  draft,
  () => {
    // After a failed submit, repaired or removed rows must not leave stale links/errors behind.
    if (submitted.value) errors.value = formErrors()
  },
  { deep: true }
)
async function submit() {
  if (busy.value || uploading.value) return
  if (!available.value) {
    auth.requireLogin()
    return
  }
  if (mode.value === 'trip') ensureTripCatches(draft.value)
  submitted.value = true
  errors.value = formErrors()
  if (Object.keys(errors.value).some((key) => !['title', 'body'].includes(key)))
    detailsOpen.value = true
  if (Object.keys(errors.value).length) {
    void revealControl('compose-errors')
    return
  }
  if (!auth.requireLogin()) return
  await run(async () => {
    if (photos.value.some((p) => p.busy || p.error || !p.asset))
      throw new Error('有图片或视频尚未上传，请重试或移除后保存')
    const result = editor.editing.value
      ? await editor.save()
      : await write<Post>(
          mode.value === 'trip' ? 'save_trip' : 'save_post',
          editFields(mode.value === 'trip' ? 'trip' : 'post', draft.value)
        )
    saved.value = true
    if (!editor.editing.value) uni.removeStorageSync(draftKey.value)
    if (mode.value === 'trip') uni.redirectTo({ url: '/pages/mine/library?type=trips' })
    else uni.redirectTo({ url: `/pages/post/detail?id=${result.id}` })
  })
}
async function confirmBack() {
  if (!available.value) return true
  if (busy.value || uploading.value) return false
  if (
    !draft.value.title &&
    !draft.value.body &&
    !draft.value.count &&
    !draft.value.length &&
    !draft.value.weight &&
    !draft.value.species &&
    !draft.value.media.length &&
    !draft.value.catches?.some((row) => row.species || row.count || row.weight)
  )
    return true
  return askDraftChoice('leave')
}
</script>
<template>
  <FishingShell
    :title="
      editor.editing.value
        ? mode === 'trip'
          ? '编辑出钓日志'
          : '编辑鱼情'
        : mode === 'trip'
          ? '记一次出钓'
          : '记录鱼情'
    "
    back
    :confirm-back="confirmBack"
  >
    <view v-if="available" :key="draft.id" class="fishing-content stack compose-content">
      <ContentEditState
        v-if="editor.editing.value"
        :direct-publication="mode === 'post'"
        :loading="editor.loading.value"
        :ready="editor.ready.value"
        :error="editor.error.value"
        :conflict="editor.conflict.value"
        :restored="editor.restored.value"
        :publication="editor.publication.value"
        :update="editor.contentUpdate.value"
        :audience="draft.audience"
        @reload="loadEdit"
      />
      <template v-if="!editor.editing.value || editor.ready.value">
        <view
          v-if="submitted && Object.keys(errors).length"
          id="compose-errors"
          class="notice stack stack--tight"
          tabindex="-1"
          role="alert"
        >
          <text class="name"
            >有 {{ Object.keys(errors).length }} 处需要检查，填写的内容已保留。</text
          >
          <MobileAction
            v-for="(message, field) in errors"
            :key="field"
            class="text-action"
            @click="revealControl(field === 'catches' ? 'catch-details' : String(field))"
            >{{ message }}</MobileAction
          >
        </view>
        <text v-if="restored" class="notice">已恢复这台设备上的草稿。</text>
        <text v-if="transferNotice" class="notice" role="status">{{ transferNotice }}</text>
        <MobileSegmented
          v-if="mode === 'post'"
          v-model="draft.kind"
          label="记录类型"
          :options="[
            { value: 'catch', label: '晒渔获' },
            { value: 'experience', label: '分享心得' }
          ]"
        />
        <view class="panel stack compose-story">
          <MobileField
            v-model="draft.title"
            field="title"
            label="标题"
            :placeholder="mode === 'trip' ? '本次出钓标题' : '选填'"
            :maxlength="compositionLimits.title"
            :error="errors.title"
            :required="mode === 'trip'"
          />
          <MobileField
            v-model="draft.body"
            field="body"
            :label="
              mode === 'trip'
                ? '出钓记录'
                : draft.kind === 'experience'
                  ? '分享你的心得'
                  : '今天的渔获'
            "
            multiline
            :maxlength="compositionLimits.body"
            show-count
            :placeholder="
              draft.kind === 'experience' && mode === 'post'
                ? '分享钓法、选位、用饵或装备经验…'
                : '写写今天的鱼情、作钓过程…'
            "
            :error="errors.body"
            :hint="
              mode === 'trip'
                ? '可留空，先记下日期和标题也可以。'
                : '文字、图片或视频，至少提供一项。'
            "
          />
          <view id="media" class="compose-media" tabindex="-1">
            <view class="row row--between"
              ><text class="name">图片 / 视频</text
              ><text class="caption">{{ photos.length }} / 9</text></view
            >
            <MobileMediaUploader
              v-model="photos"
              :scope="auth.context"
              :active="pageVisible"
              :accept="['image', 'video']"
              :limit="9"
              :max-image-bytes="8 * 1024 * 1024"
              :max-video-bytes="20 * 1024 * 1024"
              :upload-image="uploadPhoto"
              :upload-video="uploadVideo"
              :error-text="errorText"
              :recovery="uploadRecovery"
              :disabled="busy || !auth.signedIn"
              upload-label="添加图片 / 视频"
              @change="syncPhotos"
              @login="uploadLogin"
            />
            <text v-if="errors.media" class="error" role="alert">{{ errors.media }}</text>
            <text class="caption">{{
              isDemo
                ? '体验图片仅存本机。视频请在正式环境上传。'
                : '照片和视频可混合添加，最多 9 项。'
            }}</text>
          </view>
          <MobileComboField
            v-if="mode === 'post' && draft.kind === 'experience'"
            v-model="draft.topic"
            field="topic"
            label="心得主题（选填）"
            placeholder="选择主题，也可直接输入"
            :options="experienceTopicOptions"
            :maxlength="40"
            :error="errors.topic"
          />
        </view>
        <view v-if="mode === 'trip' || draft.kind === 'catch'" class="panel stack">
          <MobileAction
            class="row row--between details-toggle"
            :aria-label="mode === 'trip' ? '渔获与钓法' : '鱼情详情'"
            :aria-expanded="detailsOpen"
            aria-controls="catch-details"
            @click="detailsOpen = !detailsOpen"
          >
            <text class="name">{{
              mode === 'trip' ? '渔获与钓法（选填）' : '鱼情详情（选填）'
            }}</text
            ><text class="caption">{{ detailsOpen ? '收起' : '展开' }}</text>
          </MobileAction>
          <view v-if="detailsOpen" id="catch-details" class="stack" tabindex="-1">
            <TripCatchesEditor
              v-if="mode === 'trip'"
              v-model="draft.catches"
              :errors="errors"
              :disabled="busy"
            />
            <view class="field-grid">
              <MobileMultiChoice
                v-if="mode === 'post'"
                v-model="draft.species"
                field="species"
                label="鱼种"
                :options="fishSpeciesOptions"
                :maxlength="60"
              />
              <MobileMultiChoice
                v-model="draft.method"
                field="method"
                label="钓法"
                :options="fishingMethodOptions"
                :max-selected="6"
                :maxlength="40"
              />
              <MobileMultiChoice
                v-model="draft.bait"
                field="bait"
                label="饵料"
                :options="fishingBaitOptions"
                :maxlength="60"
              />
              <MobileMultiChoice
                v-model="draft.additives"
                field="additives"
                label="小药"
                :options="fishingAdditiveOptions"
                :maxlength="60"
                :max-selected="6"
              />
              <MobileField
                v-if="mode === 'post'"
                v-model="draft.count"
                field="count"
                label="尾数"
                inputmode="numeric"
                placeholder="未知留空，空军填 0"
                :maxlength="8"
                :error="errors.count"
                @update:model-value="checkCount"
              />
              <MobileField
                v-if="mode === 'post'"
                v-model="draft.length"
                field="length"
                label="鱼长（cm）"
                inputmode="decimal"
                placeholder="多尾可填最长的一尾"
                :maxlength="24"
                :error="errors.length"
              />
              <CatchWeightField
                v-if="mode === 'post'"
                v-model="draft.weight"
                v-model:unit="draft.weight_unit"
                class="compose-weight"
                field="weight"
                label="总重量"
                :disabled="busy"
                :error="errors.weight"
              />
              <MobileDateTimeField
                v-model:date="draft.occurred_on"
                v-model:time="draft.occurred_time"
                field="occurred_on"
                label="出钓时间"
                :error="errors.occurred_on"
              />
            </view>
          </view>
        </view>
        <view class="panel stack">
          <template v-if="mode === 'post'"
            ><MobileField field="audience" label="谁可以看"
              ><MobileSelect
                v-model="draft.audience"
                field="audience"
                label="分享范围"
                placeholder="选择分享范围"
                :options="audienceOptions" /></MobileField
            ><MobileField
              field="post-location"
              label="所在位置"
              required
              :error="errors['post-location']"
              :hint="locationNotice || '地点会随动态展示，点击可更换附近水域或城市。'"
            >
              <MobilePickerTrigger
                id="post-location"
                label="选择所在位置"
                :value="draft.location_label"
                :expanded="false"
                :placeholder="locationBusy ? '正在获取当前位置…' : '选择城市、水域或附近地点'"
                :disabled="busy"
                @click="selectLocation"
              /> </MobileField
          ></template>
          <view class="compose-privacy"
            ><MobileIcon name="shield" :size="18" /><text>{{
              mode === 'trip'
                ? '这份日志仅自己可见。之后分享时，会另建一份草稿，不会自动带出私人钓位。'
                : `发布范围：${audienceLabels[draft.audience]}。展示所选地点的大致位置。${isDemo ? '体验内容仅存本机。' : ''}`
            }}</text></view
          >
        </view>
        <text v-if="error && !editor.conflict.value" class="error" role="alert">{{ error }}</text>
        <MobileAction
          class="primary compose-submit"
          :disabled="busy || uploading || editor.conflict.value"
          @click="submit"
          >{{
            busy
              ? '正在保存…'
              : editor.editing.value
                ? mode !== 'trip' && draft.audience !== 'private'
                  ? '保存并重新发布'
                  : '保存修改'
                : mode === 'trip'
                  ? '保存私人日志'
                  : '保存并发布'
          }}</MobileAction
        >
        <text class="caption" style="text-align: center">草稿自动保存到本机</text>
      </template>
    </view>
    <view v-else class="fishing-content stack">
      <text class="notice">{{
        owner
          ? '原账号草稿已隐藏。登录原账号后可继续编辑。'
          : '登录后记录鱼情，草稿只归属于你的账号。'
      }}</text>
      <MobileAction class="primary" @click="auth.requireLogin()">手机号登录</MobileAction>
    </view>
    <MobileConfirmDialog
      v-model="confirmOpen"
      :title="confirmKind === 'replace' ? '已有未完成的草稿' : '草稿已保留'"
      :message="
        confirmKind === 'replace'
          ? '替换会清空当前草稿中的文字与附件，已保存的日志不受影响。'
          : editor.editing.value
            ? '退出后可以从原记录的编辑入口继续。'
            : '退出后可以从记录入口继续编辑。'
      "
      :confirm-text="confirmKind === 'replace' ? '替换草稿' : '保留并退出'"
      :cancel-text="confirmKind === 'replace' ? '继续旧草稿' : '继续编辑'"
      :destructive="confirmKind === 'replace'"
      @confirm="settleDraftChoice(true)"
      @cancel="settleDraftChoice(false)"
    />
  </FishingShell>
</template>
<style scoped>
.compose-media {
  display: grid;
  gap: 12px;
  min-width: 0;
}
.compose-weight {
  grid-column: 1 / -1;
}
.details-toggle.mobile-action {
  min-height: 48px;
  text-align: left;
}
.details-toggle .caption {
  flex-shrink: 0;
  white-space: nowrap;
}
.compose-content {
  gap: 24px;
}
.compose-story {
  gap: 24px;
}
.compose-story :deep(.mobile-field__control--textarea) {
  min-height: 180px;
}
.compose-media .caption {
  font-size: 0.875rem;
  line-height: 1.5;
}
.compose-media :deep(.mobile-evidence__add) {
  min-height: 48px;
  font-size: 1rem;
  border-style: solid;
}
.compose-privacy {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  color: var(--reed);
  font-size: 0.875rem;
  line-height: 1.55;
}
.compose-privacy :deep(.mobile-icon) {
  flex: none;
  height: 1.55em;
}
.compose-submit.mobile-action {
  min-height: max(52px, 3.25rem);
}
</style>
