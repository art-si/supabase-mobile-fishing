<script setup lang="ts">
import { ref, watch } from 'vue'
import { onHide } from '@dcloudio/uni-app'
import { activateActionKey, preventActionKey } from '@mobile-core/action-keyboard'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileMapChooser from '@mobile-core/components/MobileMapChooser.vue'
import type { MapProvider } from '@mobile-core/map-links'
import { openPlaceMap } from '@/platforms/open-place'
import { useAuthStore } from '@/stores/auth'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
const props = withDefaults(
  defineProps<{
    label: string
    longitude?: number | null
    latitude?: number | null
    approximate?: boolean
    navigation?: boolean
    hint?: string
  }>(),
  { approximate: true, navigation: false }
)
const auth = useAuthStore(),
  visible = ref(false),
  fallback = ref(false),
  message = ref('')
let operation = 0
function close() {
  operation++
  visible.value = false
  fallback.value = false
  message.value = ''
}
watch(visible, (value) => {
  if (!value) operation++
})
watch(
  () => [
    auth.context,
    props.label,
    props.longitude,
    props.latitude,
    props.approximate,
    props.navigation
  ],
  close
)
onHide(close)
function choose() {
  operation++
  fallback.value = false
  message.value = ''
  visible.value = true
}
async function open(provider: MapProvider, webOnly: boolean) {
  const request = ++operation
  try {
    const result = await openPlaceMap(
      provider,
      {
        label: props.label,
        longitude: props.longitude,
        latitude: props.latitude,
        approximate: props.approximate,
        navigation: props.navigation
      },
      webOnly
    )
    if (request !== operation || !visible.value) return
    fallback.value = true
    message.value =
      result === 'copied'
        ? '地图链接已复制，可在手机浏览器打开；也可以复制地点到地图应用搜索。'
        : result === 'web'
          ? '已请求打开地图网页。'
          : '正在尝试打开地图应用；若没有打开，可选择网页版或复制地点。'
  } catch {
    if (request !== operation || !visible.value) return
    fallback.value = true
    message.value = '未能打开地图，可使用网页版或复制地点。'
  }
}
function copy() {
  const request = ++operation
  uni.setClipboardData({
    data: props.label,
    showToast: false,
    success: () => {
      if (request === operation && visible.value)
        message.value = '地点已复制，可粘贴到地图应用搜索。'
    },
    fail: () => {
      if (request === operation && visible.value) message.value = '复制失败，请长按地点文字复制。'
    }
  })
}
</script>
<template>
  <button
    class="mobile-action fishing-place-link"
    role="button"
    :tabindex="0"
    hover-class="mobile-action--pressed"
    :aria-label="`${navigation ? '导航到' : '在地图中查看'}：${label}`"
    @click="choose"
    @keydown="preventActionKey"
    @keyup="activateActionKey($event, choose)"
  >
    <MobileIcon name="location" :size="18" /><text class="fishing-place-link__label">{{
      label
    }}</text
    ><MobileIcon name="chevron" :size="16" />
  </button>
  <MobileMapChooser
    v-model="visible"
    :place="label"
    :title="navigation ? '地图导航' : '在地图中查看'"
    :hint="hint || (approximate ? '按发布者分享的地点搜索，请在地图中确认具体位置。' : undefined)"
    :fallback="fallback"
    :message="message"
    @open="open"
    @copy="copy"
  />
</template>
<style scoped>
.fishing-place-link.mobile-action {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 48px;
  padding: 4px 0;
  border-radius: 8px;
  text-align: left;
  color: var(--lake);
  font-size: var(--fishing-caption-size);
  line-height: 1.5;
}
.fishing-place-link__label {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
