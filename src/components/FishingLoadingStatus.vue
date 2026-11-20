<script setup lang="ts">
import MobileLoadingStatus from '@mobile-core/components/MobileLoadingStatus.vue'
import FishMark from './FishMark.vue'
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
withDefaults(defineProps<{ label: string; block?: boolean }>(), { block: true })
</script>
<template>
  <MobileLoadingStatus :label="label" :block="block">
    <template #indicator>
      <view class="fish-loading" :class="{ 'fish-loading--inline': !block }" aria-hidden="true">
        <FishMark :size="block ? 44 : 28" swimming />
        <view class="fish-loading__bubble" />
        <view class="fish-loading__bubble fish-loading__bubble--second" />
      </view>
    </template>
  </MobileLoadingStatus>
</template>
<style scoped>
.fish-loading {
  position: relative;
  display: flex;
  align-items: center;
  flex: none;
  padding: 8px 14px 8px 0;
}
.fish-loading__bubble {
  position: absolute;
  right: 5px;
  top: 6px;
  width: 5px;
  height: 5px;
  border: 1px solid var(--lake);
  border-radius: 50%;
  opacity: 0.5;
  animation: fish-bubble 1.8s ease-out infinite;
}
.fish-loading__bubble--second {
  right: 0;
  top: 0;
  width: 3px;
  height: 3px;
  animation-delay: 0.65s;
}
.fish-loading--inline {
  padding: 3px 10px 3px 0;
}
.fish-loading--inline .fish-loading__bubble {
  width: 3px;
  height: 3px;
  right: 2px;
  top: 0;
}
.fish-loading--inline .fish-loading__bubble--second {
  display: none;
}
@media (prefers-reduced-motion: reduce) {
  .fish-loading__bubble {
    animation: none;
    opacity: 0.5;
  }
}
</style>
