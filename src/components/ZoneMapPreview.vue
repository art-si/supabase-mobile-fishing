<script setup lang="ts">
// H5/Capacitor: the same shared map renders saved boundaries and browsing maps.
import { computed, ref } from 'vue'
import MobileMap from '@mobile-core/components/MobileMap.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import { loadAmap, type AmapMap } from '@/platforms/amap'
import { boundaryPaths, boundaryAnchor } from '@/domain/zone-geometry'
import { errorText, validCoordinates } from '@/domain/rules'
import type { Zone } from '@/domain/zones'
import noFishingPin from '@/brand/no-fishing-pin.png'
import { useAppearanceStore } from '@/stores/appearance'
const props = defineProps<{ circle: Zone }>()
const theme = useAppearanceStore()
const panel = ref<InstanceType<typeof MobileMap>>()
const error = ref('')
let map: AmapMap | undefined
const fences = computed(() => {
  const zone = props.circle
  if (zone.feedback?.released || !validCoordinates(zone.longitude, zone.latitude)) return []
  const boundary = zone.source === 'spot' ? null : zone.boundary
  return [{
    id: zone.id, label: zone.title, paths: boundaryPaths(boundary),
    point: boundary ? boundaryAnchor(boundary) : [zone.longitude, zone.latitude] as [number, number],
    dashed: zone.source !== 'official'
  }]
})
function ready(instance: AmapMap) {
  map = instance
  error.value = ''
  instance.on('complete', () => {
    if (map !== instance) return
    error.value = ''
    panel.value?.fitFences()
  })
  panel.value?.fitFences()
}
function zoom(delta: number) { if (map) map.setZoom(Math.max(8, Math.min(19, map.getZoom()+delta))) }
</script>
<template>
  <view class="zone-preview stack stack--tight">
    <template v-if="fences.length">
      <MobileMap ref="panel" class="zone-preview__map" :load="loadAmap" :reload-key="circle.id"
        :fences="fences" :fence-pin-image="noFishingPin" :fence-color="theme.palette.danger"
        :options="{ center: [circle.longitude, circle.latitude], zoom: 14, scrollWheel: false }"
        :label="circle.boundary ? '禁钓水域边界地图' : '禁钓点位地图'" @ready="ready" @error="error = errorText($event)" />
      <MobileLoadError v-if="error" title="范围地图未加载" :message="error" @retry="panel?.reload()" />
      <view class="mobile-action-group"><MobileAction class="secondary" @click="zoom(-1)">缩小</MobileAction><MobileAction class="secondary" @click="zoom(1)">放大</MobileAction><MobileAction class="text-action" @click="panel?.fitFences()">完整范围</MobileAction></view>
    </template>
    <text v-else class="caption">{{ circle.feedback?.released ? '这处禁钓标记已解除。' : '这条记录缺少有效坐标。' }}</text>
  </view>
</template>
<style scoped>
.zone-preview { min-width: 0; }
.zone-preview__map { --mobile-map-height: 288px; border-radius: 12px; --mobile-map-fence-color: var(--danger); }
</style>
