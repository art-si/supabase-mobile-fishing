<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
const target = ref('')
const failed = ref(false)

function openSearch() {
  failed.value = false
  uni.redirectTo({ url: target.value, fail: () => { failed.value = true } })
}

// Preserve old internal links without embedding web-view for a personal Mini Program.
onLoad((options) => {
  const pick = options?.pick === '1'
  const context = options?.context === 'post' || options?.context === 'water' ? `&context=${options.context}` : ''
  target.value = pick
    ? `/pages/map/search?pick=1&requestId=${encodeURIComponent(options?.requestId || '')}${context}`
    : '/pages/map/search'
  openSearch()
})
</script>
<template>
  <FishingShell title="地点搜索" back>
    <view class="fishing-content">
      <MobileLoadError
        v-if="failed"
        title="无法打开地点搜索"
        message="可以重试，或返回上一页。"
        @retry="openSearch"
      />
      <text v-else class="muted" role="status">正在打开地点搜索…</text>
    </view>
  </FishingShell>
</template>
