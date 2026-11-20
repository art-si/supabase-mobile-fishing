<script setup lang="ts">
import { computed, ref } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import { catchSummary, tripCatches } from '@/domain/trip-catches'
import type { Trip } from '@/domain/models'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
const props = defineProps<{ trip: Trip }>()
const rows = computed(() => tripCatches(props.trip))
const total = computed(() => catchSummary(rows.value))
const expanded = ref(false)
const visible = computed(() => (expanded.value ? rows.value : rows.value.slice(0, 3)))
</script>
<template>
  <view v-if="rows.length" class="trip-catch-list">
    <view v-for="(row, index) in visible" :key="index" class="trip-catch-list__row">
      <text class="name">{{ row.species || `渔获 ${index + 1}` }}</text>
      <text class="caption"
        >{{
          row.count === null ? '尾数未记' : row.count === 0 ? '0 尾（空军）' : `${row.count} 尾`
        }}
        · {{ row.weight_kg === null ? '未称重' : `${row.weight_kg} kg` }}</text
      >
    </view>
    <MobileAction
      v-if="rows.length > 3"
      class="text-action"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
      >{{ expanded ? '收起渔获明细' : `查看全部 ${rows.length} 条渔获` }}</MobileAction
    >
    <text v-if="rows.length > 1" class="caption trip-catch-list__total"
      >{{ total.count === null ? '部分尾数未记录' : `合计 ${total.count} 尾` }} ·
      {{ total.weight_kg === null ? '部分未称重' : `共 ${total.weight_kg} kg` }}</text
    >
  </view>
</template>
<style lang="scss">
.trip-catch-list {
  display: grid;
  gap: 12px;
}
.trip-catch-list__row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 16px;
}
.trip-catch-list__row .name {
  overflow-wrap: anywhere;
}
.trip-catch-list__total {
  border-top: 1px solid var(--line);
  padding-top: 12px;
}
</style>
