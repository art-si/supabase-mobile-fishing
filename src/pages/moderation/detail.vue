<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { onLoad, onShow, onHide, onUnload } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import FishingPhotos from '@/components/FishingPhotos.vue'
import FishingEmptyState from '@/components/FishingEmptyState.vue'
import MobileSkeleton from '@mobile-core/components/MobileSkeleton.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileBottomSheet from '@mobile-core/components/MobileBottomSheet.vue'
import MobileField from '@mobile-core/components/MobileField.vue'
import MobileSegmented from '@mobile-core/components/MobileSegmented.vue'
import { useAuthStore } from '@/stores/auth'
import { moderation } from '@/services/moderation'
import { createId, errorText, audienceLabels } from '@/domain/rules'
import {
  decisionLabels,
  reviewLabels,
  type ReviewDecision,
  type ReviewItem,
  type ReviewType
} from '@/domain/moderation'
import { ApiError } from '@/services/http'
import { reportTypeLabels } from '@/domain/content-reports'
const auth = useAuthStore(),
  id = ref(''),
  type = ref<ReviewType>(),
  isUpdate = ref(false),
  comparison = ref<'proposal' | 'current'>('proposal'),
  resolved = ref(false),
  photoGeneration = ref(0),
  item = ref<ReviewItem | null>(null),
  loading = ref(false),
  error = ref(''),
  notice = ref('')
const sheet = ref(false),
  decision = ref<ReviewDecision>('published'),
  reason = ref(''),
  fieldError = ref(''),
  reasonFocus = ref(false),
  saveError = ref(''),
  busy = ref(false),
  stale = ref(false),
  photosReady = ref(false)
let version = 0,
  requestId = '',
  attempted = ''
