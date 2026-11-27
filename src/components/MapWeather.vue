<script setup lang="ts">

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileSkeleton from '@mobile-core/components/MobileSkeleton.vue'
import { getCurrentWeather } from '@/services/weather'
import {
  weatherIsStale,
  weatherTimeLabel,
  type CurrentWeather,
  type WeatherTarget
} from '@/domain/weather'
import { serviceErrorMessage } from '@/domain/user-errors'
import { useAuthStore } from '@/stores/auth'

defineOptions({ options: { styleIsolation: 'apply-shared' } })
const props = withDefaults(
  defineProps<{
    target: WeatherTarget
    active?: boolean
    staticMode?: boolean
  }>(),
  { active: true, staticMode: false }
)
const auth = useAuthStore()
const expanded = ref(false),
  loading = ref(false),
  error = ref('')
const weather = ref<CurrentWeather | null>(null),
  now = ref(Date.now())
const stale = computed(() => weather.value && weatherIsStale(weather.value, now.value))
let version = 0,
  disposed = false,
  receivedAt = 0
let clock: ReturnType<typeof setInterval> | undefined
function stopClock() {
  clearInterval(clock)
  clock = undefined
}
function reset() {
  version++
  expanded.value = false
  loading.value = false
  error.value = ''
  weather.value = null
  receivedAt = 0
  stopClock()
}
watch(() => JSON.stringify([props.target, props.active, auth.context, props.staticMode]), reset, {
  flush: 'sync'
})
async function load() {
  if (loading.value || disposed || !props.active || !expanded.value) return
  let needsSession = true
  // #ifdef H5
  needsSession = props.staticMode
  // #endif
  if (needsSession && !auth.requireLogin()) {
    reset()
    return
  }
  const current = ++version
  loading.value = true
  error.value = ''
  try {
    const result = await getCurrentWeather(props.target, props.staticMode)
    if (disposed || current !== version || !props.active) return
    weather.value = result
    now.value = receivedAt = Date.now()
  } catch (cause) {
    if (disposed || current !== version) return
    const code = (cause as { code?: string })?.code || (cause as Error)?.message
    error.value = serviceErrorMessage(code?.startsWith('WEATHER_') ? code : 'WEATHER_UNAVAILABLE')!
  } finally {
    if (!disposed && current === version) loading.value = false
  }
}
function toggle() {
  if (expanded.value) {
    version++
    expanded.value = false
    loading.value = false
    stopClock()
    return
  }
  expanded.value = true
  now.value = Date.now()
  clock = setInterval(() => {
    now.value = Date.now()
  }, 60000)
  if (!weather.value || error.value || now.value - receivedAt > 5 * 60000) void load()
}
onBeforeUnmount(() => {
  disposed = true
  reset()
})
</script>
<template>
  <view class="map-weather stack stack--tight">
    <MobileAction
      class="secondary weather-toggle"
      :aria-expanded="expanded"
      @click="toggle"
    >
      {{ expanded ? '收起天气' : '查看天气' }}
    </MobileAction>
    <view v-if="expanded" class="weather-details stack" :aria-busy="loading">
      <text class="caption"
        >{{ staticMode ? '选中地点' : '地图中心' }}所属城市／区县的天气，不是水面实测。</text
      >
      <view v-if="weather" class="stack stack--tight">
        <text class="name weather-region">{{ weather.city }}</text>
        <view class="weather-summary row row--wrap">
          <text class="weather-temperature">{{
            weather.temperature === null ? '气温暂无' : `${weather.temperature}°C`
          }}</text>
          <text>{{ weather.weather || '天气暂无' }}</text>
        </view>
        <view class="weather-facts">
          <text
            >{{ weather.windDirection || '风向暂无' }} ·
            {{ weather.windPower === null ? '风力暂无' : `${weather.windPower} 级` }}</text
          >
          <text>{{ weather.humidity === null ? '湿度暂无' : `湿度 ${weather.humidity}%` }}</text>
        </view>
        <text class="caption weather-time"
          >高德天气 · {{ weatherTimeLabel(weather) }}（北京时间）</text
        >
        <text v-if="stale" class="notice" role="status"
          >这份天气资料已较旧，请刷新核实，勿作为当前天气判断。</text
        >
      </view>
      <MobileSkeleton v-if="loading" label="正在查询天气…" />
      <MobileLoadError v-else-if="error" title="天气未能更新" :message="error" @retry="load" />
      <text v-if="error && weather" class="caption">上方保留的是上次结果，不是本次更新。</text>
      <MobileAction v-if="weather && !error" class="secondary" :disabled="loading" @click="load"
        >刷新天气</MobileAction
      >
    </view>
  </view>
</template>
<style scoped>
.map-weather {
  min-width: 0;
}
.weather-toggle {
  align-self: flex-start;
}
.weather-details {
  padding: 16px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 16px;
  overflow-wrap: anywhere;
}
.weather-summary {
  gap: 12px;
}
.weather-temperature {
  font-size: var(--fishing-value-size);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
}
.weather-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
}
.weather-time {
  font-variant-numeric: tabular-nums;
}
</style>
