<script setup lang="ts">
import { reactive, ref, watch, computed, onBeforeUnmount, getCurrentInstance, nextTick } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import MobileField from '@mobile-core/components/MobileField.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileMultiChoice from '@mobile-core/components/MobileMultiChoice.vue'
import FishingCityPicker from '@/components/FishingCityPicker.vue'
import ProfileAvatarEditor from '@/components/ProfileAvatarEditor.vue'
import MobileConfirmDialog from '@mobile-core/components/MobileConfirmDialog.vue'
import { revealControl } from '@mobile-core/form-focus'
import { fishingMethodOptions } from '@/domain/fishing-presets'
import MobileSkeleton from '@mobile-core/components/MobileSkeleton.vue'
import { useAuthStore } from '@/stores/auth'
import { useMutation } from '@/composables/useMutation'
import { read, write } from '@/services/repository'
import { returnToHomeTab } from '@/services/primary-navigation'
import type { PersonDetail, Media } from '@/domain/models'
import { errorText } from '@/domain/rules'
const auth = useAuthStore(),
  form = reactive({ nickname: '', city: '', bio: '', method: '' }),
  baseline = ref(''),
  ready = ref(false),
  loading = ref(false),
  { busy, error, run } = useMutation()
const avatar = ref<Media | null>(null), avatarBusy = ref(false)
const nicknameError = ref(''), nativeScope = getCurrentInstance()?.proxy
watch(()=>form.nickname,()=>{if(form.nickname.trim())nicknameError.value=''})
let version = 0
let draftOwner = auth.userId
let confirmResult: ((leave:boolean)=>void)|undefined
const discard = ref(false)
const signature = () => JSON.stringify({ nickname: form.nickname, city: form.city, bio: form.bio, method: form.method, avatar: avatar.value?.id || null })
const dirty = computed(() => ready.value && signature() !== baseline.value)
async function reload() {
  const current = ++version
  if (!auth.signedIn) return
  loading.value = true
  error.value = ''
  try {
    const result = await read<PersonDetail>('profile', { id: auth.userId })
    if (current !== version || dirty.value || avatarBusy.value) return
    Object.assign(form, result.profile)
    avatar.value = result.profile.avatar || null
    baseline.value = signature()
    ready.value = true
  } catch (e) {
    if (current === version) error.value = errorText(e)
  } finally {
    if (current === version) loading.value = false
  }
}
onShow(() => { if (auth.signedIn && !avatarBusy.value && (!ready.value || !dirty.value)) void reload() })
watch(
  () => auth.context,
  () => {
    version++
    loading.value = false
    avatarBusy.value = false
    // Expiry and reauthentication must not erase this owner's unfinished edits.
    if (!auth.userId || auth.userId === draftOwner) {
      if (auth.signedIn && !ready.value) void reload()
      return
    }
    draftOwner = auth.userId
    Object.assign(form, { nickname: '', city: '', bio: '', method: '' })
    avatar.value = null; avatarBusy.value = false
    ready.value = false
    nicknameError.value = ''
    loading.value = false
    void reload()
  },
  { flush: 'sync' }
)
function confirmBack():Promise<boolean> {
  if (busy.value || avatarBusy.value) return Promise.resolve(false)
  if (!dirty.value) return Promise.resolve(true)
  discard.value = true
  return new Promise(resolve => { confirmResult = resolve })
}
function finishBack(leave:boolean){confirmResult?.(leave);confirmResult=undefined}
onBeforeUnmount(()=>{version++;finishBack(false)})
async function save() {
  if (!auth.requireLogin() || !ready.value || avatarBusy.value) return
  if (!form.nickname.trim()) {
    nicknameError.value='请填写昵称'
    await nextTick()
    await revealControl('nickname',{nativeScope})
    return
  }
  await run(async () => {
    const scope = auth.context
    await write('update_profile', {
      nickname: form.nickname.trim(),
      city: form.city,
      bio: form.bio,
      method: form.method,
      avatar_id: avatar.value?.id ?? null
    })
    if (scope !== auth.context) return
    baseline.value = signature()
    returnToHomeTab('mine')
  })
}
</script>
<template>
  <FishingShell title="编辑资料" back :confirm-back="confirmBack"
    ><view class="fishing-content stack"
      ><MobileSkeleton v-if="loading" label="正在读取资料…" />
      <view v-if="auth.signedIn && ready" :key="auth.context" class="panel stack"
        ><ProfileAvatarEditor v-model="avatar" :nickname="form.nickname" :disabled="busy" @busy="avatarBusy = $event" /><MobileField
          v-model="form.nickname"
          field="nickname"
          label="昵称"
          :error="nicknameError"
          :disabled="busy"
          :maxlength="30"
          required /><MobileField
          field="profile-city"
          label="常驻城市"
          hint="可选，保存后展示在个人主页。"
        ><FishingCityPicker v-model="form.city" field="profile-city" label="选择常驻城市" placeholder="选择城市（可选）" clearable :disabled="busy" /></MobileField><MobileMultiChoice
          v-model="form.method"
          field="method"
          label="喜欢的钓法"
          :options="fishingMethodOptions"
          :max-selected="6"
          :maxlength="40"
          placeholder="选择钓法（可多选）"
          :disabled="busy" /><MobileField
          v-model="form.bio"
          field="bio"
          label="一句话介绍自己"
          :disabled="busy"
          multiline
          :maxlength="200"
          show-count /></view
      ><text class="notice">这里只展示你愿意公开的资料。手机号不在个人主页显示。</text
      ><text v-if="error" class="error" role="alert">{{ error }}</text
      ><MobileAction v-if="auth.signedIn && !ready && !loading" class="secondary" @click="reload"
        >重新读取资料</MobileAction
      >
      <MobileAction v-if="auth.signedIn" class="primary" :disabled="busy || avatarBusy || !ready" @click="save">{{
        busy ? '正在保存…' : '保存资料'
      }}</MobileAction
      ><MobileAction v-else class="primary" @click="auth.requireLogin()"
        >手机号登录</MobileAction
      ></view
    ><MobileConfirmDialog v-model="discard" title="放弃这次修改？" message="头像和资料的修改还没有保存。" confirm-text="放弃修改" cancel-text="继续编辑" @confirm="finishBack(true)" @cancel="finishBack(false)" /></FishingShell
  >
</template>
