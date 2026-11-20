<script setup lang="ts">
// H5/Capacitor: the same shared map renders saved boundaries and browsing maps.
import { computed, ref } from 'vue'
import MobileMap from '@mobile-core/components/MobileMap.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import { loadAmap, type AmapMap } from '@/platforms/amap'
import { boundaryPaths, boundaryAnchor } from '@/domain/zone-geometry'
import { errorText } from '@/domain/rules'
import type { Zone } from '@/domain/zones'
import { useAppearanceStore } from '@/stores/appearance'
const props = defineProps<{ circle: Zone }>()
const theme = useAppearanceStore()
const panel = ref<InstanceType<typeof MobileMap>>()
const error = ref('')
let map: AmapMap | undefined
const fences = computed(() => props.circle.boundary ? [{
  id: props.circle.id, label: props.circle.title, paths: boundaryPaths(props.circle.boundary),
  point: boundaryAnchor(props.circle.boundary), dashed: props.circle.source !== 'official'
}] : [])
function ready(instance: AmapMap) { map = instance; instance.on('complete', () => panel.value?.fitFences()); panel.value?.fitFences() }
function zoom(delta: number) { if (map) map.setZoom(Math.max(8, Math.min(19, map.getZoom()+delta))) }
</script>
<template>
  <view class="zone-preview stack stack--tight">
    <template v-if="circle.boundary">
      <MobileMap ref="panel" class="zone-preview__map" :load="loadAmap" :reload-key="circle.id"
        :fences="fences" :fence-color="theme.palette.danger"
        :options="{ center: [circle.longitude, circle.latitude], zoom: 14, scrollWheel: false }"
        label="禁钓水域边界地图" @ready="ready" @error="error = errorText($event)" />
      <MobileLoadError v-if="error" title="范围地图未加载" :message="error" @retry="panel?.reload()" />
      <view class="mobile-action-group"><MobileAction class="secondary" @click="zoom(-1)">缩小</MobileAction><MobileAction class="secondary" @click="zoom(1)">放大</MobileAction><MobileAction class="text-action" @click="panel?.fitFences()">完整范围</MobileAction></view>
    </template>
    <text v-else class="caption">旧记录未提供水域边界，暂不绘制围栏。</text>
  </view>
</template>
<style scoped>
.zone-preview { min-width: 0; }
.zone-preview__map { --mobile-map-height: 288px; border-radius: 12px; --mobile-map-fence-color: var(--danger); }
</style>
