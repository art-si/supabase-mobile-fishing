<script setup lang="ts">
import MobileSkeleton from '@mobile-core/components/MobileSkeleton.vue'

defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
withDefaults(defineProps<{ label: string; block?: boolean; media?: boolean; bare?: boolean }>(), { block: true })
</script>

<template>
  <view v-if="media" class="fishing-media-placeholder" role="status" :aria-label="label" />
  <view v-else :class="{ panel: block && !bare }">
    <MobileSkeleton :label="label" :block="block" bare />
  </view>
</template>

<style scoped>
.fishing-media-placeholder {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 12px;
  background: var(--inset);
}
</style>