const self = computed(() => item.value?.author.id === auth.userId)
const comparing = computed(() => isUpdate.value && comparison.value === 'current')
const displayed = computed(() => (comparing.value ? item.value?.current : item.value))
const missing = computed(() => !id.value || !type.value)
const details = computed(() =>
  Object.entries(displayed.value?.details || {}).filter(([, value]) => Boolean(value))
)
const comparisonOptions = [
  { value: 'proposal', label: '本次修改' },
  { value: 'current', label: '当前版本' }
] as const
const photoKey = computed(
  () => `${item.value?.id}-${item.value?.revision}-${photoGeneration.value}`
)
const onPhotosReady = computed(() => {
  const key = photoKey.value
  return (value: boolean) => {
    if (key === photoKey.value && !comparing.value) photosReady.value = value
  }
})
watch(
  comparison,
  () => {
    photoGeneration.value++
    photosReady.value = false
  },
  { flush: 'sync' }
)
watch(reason, (value) => {
  if (value.trim()) fieldError.value = ''
})
const choices = computed<ReviewDecision[]>(() =>
  isUpdate.value && resolved.value
    ? []
    : item.value?.status === 'pending'
      ? ['published', 'rejected']
      : item.value?.status === 'published'
        ? ['hidden']
        : ['published']
)
const mayApprove = computed(() => !item.value?.media.length || photosReady.value)
function actionLabel(value: ReviewDecision) {
  if (isUpdate.value) return value === 'published' ? '通过修改' : '退回修改'
  if (item.value?.type === 'comment')
    return value === 'published'
      ? '恢复评论'
      : value === 'hidden'
        ? '隐藏评论'
        : decisionLabels[value]
  return decisionLabels[value]
}
function invalidate() {
  version++
  item.value = null
  loading.value = false
  sheet.value = false
  error.value = ''
  saveError.value = ''
  busy.value = false
  notice.value = ''
  resolved.value = false
  comparison.value = 'proposal'
  photosReady.value = false
  photoGeneration.value++
}
async function load() {
  if (missing.value || busy.value) return
  const current = ++version
  item.value = null
  photosReady.value = false
  loading.value = true
  error.value = ''
  stale.value = false
  notice.value = ''
  resolved.value = false
  comparison.value = 'proposal'
  photoGeneration.value++
  try {
    const data = await moderation<ReviewItem>(isUpdate.value ? 'proposal_item' : 'item', {
      id: id.value,
      type: type.value
    })
    if (current === version) item.value = data
  } catch (e) {
    if (current === version) error.value = errorText(e)
  } finally {
    if (current === version) loading.value = false
  }
}
function prepare(value: ReviewDecision) {
  if (
    busy.value ||
    !item.value ||
    stale.value ||
    self.value ||
    comparing.value ||
    (isUpdate.value && resolved.value) ||
    !choices.value.includes(value)
  )
    return
  if (value === 'published' && !mayApprove.value) return
  reasonFocus.value = false
  decision.value = value
  reason.value = value === 'published' && item.value?.type !== 'comment' ? '审核通过' : ''
  fieldError.value = ''
  saveError.value = ''
  requestId = createId()
  attempted = ''
  sheet.value = true
}
async function submit() {
  if (
    busy.value ||
    !item.value ||
    stale.value ||
    self.value ||
    comparing.value ||
    (isUpdate.value && resolved.value) ||
    !choices.value.includes(decision.value)
  )
    return
  if (!reason.value.trim()) {
    fieldError.value = '请说明原因，作者会看到这段说明'
    reasonFocus.value = false
    await nextTick()
    reasonFocus.value = true
    return
  }
  if (decision.value === 'published' && !mayApprove.value) return
  const current = version,
    reviewed = item.value
  const signature = JSON.stringify([
    isUpdate.value,
    reviewed.type,
    reviewed.id,
    reviewed.revision,
    decision.value,
    reason.value.trim()
  ])
  if (attempted && attempted !== signature) requestId = createId()
  attempted = signature
  busy.value = true
  saveError.value = ''
  fieldError.value = ''
  try {
    const result = await moderation<{ status: ReviewItem['status']; revision: number }>(
      isUpdate.value ? 'proposal_decide' : 'decide',
      {
        id: reviewed.id,
        type: reviewed.type,
        revision: reviewed.revision,
        decision: decision.value,
        reason: reason.value.trim(),
        request_id: requestId
      }
    )
    if (current !== version) return
    item.value = { ...reviewed, ...result }
    resolved.value = isUpdate.value
    sheet.value = false
    notice.value = `已${actionLabel(decision.value)}，结果已记录。`
  } catch (e) {
    if (current !== version) return
    saveError.value = errorText(e)
    if (e instanceof ApiError && ['REVIEW_CONFLICT', 'INVALID_TRANSITION'].includes(e.code))
      stale.value = true
    if (e instanceof ApiError && ['FORBIDDEN', 'NOT_AUTHENTICATED', 'NOT_FOUND'].includes(e.code)) {
      item.value = null
      sheet.value = false
      error.value = saveError.value
    }
  } finally {
    if (current === version) busy.value = false
  }
}
async function reread() {
  sheet.value = false
  await load()
}
onLoad((options) => {
  id.value = options?.id?.trim() || ''
  const candidate = options?.type
  if (candidate === 'post' || candidate === 'spot' || candidate === 'comment') type.value = candidate
  isUpdate.value = options?.update === '1'
})
onShow(() => {
  void load()
})
onHide(invalidate)
onUnload(invalidate)
watch(
  () => auth.context,
  () => {
    invalidate()
    void load()
  }
)
</script>
<template>
  <FishingShell :title="isUpdate ? '审核修改' : '审核内容'" back>
    <view class="fishing-content stack">
      <FishingEmptyState
        v-if="missing"
        icon="shield"
        title="缺少审核记录"
        description="请从内容审核列表打开要处理的记录。"
      >
        <MobileAction
          class="secondary"
          @click="uni.redirectTo({ url: '/pages/moderation/index' })"
          >返回内容审核</MobileAction
        >
      </FishingEmptyState>
      <MobileSkeleton v-else-if="loading" label="正在读取内容与照片…" />
      <MobileLoadError v-if="error" title="无法读取审核内容" :message="error" @retry="load" />
      <template v-if="item && displayed">
        <text v-if="notice" class="notice" role="status">{{ notice }}</text>
        <template v-if="isUpdate && item.current && !resolved">
          <MobileSegmented
            v-model="comparison"
            label="审核版本对照"
            :options="comparisonOptions"
            :disabled="busy || sheet"
          />
          <text class="caption" role="status">{{
            comparing
              ? '这是其他钓友当前看到的版本。切回「本次修改」后处理审核。'
              : '通过后替换当前版本；退回修改不会下架当前版本。'
          }}</text>
        </template>
        <view class="panel stack">
          <view class="row row--between row--wrap"
            ><text class="badge">{{ reportTypeLabels[item.type] }}</text
            ><text class="caption">{{
              comparing
                ? '当前展示版本'
                : item.type === 'comment' && item.status === 'published'
                  ? '正常展示'
                  : reviewLabels[item.status]
            }}</text></view
          >
          <text class="heading">{{ displayed.title }}</text
          ><text class="caption"
            >{{ displayed.author.nickname }} · {{ audienceLabels[displayed.audience] }}</text
          >
          <text class="body review-body">{{ displayed.body }}</text>
          <FishingPhotos
            v-if="displayed.media.length"
            :key="photoKey"
            :media="displayed.media"
            :label="comparing ? '当前版本照片' : '待审内容照片'"
            full
            @ready="onPhotosReady"
          />
          <view v-for="[label, value] in details" :key="label"
            ><text class="caption">{{ label }}：{{ value }}</text></view
          >
        </view>
        <text v-if="self" class="notice">不能审核自己的内容，请由另一位审核员处理。</text>
        <template v-else>
          <text v-if="!comparing && !resolved && !mayApprove" class="caption" role="status"
            >照片尚未全部读取，请查看或重新读取后再通过审核。</text
          >
          <view class="stack stack--tight">
            <MobileAction
              v-for="choice in choices"
              :key="choice"
              :class="choice === 'published' ? 'primary' : 'secondary'"
              :disabled="busy || stale || comparing || (choice === 'published' && !mayApprove)"
              @click="prepare(choice)"
              >{{ actionLabel(choice) }}</MobileAction
            >
          </view>
          <MobileAction
            v-if="resolved"
            class="secondary"
            @click="uni.redirectTo({ url: '/pages/moderation/index' })"
            >返回审核列表</MobileAction
          >
        </template>
        <text class="caption">{{
          isUpdate
            ? '审核仅处理本次修改，不改变未修改版本的处理记录。'
            : item.type === 'comment'
              ? '恢复后仍遵循原动态的分享范围；不会恢复已删除的评论或动态。'
              : '通过后仅按作者选择的范围展示；审核不会扩大分享范围。'
        }}</text>
      </template>
    </view>
    <MobileBottomSheet
      v-model="sheet"
      :title="actionLabel(decision)"
      close-label="取消审核操作"
      :busy="busy"
    >
      <view class="stack fishing-sheet-content">
        <text class="body">{{
          isUpdate
            ? decision === 'published'
              ? '确认本次修改与照片符合规范后，替换当前版本，按作者申请的分享范围展示。'
              : '填写退回原因。当前版本继续展示，作者可以重新修改。'
            : decision === 'published'
              ? item?.type === 'comment'
                ? '复核评论后填写恢复原因，评论仅在原动态可见时展示。'
                : '确认内容与照片符合社区规范后，按作者选择的范围展示。'
              : '说明具体原因，帮助作者理解处理结果。内容不会被永久删除。'
        }}</text>
        <MobileField
          v-model="reason"
          field="review-reason"
          label="处理说明"
          multiline
          :maxlength="500"
          :error="fieldError"
          :focus="reasonFocus"
          required
          show-count
        />
        <text v-if="saveError" class="error" role="alert">{{ saveError }}</text>
        <MobileAction v-if="stale" class="primary" @click="reread">重新读取内容</MobileAction>
        <MobileAction v-else class="primary" :disabled="busy" @click="submit">{{
          busy ? '正在提交…' : `确认${actionLabel(decision)}`
        }}</MobileAction>
      </view>
    </MobileBottomSheet>
  </FishingShell>
</template>
<style scoped>
.review-body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
