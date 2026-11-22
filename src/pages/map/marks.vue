<script setup lang="ts">
import { ref, watch } from 'vue'
import { onLoad, onShow, onHide, onUnload, onReachBottom } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import ZoneInfo from '@/components/ZoneInfo.vue'
// #ifdef H5
import ZoneMapPreview from '@/components/ZoneMapPreview.vue'
// #endif
// #ifdef MP-WEIXIN
import StaticMapPreview from '@/components/StaticMapPreview.vue'
// #endif
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileField from '@mobile-core/components/MobileField.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileListFooter from '@mobile-core/components/MobileListFooter.vue'
import FishingLoadingStatus from '@/components/FishingLoadingStatus.vue'
import MobileConfirmDialog from '@mobile-core/components/MobileConfirmDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { isTransientRequestError } from '@/services/http'
import { zonesRead, zonesMine, zonesWrite } from '@/services/zones'
import type { Zone, ZonePage } from '@/domain/zones'
import { createId, errorText } from '@/domain/rules'
const auth = useAuthStore(),
  review = ref(false),
  status = ref('pending'),
  items = ref<Zone[]>([]),
  next = ref<ZonePage['next']>(null),
  loading = ref(false),
  loadingMore = ref(false),
  error = ref(''),
  moreError = ref(''),
  busy = ref(false),
  feedback = ref(''),
  confirm = ref(false),
  target = ref<Zone | null>(null),
  decision = ref('withdraw'),
  reason = ref(''),
  expanded = ref(''),
  stale = ref(false)
let version = 0,
  requestId = ''
