<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
// Preserve old internal links without embedding web-view for a personal Mini Program.
onLoad((options) => {
  uni.redirectTo({
    url: `/pages/map/search?pick=${options?.pick === '1' ? '1' : '0'}&requestId=${encodeURIComponent(options?.requestId || '')}`
  })
})
</script>
<template>
  <FishingShell title="地点搜索" back
    ><view class="fishing-content">正在打开地点搜索…</view></FishingShell
  >
</template>
