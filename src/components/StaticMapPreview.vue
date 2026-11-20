<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileLoadingStatus from '@/components/FishingLoadingStatus.vue'
import { getStaticPreview } from '@/services/amap'
import { errorText } from '@/domain/rules'
import { useAuthStore } from '@/stores/auth'
import type { MapPreviewTarget } from '@/domain/map'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
const props = withDefaults(
  defineProps<{ target: MapPreviewTarget; area?: boolean; automatic?: boolean }>(),
  { automatic: false }
)
const auth = useAuthStore(),
  image = ref(''),
  error = ref(''),
  loading = ref(false),
  zoom = ref(14)
const circle = computed(() => 'radiusM' in props.target && !!props.target.radiusM)
let version = 0,
  disposed = false
async function load() {
  if (loading.value || !auth.requireLogin()) return
  const current = ++version
  loading.value = true
  error.value = ''
  image.value = ''
  try {
    const result = await getStaticPreview(props.target, zoom.value)
    if (disposed || current !== version) return
    image.value = result.image
    zoom.value = result.zoom
  } catch (e) {
    if (!disposed && current === version) error.value = errorText(e)
  } finally {
    if (!disposed && current === version) loading.value = false
  }
}
function changeZoom(delta: number) {
  zoom.value = Math.max(8, Math.min(props.area ? 11 : 17, zoom.value + delta))
  void load()
}
watch(
  () => JSON.stringify([props.target, props.area, auth.context]),
  () => {
    version++
    loading.value = false
    image.value = ''
    error.value = ''
    zoom.value = props.area ? 11 : 14
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
    <image
      v-if="image && !error"
      class="static-map-image"
      :src="image"
      mode="aspectFit"
      :aria-label="
        circle
          ? '高德静态地图上的圈选参考范围，不是官方边界'
          : area
            ? '高德大致水域静态地图，不可据此导航'
            : '高德地点静态预览，不可拖动选点'
      "
      @error="error = '图片显示失败，请重新加载地图'"
    />
    <MobileLoadingStatus v-if="loading" label="正在读取高德静态地图…" />
    <MobileLoadError v-else-if="error" title="静态地图暂不可用" :message="error" @retry="load" />
    <MobileAction v-else-if="!image" class="secondary" @click="load">{{
      auth.signedIn ? '加载静态地图' : '登录后查看地图'
    }}</MobileAction>
    <view v-if="image && !error" class="mobile-action-group">
      <MobileAction
        class="secondary"
        :disabled="loading || zoom <= 8"
        aria-label="缩小静态地图"
        @click="changeZoom(-1)"
        >缩小</MobileAction
      >
      <MobileAction
        class="secondary"
        :disabled="loading || zoom >= (area ? 11 : 17)"
        aria-label="放大静态地图"
        @click="changeZoom(1)"
        >放大</MobileAction
      >
    </view>
    <text class="caption"
      >高德提供底图 · 图片不能拖动选点{{
        area ? '，不代表实际下竿位置' : ''
      }}。完整保留地图标识，不作为可钓或通行依据。</text
    >
    <text v-if="circle" class="caption">圈线仅是钓友圈选的参考范围，不代表法定禁钓边界。</text>
  </view>
</template>
<style scoped>
.static-map-image {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  height: auto;
  background: var(--inset);
  border: 1px solid var(--line);
}
</style>