function clear() {
  version++
  items.value = []
  next.value = null
  target.value = null
  confirm.value = false
  loading.value = false
  loadingMore.value = false
  busy.value = false
  expanded.value = ''
  reason.value = ''
  feedback.value = ''
  error.value = ''
  moreError.value = ''
}
onReachBottom(() => {
  if (!error.value && !moreError.value && !busy.value) void load(true)
})
async function load(more = false) {
  if (!auth.signedIn || loading.value || (more && (!next.value || busy.value))) return
  const current = ++version
  loading.value = true
  loadingMore.value = more
  error.value = ''
  moreError.value = ''
  stale.value = false
  try {
    const data = review.value
      ? await zonesRead<ZonePage>('review', {
          status: status.value,
          cursor: more ? next.value : null
        })
      : await zonesMine(more ? next.value : null)
    if (current !== version) return
    items.value = more ? [...items.value, ...data.items] : data.items
    next.value = data.next
  } catch (e) {
    if (current === version) {
      if (more && isTransientRequestError(e)) {
        moreError.value = errorText(e)
        return
      }
      items.value = []
      next.value = null
      error.value = errorText(e)
    }
  } finally {
    if (current === version) {
      loading.value = false
      loadingMore.value = false
    }
  }
}
function prepare(zone: Zone, value: string) {
  target.value = zone
  decision.value = value
  requestId = createId()
  reason.value = ''
  feedback.value = ''
  confirm.value = true
  stale.value = false
}
async function act() {
  if (!target.value || busy.value) return
  if (review.value && !reason.value.trim()) {
    feedback.value = '请先填写核验与处理说明。'
    return
  }
  const current = version
  busy.value = true
  feedback.value = ''
  try {
    await zonesWrite(review.value ? 'decide' : 'withdraw', {
      id: target.value.id,
      request_id: requestId,
      revision: target.value.revision,
      ...(review.value ? { decision: decision.value, reason: reason.value.trim() } : {})
    })
    if (current !== version) return
    confirm.value = false
    target.value = null
    busy.value = false
    await load()
  } catch (e) {
    if (current === version) {
      feedback.value = errorText(e)
      stale.value = ['REVIEW_CONFLICT', 'INVALID_TRANSITION', 'FORBIDDEN'].includes(
        (e as { code?: string }).code || ''
      )
    }
  } finally {
    if (current === version) busy.value = false
  }
}
onLoad((options) => {
  review.value = options?.review === '1'
})
onShow(() => {
  void load()
})
onHide(clear)
onUnload(clear)
watch(
  () => auth.context,
  () => {
    clear()
    void load()
  },
  { flush: 'sync' }
)
function changeStatus() {
  clear()
  status.value = status.value === 'pending' ? 'published' : 'pending'
  void load()
}
</script>
<template>
  <FishingShell :title="review ? '禁钓提醒审核' : '我的标记'" back>
    <view class="fishing-content stack">
      <template v-if="!auth.signedIn"
        ><text class="muted">登录后查看自己提交的禁钓提醒。</text
        ><MobileAction class="primary" @click="auth.requireLogin()">登录</MobileAction></template
      >
      <template v-else>
        <view class="row row--between row--wrap"
          ><text class="muted">{{
            review ? (status === 'pending' ? '待审核' : '已公开') : '圈选的参考范围与处理状态'
          }}</text
          ><MobileAction v-if="review" class="text-action" @click="changeStatus">{{
            status === 'pending' ? '查看已公开' : '查看待审核'
          }}</MobileAction
          ><MobileAction class="text-action" :disabled="loading || busy" @click="load()"
            >刷新</MobileAction
          ></view
        >
        <text v-if="review" class="caption"
          >逐条核实依据、地点和期限。通过后仍是钓友提醒，不成为官方公告。</text
        >
        <MobileLoadError v-if="error" title="标记未加载" :message="error" @retry="load()" />
        <FishingLoadingStatus v-if="loading && !loadingMore" label="正在读取标记…" />
        <text v-if="!loading && !error && !items.length && !next" class="muted">{{
          review ? '没有符合条件的提醒。' : '还没有提交过标记。到地图上圈选需要提醒的水域吧。'
        }}</text>
        <view v-for="zone in items" :key="zone.id" class="panel stack">
          <ZoneInfo :zone="zone" personal @refresh="load()" />
          <text class="caption"
            >中心：{{ zone.longitude.toFixed(5) }}, {{ zone.latitude.toFixed(5) }}（GCJ-02）</text
          >
          <MobileAction
            class="text-action"
            :aria-expanded="expanded === zone.id"
            @click="expanded = expanded === zone.id ? '' : zone.id"
            >{{ expanded === zone.id ? '收起范围预览' : '预览参考范围' }}</MobileAction
          >
          <!-- #ifdef H5 -->
          <ZoneMapPreview v-if="expanded === zone.id" :circle="zone" />
          <!-- #endif -->
          <!-- #ifdef MP-WEIXIN -->
          <StaticMapPreview
            v-if="expanded === zone.id"
            :target="{ longitude: zone.longitude, latitude: zone.latitude }"
            :prohibited="!zone.feedback?.released"
          />
          <!-- #endif -->
          <template v-if="review">
            <text v-if="zone.own" class="caption">不能审核自己的标记。</text>
            <template v-else
              ><MobileField
                v-if="target?.id === zone.id"
                v-model="reason"
                :field="`zone-review-${zone.id}`"
                label="核验与处理说明"
                multiline
                :focus="target?.id === zone.id"
                :maxlength="500"
                :disabled="busy"
                hint="先核实地点、现场依据与期限；不能以社区审核代替政府认定"
              /><view class="mobile-action-group"
                ><MobileAction
                  v-if="zone.status === 'pending'"
                  class="secondary"
                  :disabled="busy"
                  @click="prepare(zone, 'published')"
                  >通过提醒</MobileAction
                ><MobileAction
                  v-if="zone.status === 'pending'"
                  class="secondary"
                  :disabled="busy"
                  @click="prepare(zone, 'rejected')"
                  >退回</MobileAction
                ><MobileAction
                  v-if="zone.status === 'published'"
                  class="secondary"
                  :disabled="busy"
                  @click="prepare(zone, 'hidden')"
                  >隐藏</MobileAction
                ></view
              ></template
            >
          </template>
          <MobileAction
            v-else-if="zone.status !== 'withdrawn'"
            class="text-action"
            :disabled="busy"
            @click="prepare(zone, 'withdraw')"
            >撤回标记</MobileAction
          >
          <view v-if="target?.id === zone.id && review" class="stack"
            ><text class="name"
              >将{{
                decision === 'published'
                  ? '通过这条钓友提醒'
                  : decision === 'rejected'
                    ? '退回这条提醒'
                    : '隐藏这条提醒'
              }}</text
            ><text v-if="feedback" class="error" role="alert">{{ feedback }}</text
            ><MobileAction v-if="stale" class="secondary" @click="load()">重新读取</MobileAction
            ><MobileAction v-else class="primary" :disabled="busy" @click="act">{{
              busy
                ? '正在处理…'
                : decision === 'published'
                  ? '确认通过'
                  : decision === 'rejected'
                    ? '确认退回'
                    : '确认隐藏'
            }}</MobileAction
            ><MobileAction class="text-action" :disabled="busy" @click="target = null"
              >取消</MobileAction
            ></view
          >
        </view>
        <MobileListFooter :loading="loadingMore" :error="moreError"
          :can-load-more="!!next && !loading && !error && !busy" :finished="!next && !loading && !error"
          :count="items.length" loading-label="正在加载更多标记…"
          error-title="更多标记暂未加载" @more="load(true)" />
        <text v-if="!review && feedback" class="error" role="alert">{{ feedback }}</text>
      </template>
    </view>
    <MobileConfirmDialog
      v-if="!review"
      v-model="confirm"
      title="撤回这条标记？"
      message="其他人将无法继续读取这个圈选提醒，你仍可在自己的记录中查看。"
      confirm-text="撤回标记"
      :busy="busy"
      @confirm="act"
    />
  </FishingShell>
</template>
