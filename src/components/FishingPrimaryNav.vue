<script setup lang="ts">
import MobileBottomNav from '@mobile-core/components/MobileBottomNav.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import FishMark from './FishMark.vue'

defineProps<{ active: string }>()
defineEmits<{ navigate: [key: string] }>()
const tabs = [
  { key: 'feed', label: '钓友圈', icon: 'home' },
  { key: 'spots', label: '找钓位', icon: 'location' },
  { key: 'reports', label: '举报', icon: 'shield' },
  { key: 'mine', label: '我的', icon: 'user' }
] as const
</script>

<template>
  <MobileBottomNav :items="tabs" :active="active" in-place @navigate="$emit('navigate', $event)">
    <template #icon="{ item, active: selected }">
      <FishMark v-if="item.key === 'feed'" :size="28" :tone="selected ? 'brand' : 'muted'" />
      <MobileIcon v-else :name="item.icon" :size="20" />
    </template>
  </MobileBottomNav>
</template>
