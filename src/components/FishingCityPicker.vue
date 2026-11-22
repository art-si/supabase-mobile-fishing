<script setup lang="ts">
import { computed } from 'vue'
import MobileCityPicker from '@mobile-core/components/MobileCityPicker.vue'
import { cityOptions, cityOption } from '@/domain/cities'
import { canLocateCity, locateCity } from '@/platforms/city-location'
import { useAuthStore } from '@/stores/auth'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
defineProps<{ label: string; field: string; placeholder?: string; compact?: boolean; clearable?: boolean; disabled?: boolean; guestLocation?: boolean }>()
const auth = useAuthStore()
const model = defineModel<string>({ default: '' })
const selected = computed({ get: () => cityOption(model.value)?.id || '', set: id => { model.value = cityOptions.find(city => city.id === id)?.name || '' } })
</script>
<template>
  <MobileCityPicker v-model="selected" :cities="cityOptions" :current-label="model" :label="label" :field="field" :placeholder="placeholder" :compact="compact" :clearable="clearable" :disabled="disabled" :locate="canLocateCity && (auth.signedIn || guestLocation) ? locateCity : undefined" />
</template>
