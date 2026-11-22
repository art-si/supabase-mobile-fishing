<script setup lang="ts">
import noFishingStamp from '@/brand/no-fishing-stamp.png'

defineOptions({ options: { styleIsolation: 'apply-shared' } })
defineProps<{ prohibited?: boolean }>()
</script>
<template>
  <view v-if="prohibited" class="spot-status-stamp" role="img" aria-label="禁钓">
    <image class="spot-status-stamp__icon" :src="noFishingStamp" mode="aspectFit" aria-hidden="true" />
  </view>
</template>
<style scoped>
.spot-status-stamp {
  display: block;
  flex: 0 0 auto;
  width: clamp(52px, 3.8rem, 76px);
  height: clamp(52px, 3.8rem, 76px);
  transform: rotate(-14deg);
}
.spot-status-stamp__icon {
  display: block;
  width: 100%;
  height: 100%;
}
@media (prefers-color-scheme: dark) {
  .spot-status-stamp__icon {
    filter: brightness(1.75) saturate(0.85);
  }
}
</style>
