<script setup lang="ts">

import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileBottomSheet from '@mobile-core/components/MobileBottomSheet.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import type { AgencyAction, ReportAgencyOption } from '@/domain/report-channel-entry'
import type { ReportChannel } from '@/domain/report-channels'

defineOptions({ options: { styleIsolation: 'apply-shared' } })
const open = defineModel<boolean>({ required: true })
defineProps<{
  agencies: ReportAgencyOption[]
  water: string
  area: string
  resolving: boolean
  copyFeedback?: string
}>()
const emit = defineEmits<{
  select: [channel: ReportChannel, action: AgencyAction]
  copy: []
}>()
</script>

<template>
  <MobileBottomSheet v-model="open" title="选择举报机构" close-label="关闭机构选择"
    dialog-id="report-agency-sheet" trigger-id="report-choose-agency" :tall="agencies.length > 3">
    <view class="agency-picker">
      <view class="agency-picker__place">
        <MobileIcon name="location" size="1.125rem" />
        <view class="agency-picker__place-copy">
          <text class="name">{{ water }}</text>
          <text v-if="area" class="caption">{{ area }}</text>
        </view>
      </view>
      <text v-if="resolving" class="notice" role="status">正在核对水域所属地区…</text>
      <text v-else-if="!agencies.length" class="notice" role="status">该地区暂无已核实的举报入口。你可以复制材料，向事发地主管部门反映。</text>
      <view v-else v-for="agency in agencies" :key="agency.channel.id" class="agency-picker__agency">
        <text class="name">{{ agency.channel.name }}</text>
        <text v-if="agency.channel.scopeNote" class="caption">{{ agency.channel.scopeNote }}</text>
        <MobileAction v-for="action in agency.actions" :key="action.label"
          class="agency-picker__action"
          :aria-label="agency.channel.name + '，' + action.label + (action.kind === 'phone' ? ' ' + action.number : '')"
          @click="emit('select', agency.channel, action)">
          <view class="agency-picker__action-layout">
            <view class="agency-picker__action-copy">
              <text>{{ action.label }}</text>
              <text v-if="action.kind === 'phone' || action.detail" class="agency-picker__detail">{{ action.kind === 'phone' ? action.number : action.detail }}</text>
            </view>
            <MobileIcon name="chevron" size="1rem" />
          </view>
        </MobileAction>
      </view>
    </view>
    <template #footer>
      <text v-if="copyFeedback" class="agency-picker__feedback caption" role="status">{{ copyFeedback }}</text>
      <MobileAction class="secondary" @click="emit('copy')">复制文字材料</MobileAction>
    </template>
  </MobileBottomSheet>
</template>

<style scoped>
.agency-picker {
  padding: 12px max(16px, var(--mobile-safe-right, 0px)) 8px max(16px, var(--mobile-safe-left, 0px));
  background: var(--paper);
}
.agency-picker__place {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--lake-soft);
  border-radius: var(--fishing-control-radius);
  color: var(--lake);
}
.agency-picker__place-copy, .agency-picker__agency { display: flex; flex-direction: column; min-width: 0; overflow-wrap: anywhere; }
.agency-picker__agency { padding: 14px 0 6px; gap: 3px; }
.agency-picker__agency + .agency-picker__agency { border-top: 1px solid var(--line); }
.agency-picker__action {
  width: 100%;
  padding: 0;
  border-radius: 6px;
}
.agency-picker__action-layout {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: var(--fishing-target);
  padding: 6px 3px;
  text-align: start;
  color: var(--lake);
  font-size: var(--fishing-action-size);
  line-height: 1.45;
}
.agency-picker__action-copy {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 2px 10px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.agency-picker__detail { color: var(--reed); font-size: var(--fishing-label-size); font-variant-numeric: tabular-nums; }
.agency-picker__feedback { display: block; padding-bottom: 6px; }
</style>
