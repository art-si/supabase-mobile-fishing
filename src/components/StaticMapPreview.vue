<script setup lang="ts">
import { computed, ref, shallowRef, watch, onBeforeUnmount } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import { getStaticPreview } from '@/services/amap'
import { errorText } from '@/domain/rules'
import { useAuthStore } from '@/stores/auth'
import type { MapPreviewTarget } from '@/domain/map'
import noFishingPin from '@/brand/no-fishing-pin.png'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
const props = withDefaults(
  defineProps<{ target: MapPreviewTarget; area?: boolean; automatic?: boolean; prohibited?: boolean }>(),
  { automatic: false }
)
type Frame = { request: number; image: string; zoom: number; prohibited: boolean }
const auth = useAuthStore(),
  preview = shallowRef<Frame>(),
  candidate = shallowRef<Frame>(),
  error = ref(''),
  loading = ref(false),
  requestedZoom = ref(14)
const frames = computed(() => [preview.value, candidate.value].filter((frame) => !!frame))
const maxZoom = computed(() => props.area ? 11 : 17)
const circle = computed(() => 'radiusM' in props.target && !!props.target.radiusM)
let version = 0,
  disposed = false
async function load(zoom = requestedZoom.value) {
  if (loading.value || !auth.requireLogin()) return
  const current = ++version
  requestedZoom.value = zoom
  loading.value = true
  error.value = ''
  try {
    const result = await getStaticPreview(props.prohibited ? { ...props.target, hideMarker: true } : props.target, zoom)
    if (disposed || current !== version) return
    candidate.value = { request: current, image: result.image, zoom: result.zoom, prohibited: !!props.prohibited && result.precision === 'exact' }
  } catch (e) {
    if (disposed || current !== version) return
    error.value = errorText(e)
    loading.value = false
  }
}
function imageReady(frame: Frame) {
  if (frame.request !== candidate.value?.request) return
  preview.value = frame
  candidate.value = undefined
  requestedZoom.value = frame.zoom
  loading.value = false
}
function imageFailed(frame: Frame) {
  if (frame.request !== candidate.value?.request) return
  candidate.value = undefined
  error.value = '图片显示失败，请重新加载地图'
  loading.value = false
}
function canZoom(delta: number) {
  if (loading.value || !preview.value) return false
  const next = preview.value.zoom + delta
  return next >= 8 && next <= maxZoom.value
}
function changeZoom(delta: number) {
  if (canZoom(delta)) void load(preview.value!.zoom + delta)
}
watch(
  () => JSON.stringify([props.target, props.area, props.prohibited, auth.context]),
  () => {
    version++
    loading.value = false
    preview.value = undefined
    candidate.value = undefined
    error.value = ''
    requestedZoom.value = props.area ? 11 : 14
    if (props.automatic && auth.signedIn) void load()
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  disposed = true
  version++
})
</script>
<template>
  <view class="stack stack--tight">
    <view class="row row--between row--wrap">
      <text class="name">{{
        circle ? '圈选范围' : area ? '大致位置' : '位置预览'
      }}</text>
    </view>
    <view v-if="preview || loading" class="static-map-stage" :aria-busy="loading || undefined">
      <image
        v-for="frame in frames"
        :key="frame.request"
        class="static-map-image"
        :class="{ 'static-map-image--incoming': frame.request !== preview?.request }"
        :src="frame.image"
        mode="aspectFit"
        :aria-hidden="frame.request !== preview?.request || undefined"
        :aria-label="
          circle
            ? '高德静态地图上的圈选参考范围，不是官方边界'
            : area
              ? '高德大致水域静态地图，不可据此导航'
              : '高德地点静态预览，不可拖动选点'
        "
        @load="imageReady(frame)"
        @error="imageFailed(frame)"
      />
      <image v-if="preview?.prohibited" class="static-map-pin" :src="noFishingPin" mode="aspectFit" aria-label="禁钓点位" />
      <text v-if="loading && !preview" class="caption" role="status">正在读取高德静态地图…</text>
    </view>
    <view v-if="preview" class="mobile-action-group static-map-actions">
      <MobileAction
        class="secondary"
        :aria-disabled="!canZoom(-1) || undefined"
        aria-label="缩小静态地图"
        @click="changeZoom(-1)"
        >缩小</MobileAction
      >
      <MobileAction
        class="secondary"
        :aria-disabled="!canZoom(1) || undefined"
        aria-label="放大静态地图"
        @click="changeZoom(1)"
        >放大</MobileAction
      >
    </view>
    <text v-if="preview && loading" class="caption" role="status">正在更新地图…</text>
    <MobileLoadError
      v-if="error"
      :title="preview ? '未能更新地图' : '静态地图暂不可用'"
      :message="preview ? '仍可查看上一次的地图。' + error : error"
      @retry="load()"
    />
    <MobileAction v-else-if="!preview && !loading" class="secondary" @click="load()">{{
      auth.signedIn ? '加载静态地图' : '登录后查看地图'
    }}</MobileAction>
    <text class="caption"
      >高德提供底图 · 图片不能拖动选点{{
        area ? '，不代表实际下竿位置' : ''
      }}。完整保留地图标识，不作为可钓或通行依据。</text
    >
    <text v-if="circle" class="caption">圈线仅是钓友圈选的参考范围，不代表法定禁钓边界。</text>
  </view>
</template>
<style scoped>
.static-map-stage {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: var(--inset);
  border: 1px solid var(--line);
  overflow: hidden;
  text-align: center;
}
.static-map-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.static-map-image--incoming {
  opacity: 0;
}
.static-map-pin {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 44px;
  height: 48px;
  transform: translate(-50%, -100%);
  pointer-events: none;
}
.static-map-actions :deep(.mobile-action[aria-disabled='true']) {
  color: var(--reed);
  background: var(--inset);
}
</style>
