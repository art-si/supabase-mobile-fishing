<script setup lang="ts">
import MobileAction from '@mobile-core/components/MobileAction.vue'
import ZoneFeedback from './ZoneFeedback.vue'
import type { Zone } from '@/domain/zones'
import { safeSourceUrl, zoneStatus } from '@/domain/zones'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
defineProps<{ zone: Zone; personal?: boolean }>()
defineEmits<{ feedback: [zone: Zone]; refresh: [] }>()
function copy(url: string) {
  if (safeSourceUrl(url)) uni.setClipboardData({ data: url })
}
</script>
<template>
  <view class="stack stack--tight">
    <text class="badge">{{ zone.source === 'official' ? '官方公告' : '钓友上报' }}</text>
    <text class="heading">{{ zone.title }}</text>
    <text v-if="personal" class="caption">{{ zoneStatus[zone.status] }}</text>
    <text class="muted">{{ zone.location_label }}</text>
    <text class="zone-description">{{ zone.description }}</text>
    <text class="caption"
      >{{ zone.source === 'official' ? zone.issuer || '属地主管部门' : zone.reporter || '钓友' }} ·
      {{ zone.observed_on }}{{ zone.expires_on ? ` · 截至 ${zone.expires_on}` : '' }}</text
    >
    <text v-if="zone.boundary_note" class="caption">{{ zone.boundary_note }}</text>
    <text v-if="zone.water_attribution" class="caption"
      >水面边界：{{ zone.water_attribution }}</text
    >
    <text v-if="!zone.boundary" class="caption">旧记录未提供水域边界，暂不绘制围栏。</text>
    <text v-if="zone.review_note" class="notice">处理说明：{{ zone.review_note }}</text>
    <MobileAction
      v-if="safeSourceUrl(zone.source_url)"
      class="text-action"
      @click="copy(zone.source_url)"
      >{{ zone.source === 'official' ? '复制官方公告链接' : '复制依据链接' }}</MobileAction
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
      v-if="zone.status === 'published' && zone.boundary"
      :zone="zone"
      @change="$emit('feedback', $event)"
      @refresh="$emit('refresh')"
    />
  </view>
</template>
<style scoped>
.zone-description {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.7;
}
</style>
