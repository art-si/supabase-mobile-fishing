<script setup lang="ts">
import { ref, watch } from 'vue'
import { onLoad, onShow, onHide, onUnload, onReachBottom } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import MobileSkeleton from '@mobile-core/components/MobileSkeleton.vue'
import FishingEmptyState from '@/components/FishingEmptyState.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileListFooter from '@mobile-core/components/MobileListFooter.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'

import { useAuthStore } from '@/stores/auth'
import { useListRefresh } from '@/composables/useListRefresh'
import { isTransientRequestError } from '@/services/http'
import { contentReports } from '@/services/content-reports'
import { errorText, relativeTime } from '@/domain/rules'
import {
  reportStatusLabels,
  reportTypeLabels,
  type ContentReport,
  type ContentReportPage,
  type ContentReportCursor
} from '@/domain/content-reports'
const auth = useAuthStore(),
  review = ref(false),
  section = ref<'pending' | 'closed'>('pending')
const items = ref<ContentReport[]>([]),
  next = ref<ContentReportCursor | null>(null),
  loading = ref(false),
  loadingMore = ref(false),
  error = ref(''),
  moreError = ref('')
let version = 0,
  visible = false
function clear() {
  version++
  items.value = []
  next.value = null
  loading.value = false
  loadingMore.value = false
  error.value = ''
  moreError.value = ''
}
onReachBottom(() => {
  if (!error.value && !moreError.value) void load(true)
})
useListRefresh(async () => {
  version++; loading.value = loadingMore.value = false
  await load()
}, () => auth.signedIn)
async function load(more = false) {
  if (!visible || !auth.signedIn || loading.value || (more && !next.value)) return
  const current = ++version
  loading.value = true
  loadingMore.value = more
  error.value = ''
  moreError.value = ''
  try {
    const result = await contentReports<ContentReportPage>(review.value ? 'queue' : 'mine', {
      section: section.value,
      cursor: more ? next.value : null
    })
    if (current !== version) return
    const merged = more ? [...items.value, ...result.items] : result.items
    items.value = merged.filter(
      (r, index) => merged.findIndex((other) => other.id === r.id) === index
    )
    next.value = result.next
  } catch (e) {
    if (current !== version) return
    if (more && isTransientRequestError(e)) {
      moreError.value = errorText(e)
      return
    }
    items.value = []
    next.value = null
    error.value = errorText(e)
  } finally {
    if (current === version) {
      loading.value = false
      loadingMore.value = false
    }
  }
}
function change(value: 'pending' | 'closed') {
  section.value = value
  clear()
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
  review.value = options?.review === '1'
})
onShow(() => {
  visible = true
  clear()
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
  <FishingShell title="社区举报" back>
    <view class="fishing-content stack">
      <template v-if="!auth.signedIn">
        <FishingEmptyState
          icon="shield"
          :title="review ? '仅审核员可访问' : '登录后查看举报进度'"
          description="举报记录不会向其他钓友公开。"
        />
        <MobileAction class="primary" @click="auth.requireLogin()">登录</MobileAction>
      </template>
      <template v-else>
        <view class="section-head row--wrap">
          <view v-if="review" class="row row--wrap" role="group" aria-label="举报处理状态">
            <MobileAction
              :class="section === 'pending' ? 'secondary' : 'text-action'"
              :aria-pressed="section === 'pending'"
              @click="change('pending')"
              >待处理</MobileAction
            >
            <MobileAction
              :class="section === 'closed' ? 'secondary' : 'text-action'"
              :aria-pressed="section === 'closed'"
              @click="change('closed')"
              >已处理</MobileAction
            >
          </view>
          <text v-else class="caption">社区内容与钓位纠错</text>
          <MobileAction class="text-action" :disabled="loading" @click="load()"
            >刷新列表</MobileAction
          >
        </view>
        <MobileLoadError v-if="error" title="无法读取举报记录" :message="error" @retry="load()" />
        <template v-if="review">
          <view v-if="items.length" class="panel">
            <MobileAction
              v-for="item in items"
              :key="item.id"
              class="list-row report-queue__row"
              :aria-label="`处理举报：${item.title || reportTypeLabels[item.type]}`"
              @click="uni.navigateTo({ url: `/pages/content-report/detail?id=${item.id}` })"
            >
              <view class="stack stack--tight grow">
                <text class="caption"
                  >{{ reportTypeLabels[item.type] }} · {{ reportStatusLabels[item.status] }}</text
                >
                <text class="name report-text">{{ item.title || '已举报内容' }}</text>
                <text class="caption">{{ relativeTime(item.created_at) }}</text>
              </view>
              <MobileIcon name="chevron" :size="18" />
            </MobileAction>
          </view>
        </template>
        <template v-else>
          <view v-for="item in items" :key="item.id" class="panel content-report-record">
            <view class="content-report-record__header">
              <view class="content-report-record__state">
                <text class="badge" :class="{ 'badge--warm': item.status === 'pending' }">{{ reportStatusLabels[item.status] }}</text>
                <text class="caption">{{ reportTypeLabels[item.type] }}</text>
              </view>
              <text class="caption">{{ relativeTime(item.created_at) }}</text>
            </view>
            <text v-if="item.title && item.title !== reportTypeLabels[item.type]" class="name report-text">{{ item.title }}</text>
            <view class="stack stack--tight">
              <text class="caption">问题说明</text>
              <text class="body report-text">{{ item.reason }}</text>
            </view>
            <view v-if="item.resolution" class="stack stack--tight content-report-record__resolution">
              <view class="content-report-record__header">
                <text class="caption">处理说明</text>
                <text class="caption">{{ relativeTime(item.resolved_at || '') }}</text>
              </view>
              <text class="body report-text">{{ item.resolution }}</text>
            </view>
          </view>
        </template>
        <MobileListFooter :loading="loadingMore" :error="moreError"
          :can-load-more="!!next && !loading && !error" :finished="!next && !loading && !error"
          :count="items.length" loading-label="正在加载更多举报记录…"
          error-title="更多举报记录暂未加载" @more="load(true)" />
        <MobileSkeleton v-if="loading && !loadingMore" label="正在读取举报记录…" />
        <FishingEmptyState
          v-else-if="!items.length && !error && !next"
          icon="shield"
          :title="
            review
              ? section === 'pending'
                ? '当前没有待处理举报'
                : '还没有处理记录'
              : '还没有举报记录'
          "
          :description="
            review ? '这里处理社区内容和钓位纠错。' : '发现问题，可在鱼情或钓位详情提交说明。'
          "
        />
        <text class="caption">社区举报与水域线索上报相互独立，不代表已向政府部门报案。</text>
        <text v-if="items.some((item) => item.status !== 'pending')" class="caption"
          >处理结果记录当时的决定，不代表内容当前状态。</text
        >
      </template>
    </view>
  </FishingShell>
</template>
<style scoped>
.content-report-record {
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: var(--ink);
}
.content-report-record__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
}
.content-report-record__state {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.content-report-record__resolution {
  border-top: 1px solid var(--line);
  padding-top: 12px;
}
.report-queue__row.mobile-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 48px;
  margin: 0;
  padding: 14px 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--ink);
  text-align: start;
}
.report-queue__row.mobile-action:not(:last-child) { border-bottom: 1px solid var(--line); }
.report-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
