<script setup lang="ts">
defineOptions({ options: { styleIsolation: 'apply-shared' } })
import type { Spot } from '@/domain/models'
import { distanceLabel } from '@/domain/place-distance'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import SpotStatusStamp from './SpotStatusStamp.vue'
defineProps<{ spot: Spot }>()
</script>
<template>
  <view
    :class="[
      'panel stack spot-card',
      { 'spot-card--prohibited': spot.fishing_status === 'prohibited' }
    ]"
  >
    <view class="stack spot-card__body">
      <view class="row row--between"
        ><text class="badge">{{ spot.water_type }}</text
        ><view class="spot-card__meta"
          ><text class="caption">{{ spot.city }}</text
          ><text
            v-if="spot.distance_m != null && distanceLabel(spot.distance_m)"
            class="caption spot-card__distance"
            >距你{{ spot.distance_approximate ? '约 ' : ' '
            }}{{ distanceLabel(spot.distance_m) }}</text
          ></view
        ></view
      >
      <text v-if="spot.status === 'hidden'" class="badge badge--warm">暂不可见</text>
      <MobileAction
        class="post-title"
        :aria-label="`查看钓位：${spot.name}`"
        @click="uni.navigateTo({ url: `/pages/spot/detail?id=${spot.id}` })"
        ><text class="heading">{{ spot.name }}</text></MobileAction
      >
      <view
        v-if="
          spot.fishing_status === 'prohibited' ||
          spot.species ||
          (spot.fee_note && spot.fee_note !== '未核实')
        "
        class="row row--between row--wrap spot-card__footer"
      >
        <view
          v-if="spot.species || (spot.fee_note && spot.fee_note !== '未核实')"
          class="fish-facts"
        >
          <text v-if="spot.species" class="fish-facts__main">{{ spot.species }}</text>
          <text v-if="spot.fee_note && spot.fee_note !== '未核实'">{{ spot.fee_note }}</text>
        </view>
      </view>
    </view>
    <SpotStatusStamp
      v-if="spot.fishing_status === 'prohibited'"
      class="spot-card__stamp"
      prohibited
    />
  </view>
</template>
<style scoped>
.spot-card {
  position: relative;
}
.spot-card__body {
  position: relative;
  min-width: 0;
  z-index: 1;
}
.spot-card__stamp {
  position: absolute;
  right: 20px;
  bottom: 16px;
  z-index: 2;
  pointer-events: none;
}
.spot-card__footer {
  gap: 12px;
}
.spot-card__footer > :last-child {
  margin-left: auto;
}
.spot-card__meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  min-width: 0;
}
.spot-card__distance {
  color: var(--lake);
}
.spot-card__footer > .fish-facts {
  flex: 1 1 auto;
}
.spot-card--prohibited {
  background: var(--paper);
}
.spot-card--prohibited::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--inset);
  filter: grayscale(1);
}
.spot-card--prohibited .spot-card__body {
  --ink: var(--reed);
  --lake: var(--reed);
  color: var(--reed);
  filter: grayscale(1);
}
.spot-card--prohibited .spot-card__footer {
  min-height: 3.25rem;
  padding-right: 4.25rem;
}
.spot-card.spot-card--prohibited :deep(.post-title .heading) {
  color: var(--reed);
}
.spot-card--prohibited :deep(.fish-facts) {
  border-color: var(--line);
}
</style>
