<script setup lang="ts">
import { ref, watch } from 'vue'
import { onShow, onHide, onUnload } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import FishMark from '@/components/FishMark.vue'
import FishingThemePicker from '@/components/FishingThemePicker.vue'
import ReportEmailContactSheet from '@/components/ReportEmailContactSheet.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileField from '@mobile-core/components/MobileField.vue'
import MobileBottomSheet from '@mobile-core/components/MobileBottomSheet.vue'
import MobileConfirmDialog from '@mobile-core/components/MobileConfirmDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { useMutation } from '@/composables/useMutation'
import { isDemo } from '@/config'
import {
  sessionRequest,
  saveSession,
  clearPrivateDrafts,
  sessionScope,
  sessionNotice
} from '@/services/session'
import { moderation } from '@/services/moderation'
import { rememberedLogin } from '@/services/login-memory'
const auth = useAuthStore(),
  { busy, error, run } = useMutation(),
  deletion = ref(false),
  logoutOpen = ref(false),
  confirmText = ref('')
const canReview = ref(false), emailContactOpen = ref(false), emailContactNotice = ref('')
let accessVersion = 0
function clearAccess() {
  accessVersion++
  canReview.value = false
}
async function checkAccess() {
  clearAccess()
  if (!auth.signedIn || isDemo) return
  const current = accessVersion
  try {
    const result = await moderation<{ allowed: boolean }>('access')
    if (current === accessVersion) canReview.value = result.allowed
  } catch {
    /* Capability checks fail closed without interrupting ordinary settings. */
  }
}
onShow(() => {
  void checkAccess()
})
onHide(clearAccess)
onUnload(clearAccess)
watch(
  () => auth.context,
  () => {
    deletion.value = false
    logoutOpen.value = false
    confirmText.value = ''
    void checkAccess()
  }
)
async function logout() {
  await run(async () => {
    const result = await auth.signOut()
    if (!result.warning && result.scope === sessionScope.value)
      uni.reLaunch({ url: '/pages/home/index' })
  })
}
async function deleteAccount() {
  await run(async () => {
    if (confirmText.value !== '注销') throw new Error('请填写“注销”确认')
    if (isDemo) throw new Error('体验模式没有线上账号，不执行账号注销。可以退出体验。')
    const owner = auth.userId
    await sessionRequest('/functions/v1/account-delete', {
      method: 'POST',
      data: { confirmation: 'DELETE_MY_ACCOUNT' }
    })
    const draftsCleared = clearPrivateDrafts(owner)
    let memoryCleared = true
    try {
      await rememberedLogin.forgetOwner(owner)
    } catch {
      memoryCleared = false
    }
    const sessionCleared = await saveSession(null)
    if (!draftsCleared || !sessionCleared || !memoryCleared)
      sessionNotice.value = '线上账号已注销，但本机存储未能完全清理。请清除此应用的网站数据。'
    deletion.value = false
    uni.reLaunch({ url: '/pages/home/index' })
  })
}
</script>
<template>
  <FishingShell title="设置与隐私" back
    ><view class="fishing-content stack">
      <FishingThemePicker />
      <view v-if="auth.signedIn" class="panel fishing-menu">
        <MobileAction class="list-row" @click="emailContactOpen = true">
          <MobileIcon name="message" :size="22" />
          <view class="settings-nav-copy"><text class="name">我的邮箱资料</text><text class="caption">官方渠道邮件联系</text></view>
          <MobileIcon class="settings-link-arrow" name="chevron" :size="16" />
        </MobileAction>
        <MobileAction v-if="!isDemo" class="list-row" @click="uni.navigateTo({ url: '/pages/notifications/index?settings=1' })">
          <MobileIcon name="message" :size="22" />
          <view class="settings-nav-copy"><text class="name">通知设置</text><text class="caption">点赞 · 评论与回复</text></view>
          <MobileIcon class="settings-link-arrow" name="chevron" :size="16" />
        </MobileAction>
        <MobileAction v-if="!isDemo" class="list-row" @click="uni.navigateTo({ url: '/pages/account/security' })">
          <MobileIcon name="shield" :size="22" />
          <view class="settings-nav-copy"><text class="name">账号与安全</text><text class="caption">手机号 · 密码</text></view>
          <MobileIcon class="settings-link-arrow" name="chevron" :size="16" />
        </MobileAction>
        <MobileAction v-if="canReview" class="list-row" @click="uni.navigateTo({ url: '/pages/moderation/index' })">
          <MobileIcon name="shield" :size="22" />
          <view class="settings-nav-copy"><text class="name">内容审核</text><text class="caption">待审内容</text></view>
          <MobileIcon class="settings-link-arrow" name="chevron" :size="16" />
        </MobileAction>
      </view>
      <text v-if="emailContactNotice" class="notice" role="status">{{ emailContactNotice }}</text>
      <view class="panel stack settings-privacy"
        ><text class="name">位置隐私</text
        ><text class="muted"
          >新建动态和钓位默认公开，保存前可调整谁可以看。钓位展示精确位置，出钓日志仅自己可见。</text
        ></view
      >
      <view class="panel fishing-menu"
        ><MobileAction
          class="list-row"
          @click="uni.navigateTo({ url: '/pages/settings/legal?type=privacy' })"
          ><MobileIcon name="shield" :size="22" /><text class="grow name">隐私说明</text
          ><MobileIcon class="settings-link-arrow" name="chevron" :size="16" /></MobileAction
        ><MobileAction
          class="list-row"
          @click="uni.navigateTo({ url: '/pages/settings/legal?type=terms' })"
          ><MobileIcon name="document" :size="22" /><text class="grow name">用户协议</text
          ><MobileIcon class="settings-link-arrow" name="chevron" :size="16" /></MobileAction
        ><MobileAction
          class="list-row"
          @click="uni.navigateTo({ url: '/pages/contact/index' })"
          ><MobileIcon name="message" :size="22" /><text class="grow name">联系与反馈</text
          ><MobileIcon class="settings-link-arrow" name="chevron" :size="16" /></MobileAction
      ></view>
      <template v-if="auth.signedIn"
        ><MobileAction class="secondary" :disabled="busy" @click="logoutOpen = true">{{
          isDemo ? '退出本机体验' : '退出登录'
        }}</MobileAction
        ><MobileAction
          v-if="!isDemo"
          class="text-action settings-delete"
          :disabled="busy"
          @click="deletion = true"
          >注销账号</MobileAction
        ></template
      ><text v-if="error" class="error" role="alert">{{ error }}</text
      ><view class="settings-brand">
        <FishMark :size="32" tone="muted" />
        <text class="caption">钓友集 0.1.0</text>
      </view> </view
    ><MobileBottomSheet
      v-model="deletion"
      title="注销钓友集账号"
      close-label="取消注销"
      :busy="busy"
      ><view class="stack fishing-sheet-content"
        ><text class="body"
          >注销将删除你的资料、发布、日志、钓位、上传图片、私密上报材料，也会清除旧版好友和聊天记录。此操作不可撤销。对方已保存的截图无法追回。</text
        ><text class="muted"
          >为保护账号，需要最近 5 分钟内用手机号重新验证。注销未完成时，账号会保留。</text
        ><MobileField
          v-model="confirmText"
          field="delete-confirmation"
          label="输入“注销”确认"
        /><text v-if="error" class="error">{{ error }}</text
        ><MobileAction
          class="danger"
          :disabled="busy || confirmText !== '注销'"
          @click="deleteAccount"
          >永久注销账号</MobileAction
        ></view
      ></MobileBottomSheet
    ><MobileConfirmDialog
      v-model="logoutOpen"
      :title="isDemo ? '退出本机体验？' : '退出登录？'"
      message="退出会清除这台设备上当前账号未提交的鱼情、钓位和水域线索草稿。已保存的记录不会删除，其他设备不受影响。"
      confirm-text="清除草稿并退出"
      @confirm="logout"
  /><ReportEmailContactSheet v-model="emailContactOpen" @saved="emailContactNotice = '邮箱资料已保存在本机'" @cleared="emailContactNotice = '本机邮箱资料已清除'" /></FishingShell>
</template>

<style scoped>
.settings-link-arrow {
  color: var(--reed);
  flex: none;
}
.settings-nav-copy {
  flex: 1;
  min-inline-size: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 12px;
}
.settings-privacy {
  padding: var(--fishing-gap) var(--fishing-inset);
  gap: 4px;
}
.fishing-content :deep(.mobile-action.settings-delete) {
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: var(--danger);
  min-height: 48px;
}
.settings-brand {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
}
</style>
