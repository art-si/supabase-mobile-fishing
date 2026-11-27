<script setup lang="ts">
import ContentDeleteAction from './ContentDeleteAction.vue'
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
defineProps<{ id: string; owner: string; compact?: boolean }>()
function deleted() { uni.reLaunch({ url: '/pages/home/index?tab=spots' }) }
</script>
<template>
  <ContentDeleteAction :id="id" type="spot" :owner="owner" :compact="compact" @deleted="deleted" />
</template>
