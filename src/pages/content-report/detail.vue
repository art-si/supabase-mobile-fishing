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
import { useAuthStore } from '@/stores/auth'
import { contentReports } from '@/services/content-reports'
import { ApiError } from '@/services/http'
import { createId, errorText, relativeTime } from '@/domain/rules'
import {
  reportStatusLabels,
  reportTypeLabels,
  reportDecisionLabels,
  reportDecisions,
  type ContentReport,
  type ContentReportDecision,
  type ContentReportReview
} from '@/domain/content-reports'
const auth = useAuthStore(),
  id = ref(''),
  item = ref<ContentReportReview | null>(null),
  loading = ref(false),
  error = ref(''),
  notice = ref('')
const sheet = ref(false),
  decision = ref<ContentReportDecision>('hide'),
  reason = ref(''),
  fieldError = ref(''),
  focus = ref(false),
  saveError = ref(''),
  busy = ref(false),
  stale = ref(false),
  photosReady = ref(false)
const choices = computed(() => (item.value ? reportDecisions(item.value) : []))
let version = 0,
  visible = false,
  requestId = '',
  attempted = ''
function clear() {
  version++
  item.value = null
  photosReady.value = false
  loading.value = false
  busy.value = false
  sheet.value = false
  reason.value = ''
  error.value = ''
  notice.value = ''
  saveError.value = ''
  fieldError.value = ''
  stale.value = false
}
async function load() {
  if (!visible || !id.value || busy.value) return
  const current = ++version
  item.value = null
  photosReady.value = false
  loading.value = true
  error.value = ''
  stale.value = false
  try {
    const result = await contentReports<ContentReportReview>('item', { id: id.value })
    if (current === version) item.value = result
  } catch (e) {
    if (current === version) error.value = errorText(e)
  } finally {
    if (current === version) loading.value = false
  }
}
function prepare(value: ContentReportDecision) {
  decision.value = value
  reason.value = ''
  fieldError.value = ''
  saveError.value = ''
  focus.value = false
  requestId = createId()
  attempted = ''
  sheet.value = true
}
async function submit() {
  if (!item.value || busy.value || stale.value || !choices.value.includes(decision.value)) return
  if (decision.value === 'dismiss' && item.value.content?.media.length && !photosReady.value) return
  if (!reason.value.trim()) {
    fieldError.value = '请填写处理说明，举报人会看到这段内容'
    focus.value = false
    await nextTick()
    focus.value = true
    return
  }
  const current = version,
    previous = item.value
  const signature = JSON.stringify([
    previous.report.id,
    previous.report.revision,
    previous.content_revision,
    decision.value,
    reason.value.trim()
  ])
  if (attempted && attempted !== signature) requestId = createId()
  attempted = signature
  busy.value = true
  fieldError.value = ''
  saveError.value = ''
  try {
    const result = await contentReports<ContentReport>('decide', {
      id: previous.report.id,
      revision: previous.report.revision,
      content_revision: previous.content_revision,
      decision: decision.value,
      reason: reason.value.trim(),
      request_id: requestId
    })
    if (current !== version) return
    const content = previous.content && {
      ...previous.content,
      status: decision.value === 'hide' ? ('hidden' as const) : previous.content.status,
      revision: previous.content.revision + (decision.value === 'hide' ? 1 : 0)
    }
    item.value = { ...previous, report: result, content, can_hide: false }
    sheet.value = false
    notice.value = '处理结果已保存，举报人可以查看说明。'
  } catch (e) {
    if (current !== version) return
    saveError.value = errorText(e)
    if (e instanceof ApiError && ['REVIEW_CONFLICT', 'INVALID_TRANSITION'].includes(e.code))
      stale.value = true
    if (
      e instanceof ApiError &&
      ['FORBIDDEN', 'NOT_AUTHENTICATED', 'NOT_FOUND', 'SELF_REPORT_REVIEW'].includes(e.code)
    ) {
      item.value = null
      sheet.value = false
      error.value = saveError.value
    }
  } finally {
    if (current === version) busy.value = false
  }
}
function reread() {
  sheet.value = false
  void load()
}
watch(
  () => auth.context,
  () => {
    clear()
    void load()
  },
  { flush: 'sync' }
)
onLoad((options) => {
  id.value = options?.id?.trim() || ''
})
onShow(() => {
  visible = true
  void load()
})
onHide(() => {
  visible = false
  clear()
})
onUnload(() => {
  visible = false
  clear()
})
</script>
<template>
  <FishingShell title="处理举报" back>
    <view class="fishing-content stack">
      <FishingEmptyState
        v-if="!id"
        icon="flag"
        title="缺少举报编号"
        description="请从举报列表打开要处理的记录。"
      >
        <MobileAction
          class="secondary"
          @click="uni.redirectTo({ url: '/pages/content-report/index?review=1' })"
          >返回举报列表</MobileAction
        >
      </FishingEmptyState>
      <MobileSkeleton v-else-if="loading" label="正在读取举报与最新内容…" />
      <MobileLoadError v-if="error" title="无法读取举报" :message="error" @retry="load()" />
      <template v-if="item">
        <text v-if="notice" class="notice" role="status">{{ notice }}</text>
        <view class="panel stack">
          <view class="row row--between row--wrap"
            ><text class="badge">{{ reportStatusLabels[item.report.status] }}</text
            ><text class="caption">{{ relativeTime(item.report.created_at) }}</text></view
          >
          <text class="heading">{{ item.report.title || reportTypeLabels[item.report.type] }}</text>
          <text class="caption">举报说明</text
          ><text class="body report-text">{{ item.report.reason }}</text>
          <template v-if="item.report.resolution"
            ><text class="caption">处理说明</text
            ><text class="body report-text">{{ item.report.resolution }}</text></template
          >
        </view>
        <text v-if="item.changed && item.report.status === 'pending'" class="notice"
          >内容在举报后有过更新，请以当前版本重新核查。</text
        >
        <view v-if="item.content" class="panel stack">
          <text class="caption">当前内容 · {{ reportTypeLabels[item.report.type] }}</text>
          <text class="name">{{ item.content.author.nickname }}</text>
          <text class="body report-text">{{ item.content.body }}</text>
          <FishingPhotos
            v-if="item.content.media.length"
            :key="`${item.report.id}-${item.content_revision}`"
            :media="item.content.media"
            label="被举报内容照片"
            full
            @ready="photosReady = $event"
          />
          <view v-for="(value, label) in item.content.details" :key="label"
            ><text v-if="value" class="caption">{{ label }}：{{ value }}</text></view
          >
        </view>
        <text v-else-if="item.report.status === 'pending'" class="notice"
          >内容已删除或改为私密，不再读取原文。结案不会恢复内容。</text
        >
        <text v-if="item.needs_other_reviewer && item.report.status === 'pending'" class="notice"
          >自己提交的举报或涉及自己的内容，请由另一位审核员处理。</text
        >
        <view v-if="choices.length" class="stack stack--tight">
          <text v-if="item.content?.media.length && !photosReady" class="caption" role="status"
            >照片尚未全部读取，查看后才能决定不处理内容。</text
          >
          <MobileAction
            v-for="choice in choices"
            :key="choice"
            class="secondary"
            :disabled="
              busy || (choice === 'dismiss' && Boolean(item.content?.media.length) && !photosReady)
            "
            @click="prepare(choice)"
            >{{ reportDecisionLabels[choice] }}</MobileAction
          >
        </view>
        <MobileAction
          v-if="item.report.status !== 'pending' && item.content && item.report.type !== 'profile'"
          class="secondary"
          @click="
            uni.navigateTo({
              url: `/pages/moderation/detail?type=${item.report.type}&id=${item.content.id}`
            })
          "
          >查看内容审核状态</MobileAction
        >
        <text class="caption">不展示举报人身份；隐藏不会永久删除内容。</text>
        <text v-if="item.report.status !== 'pending'" class="caption"
          >处理结果记录当时的决定，当前内容可能已被修正或重新审核。</text
        >
        <text v-if="item.report.type === 'profile'" class="caption"
          >个人资料举报暂不提供账号封禁操作。</text
        >
      </template>
    </view>
    <MobileBottomSheet
      v-if="item"
      v-model="sheet"
      :title="reportDecisionLabels[decision]"
      close-label="取消处理举报"
      :busy="busy"
    >
      <view class="stack fishing-sheet-content">
        <text class="body">{{
          decision === 'hide'
            ? '隐藏后其他钓友不能继续访问。说明会同时提供给作者和举报人，请勿包含举报人信息。'
            : decision === 'dismiss'
              ? '内容保持现状。请说明未采取措施的原因，举报人可查看结果。'
              : '仅结束这条举报，不恢复或删除原内容。'
        }}</text>
        <MobileField
          v-model="reason"
          field="report-resolution"
          label="处理说明"
          multiline
          :maxlength="500"
          :error="fieldError"
          :focus="focus"
          required
          show-count
        />
        <text v-if="saveError" class="error" role="alert">{{ saveError }}</text>
        <MobileAction v-if="stale" class="primary" @click="reread">重新读取内容</MobileAction>
        <MobileAction v-else class="primary" :disabled="busy" @click="submit">{{
          busy ? '正在保存…' : `确认${reportDecisionLabels[decision]}`
        }}</MobileAction>
      </view>
    </MobileBottomSheet>
  </FishingShell>
</template>
<style scoped>
.report-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
