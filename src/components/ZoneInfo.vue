<script setup lang="ts">
import { computed } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import ZoneFeedback from './ZoneFeedback.vue'
import type { Zone } from '@/domain/zones'
import { safeSourceUrl, zoneSourceLabel, zoneStatus } from '@/domain/zones'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
const props = defineProps<{ zone: Zone; personal?: boolean }>()
defineEmits<{ feedback: [zone: Zone]; refresh: [] }>()
const location = computed(() => {
  const text = props.zone.location_label?.trim()
  return text && !props.zone.title.includes(text) ? text : ''
})
const attribution = computed(() => {
  const { source, issuer, reporter, observed_on, expires_on } = props.zone
  const author = source === 'official' || source === 'notice'
    ? issuer || '属地主管部门'
    : reporter || (source === 'spot' ? '' : '钓友')
  return [author, observed_on, expires_on ? `截至 ${expires_on}` : ''].filter(Boolean).join(' · ')
})
function copy(url: string) {
  if (safeSourceUrl(url)) uni.setClipboardData({ data: url })
}
</script>
<template>
  <view class="zone-info">
    <view class="zone-info__place">
      <text class="zone-info__title" role="heading" aria-level="3">{{ zone.title }}</text>
      <text v-if="location" class="caption">{{ location }}</text>
      <view class="zone-info__meta">
        <text class="badge">{{ zoneSourceLabel(zone) }}</text>
        <text v-if="attribution" class="caption">{{ attribution }}</text>
        <text v-if="personal" class="caption">{{ zoneStatus[zone.status] }}</text>
      </view>
    </view>
    <text v-if="zone.description" class="body zone-description">{{ zone.description }}</text>
    <view v-if="zone.boundary_note || zone.water_attribution || (!zone.boundary && zone.source !== 'spot')"
      class="zone-info__boundary">
      <text v-if="zone.boundary_note" class="caption">{{ zone.boundary_note }}</text>
      <text v-if="zone.water_attribution" class="caption">水面边界：{{ zone.water_attribution }}</text>
      <text v-if="!zone.boundary && zone.source !== 'spot'" class="caption">旧记录未提供水域边界，暂不绘制围栏。</text>
    </view>
    <text v-if="zone.review_note" class="notice">处理说明：{{ zone.review_note }}</text>
    <MobileAction
      v-if="zone.spot_id"
      class="secondary zone-info__spot-action"
      @click="uni.navigateTo({ url: '/pages/spot/detail?id=' + encodeURIComponent(zone.spot_id) })"
      ><text>查看上报钓位</text><MobileIcon name="chevron" :size="16" aria-hidden="true" /></MobileAction
    >
    <MobileAction
      v-if="safeSourceUrl(zone.source_url)"
      class="text-action"
      @click="copy(zone.source_url)"
      >{{ zone.source === 'official' || zone.source === 'notice' ? '复制公告原文链接' : '复制依据链接' }}</MobileAction
    >
    <MobileAction
      v-if="zone.boundary_source_url && safeSourceUrl(zone.boundary_source_url)"
      class="text-action"
      @click="copy(zone.boundary_source_url)"
      >复制边界来源链接</MobileAction
    >
    <MobileAction
      v-if="zone.water_source_url && safeSourceUrl(zone.water_source_url)"
      class="text-action"
      @click="copy(zone.water_source_url)"
      >复制水面来源链接</MobileAction
    >
    <ZoneFeedback
      v-if="(zone.source === 'official' || zone.source === 'community') && zone.status === 'published' && zone.boundary"
      :zone="zone"
      @change="$emit('feedback', $event)"
      @refresh="$emit('refresh')"
    />
  </view>
</template>
<style scoped>
.zone-info,
.zone-info__place,
.zone-info__boundary {
  display: grid;
  min-width: 0;
  overflow-wrap: anywhere;
}
.zone-info {
  gap: 12px;
}
.zone-info__place {
  gap: 8px;
}
.zone-info__boundary {
  gap: 4px;
}
.zone-info__title {
  color: var(--ink);
  font-size: max(17px, 1.125rem);
  font-weight: 650;
  line-height: 1.38;
  text-wrap: balance;
}
.zone-info__meta {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 8px;
  min-width: 0;
}
.zone-info__spot-action.mobile-action {
  justify-content: space-between;
  text-align: start;
}
.zone-description {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.55;
}
</style>
