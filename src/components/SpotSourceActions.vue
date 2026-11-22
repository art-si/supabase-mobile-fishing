<script setup lang="ts">
defineOptions({ options: { styleIsolation: 'apply-shared' } })
import { ref } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import { openExternalPage } from '@/platforms/open-external-page'
import { leadSourceName, type LeadSource } from '../../supabase/functions/_shared/discovery-contract'

defineProps<{ sources: readonly LeadSource[] }>()
const feedback = ref('')
let sourceAction = '打开'
// #ifndef H5
sourceAction = '复制'
// #endif

async function followSource(url: string) {
  feedback.value = ''
  try {
    if (await openExternalPage(url) === 'copied') feedback.value = '原文链接已复制。'
  } catch {
    feedback.value = '暂时无法打开原文链接。'
  }
}
</script>

<template>
  <view v-if="sources.length" class="stack stack--tight">
    <view class="row row--wrap">
      <MobileAction v-for="source in sources" :key="source.url" class="text-action"
        :aria-label="sourceAction + leadSourceName(source) + '原文'" @click="followSource(source.url)">
        {{ leadSourceName(source) }}原文
      </MobileAction>
    </view>
    <text v-if="feedback" class="caption" role="status" aria-live="polite">{{ feedback }}</text>
  </view>
</template>
