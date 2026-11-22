<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import { PRIVACY_SECTIONS, TERMS_SECTIONS } from '@/domain/legal'

const pageType = ref<'privacy' | 'terms' | 'contact'>('privacy')
const title = computed(
  () =>
    ({
      privacy: '隐私说明',
      terms: '用户协议',
      contact: '联系与反馈'
    })[pageType.value]
)
const sections = computed(() => (pageType.value === 'terms' ? TERMS_SECTIONS : PRIVACY_SECTIONS))

function openContact() {
  uni.redirectTo({ url: '/pages/contact/index' })
}

onLoad((options) => {
  const type = options?.type
  pageType.value = type === 'terms' || type === 'contact' ? type : 'privacy'
  if (pageType.value === 'contact') openContact()
})
</script>

<template>
  <FishingShell :title="title" back without-location>
    <view class="fishing-content stack legal-page">
      <MobileAction v-if="pageType === 'contact'" class="secondary" @click="openContact">打开联系与反馈</MobileAction>
      <view v-else class="panel legal-reading">
        <view v-for="section in sections" :key="section.title" class="legal-section">
          <text class="heading" role="heading" aria-level="2">{{ section.title }}</text>
          <text v-for="paragraph in section.paragraphs" :key="paragraph" class="body" selectable>{{
            paragraph
          }}</text>
        </view>
      </view>
    </view>
  </FishingShell>
</template>

<style scoped>
.legal-reading {
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.legal-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.legal-page .body {
  font-size: max(16px, var(--fishing-text-size));
  line-height: 1.8;
  overflow-wrap: anywhere;
}

.legal-page .heading {
  font-size: var(--fishing-heading-size);
}

.legal-page {
  max-width: 760px;
}
</style>
