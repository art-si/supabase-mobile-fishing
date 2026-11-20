<script setup lang="ts">
defineOptions({ options: { styleIsolation: 'apply-shared' } })
import FishMark from './FishMark.vue'
defineProps<{
  species?: string
  method?: string
  bait?: string
  additives?: string
  weight?: number | null
  count?: number | null
  length?: number | null
  date?: string
  location?: string
}>()
</script>
<template>
  <view
    v-if="
      species ||
      method ||
      bait ||
      additives ||
      weight != null ||
      count != null ||
      length != null ||
      date ||
      location
    "
    class="fish-facts"
  >
    <view
      v-if="species || weight != null || count != null || length != null"
      class="fish-facts__species"
      ><FishMark :size="20" /><text class="fish-facts__main"
        >{{ species || '渔获' }}<template v-if="count != null"> · {{ count }} 尾</template
        ><template v-if="weight !== null && weight !== undefined"> · {{ weight }} kg</template
        ><template v-if="length != null">
          · {{ count != null && count > 1 ? '最长 ' : '' }}{{ length }} cm</template
        ></text
      ></view
    >
    <text v-if="method">钓法：{{ method }}</text>
    <text v-if="bait">饵料：{{ bait }}</text>
    <text v-if="additives">小药：{{ additives }}</text>
    <text v-if="date">{{ date }}</text
    ><text v-if="location">{{ location }}</text>
  </view>
</template>
