<script setup lang="ts">
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { computed } from 'vue'
import { useAppearanceStore } from '@/stores/appearance'
const props = withDefaults(
  defineProps<{ size?: number; swimming?: boolean; tone?: 'brand' | 'muted' }>(),
  {
    size: 48,
    swimming: false,
    tone: 'brand'
  }
)
const theme = useAppearanceStore()
// Platform-safe bitmap layers, exported together from assets/brand/fish-symbol.svg.
const source = computed(
  () => `/static/brand/fish-${theme.skin}-${theme.dark ? 'dark' : 'light'}-${props.tone}`
)
</script>
<template>
  <view
    class="fish-mark"
    :class="{ 'fish-mark--swimming': swimming }"
    :style="{ '--fish-size': `${size}px` }"
    aria-hidden="true"
  >
    <!-- #ifdef H5 -->
    <!-- Native browser images avoid Uni's late loader callback after a loading state unmounts. -->
    <img class="fish-mark__tail" :src="`${source}-tail.png`" alt="" :draggable="false" />
    <img class="fish-mark__body" :src="`${source}-body.png`" alt="" :draggable="false" />
    <!-- #endif -->
    <!-- #ifndef H5 -->
    <image
      class="fish-mark__tail"
      :src="`${source}-tail.png`"
      mode="aspectFit"
      :draggable="false"
    />
    <image
      class="fish-mark__body"
      :src="`${source}-body.png`"
      mode="aspectFit"
      :draggable="false"
    />
    <!-- #endif -->
  </view>
</template>
