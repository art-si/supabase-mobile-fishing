<script setup lang="ts">
import MobileEmptyState from '@mobile-core/components/MobileEmptyState.vue'
import type { MobileIconName } from '@mobile-core/icons'
import FishScene from './FishScene.vue'
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
withDefaults(
  defineProps<{
    icon: MobileIconName
    title: string
    description?: string
    announce?: 'status' | 'alert'
  }>(),
  { announce: 'status' }
)
</script>
<template>
  <MobileEmptyState :icon="icon" :title="title" :description="description" :announce="announce">
    <template #illustration
      ><FishScene :social="icon === 'message' || icon === 'user'" :place="icon === 'location'"
    /></template>
    <slot />
  </MobileEmptyState>
</template>
