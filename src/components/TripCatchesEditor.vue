<script setup lang="ts">
import { getCurrentInstance, nextTick, ref } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileField from '@mobile-core/components/MobileField.vue'
import MobileMultiChoice from '@mobile-core/components/MobileMultiChoice.vue'
import { fishSpeciesOptions } from '@/domain/fishing-presets'
import CatchWeightField from './CatchWeightField.vue'
import { revealControl } from '@mobile-core/form-focus'
import { catchField, freshCatch, MAX_TRIP_CATCHES, validateCatches } from '@/domain/trip-catches'
import type { CatchDraft } from '@/domain/models'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
const rows = defineModel<CatchDraft[]>({ default: () => [] })
const props = defineProps<{ errors: Record<string, string>; disabled?: boolean }>()
const localErrors = ref<Record<string, string>>({})
const touched = ref<Record<string, boolean>>({})
const removed = ref<{ row: CatchDraft; index: number }>()
const focusId = ref('')
const nativeScope = getCurrentInstance()?.proxy
function validate(row: CatchDraft, field: 'species' | 'count' | 'weight') {
  const key = catchField(row, field)
  touched.value[key] = true
  localErrors.value = validateCatches(rows.value)
}
function fieldError(row: CatchDraft, field: 'species' | 'count' | 'weight') {
  const key = catchField(row, field)
  return touched.value[key] ? localErrors.value[key] : props.errors[key]
}
async function focus(row: CatchDraft) {
  focusId.value = ''
  await nextTick()
  focusId.value = row.id
}
function add() {
  if (props.disabled || rows.value.length >= MAX_TRIP_CATCHES) return
  const row = freshCatch()
  rows.value = [...rows.value, row]
  void focus(row)
}
function remove(index: number) {
  if (props.disabled) return
  removed.value = { row: { ...rows.value[index] }, index }
  rows.value = rows.value.filter((_, i) => index !== i)
  localErrors.value = validateCatches(rows.value)
  const neighbour = rows.value[Math.min(index, rows.value.length - 1)]
  void revealControl(neighbour ? `catch-remove-${neighbour.id}` : 'trip-catches-undo', {
    nativeScope
  })
}
function undo() {
  if (!removed.value || props.disabled || rows.value.length >= MAX_TRIP_CATCHES) return
  const { row, index } = removed.value
  const next = [...rows.value]
  next.splice(Math.min(index, next.length), 0, row)
  rows.value = next
  removed.value = undefined
  localErrors.value = validateCatches(rows.value)
  void focus(row)
}
</script>

<template>
  <view class="trip-catches stack" aria-label="渔获明细">
    <text class="caption"
      >按一组渔获分条记录，可选择多个鱼种。尾数未知可留空，空军填 0；重量填该组总重。</text
    >
    <view v-for="(row, index) in rows" :key="row.id" class="trip-catches__row stack">
      <view class="row row--between">
        <text class="name">渔获 {{ index + 1 }}</text>
        <MobileAction
          :id="`catch-remove-${row.id}`"
          class="text-action"
          :aria-label="`移除渔获 ${index + 1}`"
          :disabled="disabled"
          @click="remove(index)"
          >移除</MobileAction
        >
      </view>
      <MobileMultiChoice
        v-model="row.species"
        :field="catchField(row, 'species')"
        label="鱼种"
        :input-label="`渔获 ${index + 1} 鱼种`"
        :options="fishSpeciesOptions"
        :maxlength="60"
        :focus="focusId === row.id"
        :disabled="disabled"
        :error="fieldError(row, 'species')"
        @update:model-value="validate(row, 'species')"
        @focusout="validate(row, 'species')"
      />
      <view class="trip-catches__numbers">
        <MobileField
          v-model="row.count"
          :field="catchField(row, 'count')"
          label="尾数"
          :input-label="`渔获 ${index + 1} 尾数`"
          inputmode="numeric"
          placeholder="空军填 0"
          :maxlength="8"
          :disabled="disabled"
          :error="fieldError(row, 'count')"
          @update:model-value="validate(row, 'count')"
          @focusout="validate(row, 'count')"
        />
        <CatchWeightField
          v-model="row.weight"
          v-model:unit="row.weight_unit"
          :field="catchField(row, 'weight')"
          class="trip-catches__weight"
          label="重量"
          :input-label="`渔获 ${index + 1} 重量`"
          :disabled="disabled"
          :error="fieldError(row, 'weight')"
          @update:model-value="validate(row, 'weight')"
          @focusout="validate(row, 'weight')"
        />
      </view>
    </view>
    <view v-if="removed" class="row row--between" role="status">
      <text class="caption">已移除一条渔获</text>
      <MobileAction
        id="trip-catches-undo"
        class="text-action"
        :disabled="disabled || rows.length >= MAX_TRIP_CATCHES"
        @click="undo"
        >撤销移除</MobileAction
      >
    </view>
    <text v-if="errors.catches || localErrors.catches" class="error" role="alert">{{
      localErrors.catches || errors.catches
    }}</text>
    <MobileAction
      class="secondary"
      :disabled="disabled || rows.length >= MAX_TRIP_CATCHES"
      @click="add"
      >{{
        rows.length >= MAX_TRIP_CATCHES ? `已记录 ${MAX_TRIP_CATCHES} 条渔获` : '添加一条渔获'
      }}</MobileAction
    >
  </view>
</template>

<style lang="scss">
.trip-catches__row {
  border-top: 1px solid var(--line);
  padding-top: 12px;
}
.trip-catches__numbers {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr));
  gap: 16px;
}
.trip-catches__weight {
  grid-column: 1 / -1;
}
.trip-catches .text-action {
  min-height: 48px;
  min-width: 48px;
}
</style>
