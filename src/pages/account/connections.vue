<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileConfirmDialog from '@mobile-core/components/MobileConfirmDialog.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import { useAuthStore } from '@/stores/auth'
import { socialAccounts, type SocialAccount } from '@/services/discovery'
import { errorText } from '@/domain/rules'
import { platforms, type Platform } from '../../../supabase/functions/_shared/discovery-contract'
// #ifdef H5
import { Capacitor } from '@capacitor/core'
// #endif

const auth = useAuthStore()
const accounts = ref<SocialAccount[]>([])
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const selection = ref<Platform>()
const confirm = ref(false)
const selectedName = computed(() => selection.value ? platforms[selection.value] : '')
let version = 0
let canBind = false
// #ifdef H5
canBind = !Capacitor.isNativePlatform() && window.isSecureContext
// #endif

function reset() {
  version++
  loading.value = false
  busy.value = confirm.value = false
  accounts.value = []
  error.value = notice.value = ''
  selection.value = undefined
}
watch(() => auth.context, reset, { flush: 'sync' })
onScopeDispose(reset)

async function load() {
  if (busy.value) return
  await auth.hydrate()
  const current = ++version
  if (!auth.signedIn) {
    loading.value = false
    return
  }
  loading.value = true
  error.value = ''
  try {
    // #ifdef H5
    try {
      await completeBinding(current)
    } catch (failure) {
      if (current === version) error.value = errorText(failure)
    }
    // #endif
    if (current !== version) return
    const rows = await socialAccounts<SocialAccount[]>('list')
    if (current === version) accounts.value = rows
  } catch (failure) {
    if (current === version) error.value = errorText(failure)
  } finally {
    if (current === version) loading.value = false
  }
}
onShow(() => void load())

// #ifdef H5
const pendingKey = 'dyj.social.pending'
const returnKey = 'dyj.social.return'
const authOrigins: Record<Platform, string> = {
  douyin: 'https://open.douyin.com',
  toutiao: 'https://open.snssdk.com',
  bilibili: 'https://account.bilibili.com'
}
async function completeBinding(current: number) {
  const returned = sessionStorage.getItem(returnKey)
  if (returned === null) return
  sessionStorage.removeItem(returnKey)
  const query = new URLSearchParams(returned)
  const pending = JSON.parse(sessionStorage.getItem(pendingKey) || 'null')
  if (!canBind || !pending || pending.owner !== auth.userId || !pending.state ||
      query.get('state') !== pending.state || !Object.hasOwn(platforms, pending.platform))
    throw new Error('本次授权已失效，请重新发起绑定。')
  sessionStorage.removeItem(pendingKey)
  const code = query.get('code')
  if (!code || query.has('error')) throw new Error('本次授权未完成。')
  await socialAccounts('finish', { platform: pending.platform, code, state: pending.state })
  if (current === version) notice.value = '绑定成功。'
}
// #endif

async function bind(platform: Platform) {
  if (busy.value || !canBind) return
  // #ifdef H5
  const current = version
  busy.value = true
  error.value = notice.value = ''
  try {
    const { url, state } = await socialAccounts<{ url: string; state: string }>('start', { platform })
    if (current !== version) return
    const target = new URL(url)
    if (target.origin !== authOrigins[platform]) throw new Error('暂时无法打开授权页面。')
    sessionStorage.removeItem(returnKey)
    sessionStorage.setItem(pendingKey, JSON.stringify({ state, platform, owner: auth.userId }))
    window.location.assign(target.href)
  } catch (failure) {
    if (current === version) error.value = errorText(failure)
  } finally {
    if (current === version) busy.value = false
  }
  // #endif
}

function askUnlink(platform: Platform) {
  selection.value = platform
  confirm.value = true
}
async function unlink() {
  const platform = selection.value
  if (!platform || busy.value) return
  const current = version
  busy.value = true
  error.value = notice.value = ''
  try {
    await socialAccounts('unlink', { platform })
    if (current === version) {
      accounts.value = accounts.value.map(row => row.platform === platform
        ? { ...row, boundAt: null }
        : row)
      notice.value = '已解绑' + platforms[platform] + '。'
    }
  } catch (failure) {
    if (current === version) error.value = errorText(failure)
  } finally {
    if (current === version) busy.value = false
  }
}
</script>

<template>
  <FishingShell title="第三方账号" back narrow>
    <view class="fishing-content account-content">
      <text v-if="loading" class="caption" role="status">正在读取账号绑定…</text>
      <MobileAction v-else-if="!auth.signedIn" class="primary" @click="auth.requireLogin()">登录后管理绑定</MobileAction>
      <template v-else>
        <text v-if="!canBind && accounts.some(row => row.available)" class="caption">绑定请在钓友集网页版完成。</text>
        <view v-if="accounts.length" class="account-list">
          <view v-for="account in accounts" :key="account.platform" class="list-row connection-row">
            <view class="account-row-copy">
              <text class="name">{{ platforms[account.platform] }}</text>
              <text class="caption">{{ account.boundAt ? '已绑定' : account.available ? '未绑定' : '暂不可绑定' }}</text>
            </view>
            <MobileAction v-if="account.boundAt" class="text-action" :aria-label="'解绑' + platforms[account.platform]"
              :disabled="busy" @click="askUnlink(account.platform)">解绑</MobileAction>
            <MobileAction v-else-if="account.available && canBind" class="text-action"
              :aria-label="'绑定' + platforms[account.platform]" :disabled="busy" @click="bind(account.platform)">绑定</MobileAction>
          </view>
        </view>
        <text v-if="notice" class="caption" role="status">{{ notice }}</text>
        <MobileLoadError v-if="error && !busy" title="账号绑定暂未加载" :message="error" @retry="load" />
      </template>
    </view>
    <MobileConfirmDialog v-model="confirm" :title="'解除' + selectedName + '绑定？'"
      message="解绑后可以重新授权。仍可使用手机号或钓友号登录钓友集。"
      confirm-text="解绑" @confirm="unlink" />
  </FishingShell>
</template>

<style scoped>
.connection-row { min-height: 56px; flex-wrap: wrap; column-gap: 12px; }
.connection-row .account-row-copy { margin-inline-end: auto; }
</style>
