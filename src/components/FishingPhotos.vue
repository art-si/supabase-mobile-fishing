<script setup lang="ts">
import { ref, watch } from 'vue'
import { clearVideoPosterScope } from '@mobile-core/video-poster'
import MobileMediaGallery from '@mobile-core/components/MobileMediaGallery.vue'
import { resolvePhotos } from '@/services/media'
import { useAuthStore } from '@/stores/auth'
import type { Media } from '@/domain/models'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
const props = defineProps<{ media: Media[]; label: string; full?: boolean; compact?: boolean }>()
defineEmits<{ ready: [value: boolean] }>()
const auth = useAuthStore(), busy = ref(false)
watch(() => auth.context, (_scope, previous) => clearVideoPosterScope(previous), { flush: 'sync' })
async function retry() {
  busy.value = true
  try { await resolvePhotos([{ media: props.media }]) }
  finally { busy.value = false }
}
</script>
<template>
  <MobileMediaGallery :key="auth.context" :scope="auth.context" :media="media" :label="label" :full="full" :compact="compact" :busy="busy" @retry="retry" @ready="$emit('ready',$event)" />
</template>
