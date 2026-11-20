<script setup lang="ts">
defineOptions({ options: { styleIsolation: 'apply-shared' } })
defineProps<{ prohibited?: boolean }>()
</script>
<template>
  <text v-if="prohibited" class="spot-status-stamp" aria-label="禁钓">禁钓</text>
</template>
<style scoped>
.spot-status-stamp {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 3.25rem;
  height: 3.25rem;
  border: 3px double currentColor;
  border-radius: 50%;
  color: var(--danger);
  font-size: 0.875rem;
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: 0.08em;
  white-space: nowrap;
  transform: rotate(-12deg);
}
</style>
