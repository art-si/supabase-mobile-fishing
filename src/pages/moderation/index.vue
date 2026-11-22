<script setup lang="ts">
import { ref, watch } from 'vue'
import { onShow, onHide, onUnload, onReachBottom } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import FishingLoadingStatus from '@/components/FishingLoadingStatus.vue'
import FishingEmptyState from '@/components/FishingEmptyState.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileListFooter from '@mobile-core/components/MobileListFooter.vue'
import { useAuthStore } from '@/stores/auth'
import { isTransientRequestError } from '@/services/http'
import { moderation } from '@/services/moderation'
import { errorText, relativeTime, audienceLabels } from '@/domain/rules'
import type { ReviewQueue, ReviewSummary, ReviewCursor } from '@/domain/moderation'
import { reportTypeLabels } from '@/domain/content-reports'
const auth = useAuthStore(),
  items = ref<ReviewSummary[]>([]),
  next = ref<ReviewCursor | null>(null),
  loading = ref(false),
  loadingMore = ref(false),
  error = ref(''),
  moreError = ref('')
let version = 0
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
async function load(more = false) {
  if (!auth.signedIn || loading.value || (more && !next.value)) return
  const current = ++version
  loading.value = true
  loadingMore.value = more
  error.value = ''
  moreError.value = ''
  try {
    const data = await moderation<ReviewQueue>('queue', { cursor: more ? next.value : null })
    if (current !== version) return
    const combined = more ? [...items.value, ...data.items] : data.items
    items.value = combined.filter(
      (item, index) =>
        combined.findIndex((other) => other.id === item.id && other.type === item.type) === index
    )
    next.value = data.next
  } catch (e) {
    if (current !== version) return
    if (more && isTransientRequestError(e)) {
      moreError.value = errorText(e)
      return
    }
    // Never leave privileged content onscreen after a failed permission refresh.
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
watch(
  () => auth.userId,
  () => {
    clear()
    void load()
  }
)
onShow(() => {
  clear()
  void load()
})
onHide(clear)
onUnload(clear)
</script>
<template>
  <FishingShell title="内容审核" back>
    <view class="fishing-content stack">
      <template v-if="!auth.signedIn">
        <FishingEmptyState
          icon="shield"
          title="仅审核员可访问"
          description="请登录已获授权的账号。"
        />
        <MobileAction class="primary" @click="auth.requireLogin()">登录</MobileAction>
      </template>
      <template v-else>
        <MobileAction
          class="secondary"
          @click="uni.navigateTo({ url: '/pages/content-report/index?review=1' })"
          >社区举报与纠错</MobileAction
        >
        <MobileAction
          class="secondary"
          @click="uni.navigateTo({ url: '/pages/map/marks?review=1' })"
          >禁钓提醒审核</MobileAction
        >
        <view class="section-head"
          ><text class="heading">待审核</text
          ><MobileAction class="text-action" :disabled="loading" @click="load()"
            >刷新列表</MobileAction
          ></view
        >
        <MobileLoadError v-if="error" title="无法读取审核列表" :message="error" @retry="load()" />
        <view v-if="items.length" class="panel">
          <MobileAction
            v-for="item in items"
            :key="`${item.type}-${item.id}`"
            class="list-row"
            :aria-label="`审核${item.is_update ? '修改' : ''}：${item.title}`"
            @click="
              uni.navigateTo({
                url: `/pages/moderation/detail?type=${item.type}&id=${item.id}${item.is_update ? '&update=1' : ''}`
              })
            "
          >
            <view class="stack stack--tight grow">
              <text class="caption"
                >{{ reportTypeLabels[item.type] }} ·
                {{ audienceLabels[item.audience] }}{{ item.is_update ? ' · 修改' : '' }}</text
              >
              <text class="name">{{ item.title }}</text>
              <text class="caption"
                >{{ item.author.nickname }} · {{ relativeTime(item.created_at) }}</text
              >
            </view>
            <MobileIcon name="chevron" :size="16" aria-hidden="true" />
          </MobileAction>
        </view>
        <FishingLoadingStatus v-if="loading && !loadingMore" label="正在读取待审内容…" />
        <FishingEmptyState
          v-else-if="!items.length && !error && !next"
          icon="success"
          title="当前没有待审内容"
          description="社区举报与纠错可从上方入口处理。"
        />
        <MobileListFooter :loading="loadingMore" :error="moreError"
          :can-load-more="!!next && !loading && !error" :finished="!next && !loading && !error"
          :count="items.length" loading-label="正在加载更多待审内容…"
          error-title="更多待审内容暂未加载" @more="load(true)" />
        <text class="caption">仅审核共享内容，不读取私人日志或隐藏坐标。</text>
      </template>
    </view>
  </FishingShell>
</template>
