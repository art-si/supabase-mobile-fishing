<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileField from '@mobile-core/components/MobileField.vue'
import { useAuthStore } from '@/stores/auth'
import { zoneFeedback } from '@/services/zones'
import type { Zone, ZoneFeedback } from '@/domain/zones'
import { errorText } from '@/domain/rules'
import { isDemo } from '@/config'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
const props = defineProps<{ zone: Zone }>()
const emit = defineEmits<{ change: [zone: Zone]; refresh: [] }>()
const auth = useAuthStore(),
  state = ref<ZoneFeedback | null>(null),
  busy = ref(false),
  loading = ref(false),
  error = ref(''),
  stale = ref(false),
  note = ref(''),
  expanded = ref(false)
let requestVersion = 0
async function load() {
  const current = ++requestVersion
  error.value = ''
  loading.value = true
  try {
    const result = await zoneFeedback(props.zone)
    if (current !== requestVersion) return
    if (props.zone.feedback && props.zone.feedback.version !== result.version) {
      stale.value = true
      error.value = '范围或依据已更新，请刷新区域信息后重新反馈。'
      return
    }
    state.value = result
    note.value = result.note
  } catch (cause) {
    if (current === requestVersion) error.value = errorText(cause)
  } finally {
    if (current === requestVersion) loading.value = false
  }
}
watch(
  () => [
    props.zone.id,
    props.zone.source,
    props.zone.revision,
    auth.context,
    props.zone.feedback?.version
  ],
  (current, previous) => {
    requestVersion++
    busy.value = loading.value = expanded.value = stale.value = false
    error.value = note.value = ''
    state.value = previous && current[3] !== previous[3] ? null : props.zone.feedback || null
    if (state.value) note.value = state.value.note
    if (!isDemo) void load()
  },
  { immediate: true }
)
onBeforeUnmount(() => requestVersion++)
async function vote(choice: 'can_fish' | 'cannot_fish') {
  if (busy.value || loading.value || stale.value || !state.value || !auth.requireLogin()) return
  const current = requestVersion
  busy.value = true
  error.value = ''
  try {
    const result = await zoneFeedback(props.zone, choice, note.value.trim(), state.value.version)
    if (current !== requestVersion) return
    state.value = result
    emit('change', { ...props.zone, feedback: result })
  } catch (cause) {
    if (current === requestVersion) {
      stale.value = (cause as { code?: string }).code === 'REVIEW_CONFLICT'
      error.value = stale.value ? '范围或依据已更新，请刷新区域信息后重新反馈。' : errorText(cause)
    }
  } finally {
    if (current === requestVersion) busy.value = false
  }
}
</script>
<template>
  <view v-if="!isDemo" class="zone-feedback stack stack--tight">
    <text class="name">这里能垂钓吗？</text>
    <template v-if="state">
      <text class="body"
        >{{ state.can_fish }} / {{ state.total }} 位钓友认为可以垂钓<text v-if="state.total">
          · {{ state.percent }}%</text
        ></text
      >
      <text v-if="state.released" class="notice" role="status"
        >已按钓友反馈解除地图围栏。原标注与来源保留，不代表管理规定已变更。</text
      >
      <text class="caption"
        >至少 {{ state.minimum }} 个不同账号反馈，认为可以垂钓达到 {{ state.threshold }}%
        时自动解除围栏。每个账号只计一票，可修改。</text
      >
      <view class="mobile-action-group" role="group" aria-label="水域垂钓反馈">
        <MobileAction
          :class="state.mine === 'can_fish' ? 'primary' : 'secondary'"
          :aria-pressed="state.mine === 'can_fish'"
          :disabled="busy || loading || stale"
          @click="vote('can_fish')"
          >可以垂钓</MobileAction
        >
        <MobileAction
          :class="state.mine === 'cannot_fish' ? 'primary' : 'secondary'"
          :aria-pressed="state.mine === 'cannot_fish'"
          :disabled="busy || loading || stale"
          @click="vote('cannot_fish')"
          >仍需禁钓</MobileAction
        >
      </view>
      <text v-if="state.mine" class="caption" role="status"
        >你的反馈：{{ state.mine === 'can_fish' ? '可以垂钓' : '仍需禁钓'
        }}{{ busy ? ' · 正在保存…' : ' · 已计入' }}</text
      >
      <MobileAction
        class="text-action"
        :aria-expanded="expanded"
        :disabled="busy"
        @click="expanded = !expanded"
        >{{ expanded ? '收起补充依据' : '补充依据（选填）' }}</MobileAction
      >
      <MobileField
        v-if="expanded"
        v-model="note"
        :field="`zone-feedback-${zone.source}-${zone.id}`"
        label="补充依据"
        multiline
        :maxlength="500"
        :disabled="busy"
        hint="可说明现场标牌、允许垂钓的具体范围或最新公告；随后点选上方反馈保存。"
      />
      <text class="caption"
        >解除后仍可在区域列表中查看和反馈；若至少 10 个账号中有 60%
        认为仍需禁钓，将恢复围栏。范围或依据更新后重新计票。</text
      >
    </template>
    <text v-else-if="loading" class="caption" role="status">正在读取钓友反馈…</text>
    <text v-if="error" class="error" role="alert">{{ error }}</text>
    <MobileAction
      v-if="error"
      class="secondary"
      :disabled="loading || busy"
      @click="stale ? emit('refresh') : load()"
      >{{ stale ? '刷新区域信息' : '重新读取反馈' }}</MobileAction
    >
  </view>
</template>
<style scoped>
.zone-feedback {
  margin-top: 12px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
}
</style>
