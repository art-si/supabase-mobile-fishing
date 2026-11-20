<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import { LEGAL_CONTACT, LEGAL_VERSION, PRIVACY_SECTIONS, TERMS_SECTIONS } from '@/domain/legal'

const pageType = ref<'privacy' | 'terms' | 'contact'>('privacy')
const privacy = computed(() => pageType.value === 'privacy')
const contactOnly = computed(() => pageType.value === 'contact')
const title = computed(
  () =>
    ({
      privacy: '隐私说明',
      terms: '用户协议',
      contact: '联系与反馈'
    })[pageType.value]
)
const contactFeedback = ref('')
const sections = computed(() => (privacy.value ? PRIVACY_SECTIONS : TERMS_SECTIONS))

onLoad((options) => {
  const type = options?.type
  pageType.value = type === 'terms' || type === 'contact' ? type : 'privacy'
})

function copyText(label: string, value: string) {
  const feedback = contactFeedback
  feedback.value = ''
  uni.setClipboardData({
    data: value,
    showToast: false,
    success: () => {
      feedback.value = `${label}已复制`
    },
    fail: () => {
      feedback.value = '未能复制，请长按号码手动复制'
    }
  })
}
</script>

<template>
  <FishingShell :title="title" back>
    <view class="fishing-content stack legal-page">
      <view v-if="!contactOnly" class="legal-meta stack stack--tight">
        <text class="name">运营者：{{ LEGAL_CONTACT.operator }}</text>
        <text class="caption">版本日期：{{ LEGAL_VERSION }}</text>
        <text class="body">{{
          privacy
            ? '本说明介绍钓友集如何处理个人信息，以及你可以如何管理这些信息。'
            : '本协议说明使用钓友集时的基本规则、内容管理和联系途径。'
        }}</text>
      </view>

      <view v-if="!contactOnly" class="panel legal-reading">
        <view v-for="section in sections" :key="section.title" class="legal-section">
          <text class="heading" role="heading" aria-level="2">{{ section.title }}</text>
          <text v-for="paragraph in section.paragraphs" :key="paragraph" class="body" selectable>{{
            paragraph
          }}</text>
        </view>
      </view>

      <view class="panel stack legal-contact">
        <text class="heading" role="heading" aria-level="2">{{
          contactOnly ? '联系钓友集' : '联系运营者'
        }}</text>
        <text class="body"
          >运营者：{{
            LEGAL_CONTACT.operator
          }}。隐私请求、内容申诉和使用问题，可通过以下方式联系。</text
        >
        <view class="legal-contact-row">
          <text class="body" selectable>微信：{{ LEGAL_CONTACT.wechat }}</text>
          <MobileAction
            variant="link"
            aria-label="复制运营者微信号"
            @click="copyText('微信号', LEGAL_CONTACT.wechat)"
            >复制微信号</MobileAction
          >
        </view>
        <view class="legal-contact-row">
          <text class="body" selectable>QQ：{{ LEGAL_CONTACT.qq }}</text>
          <MobileAction
            variant="link"
            aria-label="复制运营者QQ号"
            @click="copyText('QQ号', LEGAL_CONTACT.qq)"
            >复制QQ号</MobileAction
          >
        </view>
        <view class="legal-feedback caption" role="status" aria-live="polite">{{
          contactFeedback
        }}</view>
        <text class="caption">请勿向任何联系人发送短信验证码、密码或无关的身份证明材料。</text>
      </view>
    </view>
  </FishingShell>
</template>

<style scoped>
.legal-meta {
  padding: 4px 0;
}

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
  font-size: max(16px, 1rem);
  line-height: 1.8;
  overflow-wrap: anywhere;
}

.legal-page .heading {
  font-size: max(20px, 1.25rem);
}

.legal-page .caption {
  font-size: max(14px, 0.875rem);
}

.legal-contact-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 16px;
}

.legal-page {
  max-width: 760px;
}

.legal-feedback {
  min-height: 1.5em;
}
</style>
