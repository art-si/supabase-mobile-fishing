<script setup lang="ts">
defineOptions({ options: { styleIsolation: 'apply-shared' } })
</script>
<template>
  <view class="panel stack stack--tight content-detail-tools"><slot /></view>
</template>
<style scoped>
.content-detail-tools { gap: 8px; padding-block: 8px; }
.content-detail-tools :deep(.mobile-action) { min-height: 48px; }
.content-detail-tools :deep(.content-owner-actions--compact) { padding-top: 8px; border-top: 1px solid var(--line); }
.content-detail-tools :deep(.mobile-action-group) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 6rem), 1fr));
  gap: 8px;
}
</style>
