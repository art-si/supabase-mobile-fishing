<script setup lang="ts">
import { computed, ref } from 'vue'
import MobileField from '@mobile-core/components/MobileField.vue'
import MobileSelect from '@mobile-core/components/MobileSelect.vue'
import { changeWeightUnit, weightUnits, type WeightUnit } from '@/domain/catch-measurements'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
const props = defineProps<{
  field: string
  label: string
  inputLabel?: string
  error?: string
  disabled?: boolean
}>()
const value = defineModel<string>({ default: '' })
const unit = defineModel<WeightUnit>('unit', { default: 'kg' })
const localError = ref('')
const unitName = computed(() => (unit.value === 'jin' ? '斤' : 'kg'))
const selection = computed({
  get: () => unit.value,
  set: (next: string) => {
    if (props.disabled || (next !== 'kg' && next !== 'jin')) return
    try {
      const converted = changeWeightUnit(value.value, unit.value, next)
      unit.value = next
      value.value = converted
      localError.value = ''
    } catch (error) {
      localError.value = (error as Error).message
    }
  }
})
</script>
<template>
  <view class="catch-weight">
    <MobileField
      v-model="value"
      :field="field"
      :label="`${label}（${unitName}）`"
      :input-label="`${inputLabel || label}（${unitName}）`"
      inputmode="decimal"
      placeholder="未称重可留空"
      :maxlength="24"
      :disabled="disabled"
      :error="localError || error"
      @update:model-value="localError = ''"
    />
    <MobileField :field="`${field}-unit`" label="单位">
      <MobileSelect
        v-model="selection"
        :field="`${field}-unit`"
        :label="`${inputLabel || label}单位`"
        placeholder="选择单位"
        :options="weightUnits"
        :disabled="disabled"
      />
    </MobileField>
  </view>
</template>
<style lang="scss">
.catch-weight {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr));
  gap: 12px;
  min-width: 0;
}
</style>
