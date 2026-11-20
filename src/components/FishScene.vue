<script setup lang="ts">
import FishMark from './FishMark.vue'
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
withDefaults(defineProps<{ social?: boolean; place?: boolean }>(), { social: false, place: false })
</script>
<template>
  <view
    class="fish-scene"
    :class="{ 'fish-scene--social': social, 'fish-scene--place': place }"
    aria-hidden="true"
  >
    <view class="fish-scene__fish"><FishMark :size="social ? 58 : 76" /></view>
    <view v-if="social" class="fish-scene__friend"><FishMark :size="42" /></view>
    <view class="fish-scene__ripple" />
    <view class="fish-scene__ripple fish-scene__ripple--far" />
    <view class="fish-scene__bubble" />
    <view class="fish-scene__bubble fish-scene__bubble--small" />
    <view v-if="place" class="fish-scene__float" />
  </view>
</template>
<style scoped>
.fish-scene {
  position: relative;
  width: 136px;
  height: 92px;
  margin: 0 auto 8px;
  color: var(--lake);
}
.fish-scene__fish {
  position: absolute;
  top: 20px;
  left: 24px;
}
.fish-scene__ripple {
  position: absolute;
  bottom: 10px;
  left: 20px;
  width: 98px;
  height: 12px;
  border-bottom: 1px solid var(--lake);
  border-radius: 50%;
  opacity: 0.24;
}
.fish-scene__ripple--far {
  bottom: 0;
  left: 40px;
  width: 58px;
  height: 8px;
  opacity: 0.15;
}
.fish-scene__bubble {
  position: absolute;
  width: 7px;
  height: 7px;
  border: 1.5px solid var(--lake);
  border-radius: 50%;
  top: 16px;
  right: 24px;
  opacity: 0.45;
}
.fish-scene__bubble--small {
  width: 3px;
  height: 3px;
  top: 3px;
  right: 15px;
  opacity: 0.3;
}
.fish-scene__friend {
  position: absolute;
  right: 0;
  top: 38px;
  transform: scaleX(-1);
  opacity: 0.65;
}
.fish-scene--social .fish-scene__fish {
  left: 4px;
  top: 18px;
}
.fish-scene--social .fish-scene__bubble {
  right: 48px;
}
.fish-scene--social .fish-scene__bubble--small {
  right: 39px;
}
.fish-scene--place .fish-scene__fish {
  left: 12px;
}
.fish-scene__float {
  position: absolute;
  right: 14px;
  top: 19px;
  width: 4px;
  height: 32px;
  border-radius: 3px;
  background: var(--float);
}
.fish-scene__float::before {
  content: '';
  position: absolute;
  width: 1px;
  height: 16px;
  left: 1.5px;
  top: -12px;
  background: var(--reed);
}
</style>
