<script setup lang="ts">

import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileImagePreview from '@mobile-core/components/MobileImagePreview.vue'
import { LEGAL_CONTACT } from '@/domain/legal'

let imageRoot = '/pages/contact/static'
// #ifdef H5
imageRoot = `${import.meta.env.BASE_URL}${import.meta.env.DEV ? 'src/' : ''}pages/contact/static`
// #endif
const group = { title: '钓友集微信群', detail: '11 月 28 日前有效', image: `${imageRoot}/wechat-group.png` }
const personal = { title: '个人微信', detail: '12345上山打老虎', image: `${imageRoot}/wechat-personal.jpg` }
const groupExpiresAt = Date.parse('2026-11-28T00:00:00+08:00')
const groupAvailable = ref(Date.now() < groupExpiresAt)
const codes = computed(() => groupAvailable.value ? [group, personal] : [personal])
const viewer = ref<InstanceType<typeof MobileImagePreview>>()
const feedback = ref('')

function refreshGroupValidity() {
  groupAvailable.value = Date.now() < groupExpiresAt
}
onShow(refreshGroupValidity)

function preview(code: typeof group) {
  refreshGroupValidity()
  if (code.image === group.image && !groupAvailable.value) return
  viewer.value?.open([code.image], `${code.title}二维码`)
}

function copyNumber(label: string, value: string) {
  feedback.value = ''
  uni.setClipboardData({
    data: value,
    showToast: false,
    success: () => { feedback.value = `${label}已复制` },
    fail: () => { feedback.value = '未能复制，请长按号码手动复制' }
  })
}
</script>

<template>
  <FishingShell title="联系与反馈" back without-location>
    <view class="fishing-content stack contact-page">
      <view class="contact-codes">
        <MobileAction
          v-for="code in codes"
          :key="code.image"
          class="panel contact-code"
          :aria-label="`查看${code.title}二维码`"
          @click="preview(code)"
        >
          <view class="row">
            <text class="grow name">{{ code.title }}</text>
            <MobileIcon name="chevron" :size="16" />
          </view>
          <image class="contact-code__image" :src="code.image" mode="aspectFit" show-menu-by-longpress aria-hidden="true" />
          <text class="caption">{{ code.detail }}</text>
        </MobileAction>
      </view>
      <text v-if="!groupAvailable" class="caption">群二维码已到期，可通过个人微信联系入群。</text>

      <view class="panel contact-details">
        <text class="body">使用问题、隐私请求和内容申诉可联系运营者{{ LEGAL_CONTACT.operator }}。</text>
        <view class="contact-detail-row">
          <text class="body" selectable>微信：{{ LEGAL_CONTACT.wechat }}</text>
          <MobileAction variant="link" aria-label="复制运营者微信号" @click="copyNumber('微信号', LEGAL_CONTACT.wechat)">复制微信号</MobileAction>
        </view>
        <view class="contact-detail-row">
          <text class="body" selectable>QQ：{{ LEGAL_CONTACT.qq }}</text>
          <MobileAction variant="link" aria-label="复制运营者QQ号" @click="copyNumber('QQ号', LEGAL_CONTACT.qq)">复制QQ号</MobileAction>
        </view>
        <text class="caption" role="status" aria-live="polite">{{ feedback }}</text>
        <text class="caption">请勿向任何联系人发送短信验证码、密码或无关的身份证明材料。</text>
      </view>
      <MobileImagePreview ref="viewer" />
    </view>
  </FishingShell>
</template>

<style scoped>
.contact-codes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 8.25rem), 1fr));
  gap: var(--fishing-gap);
}
.contact-code.mobile-action {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--fishing-gap-small);
  padding: var(--fishing-gap);
  white-space: normal;
  text-align: start;
}
.contact-code__image {
  display: block;
  width: 100%;
  height: clamp(132px, 44vw, 200px);
}
.contact-details {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: var(--fishing-inset);
}
.contact-detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0 var(--fishing-gap);
  border-bottom: 1px solid var(--line);
}
.contact-details > .caption:last-child {
  margin-top: var(--fishing-gap-small);
}
</style>
