<script setup lang="ts">
import MobileAvatarEditor from '@mobile-core/components/MobileAvatarEditor.vue'
import FishMark from './FishMark.vue'
import { useAuthStore } from '@/stores/auth'
import { uploadPhoto, resolvePhotos, canRetryPhoto } from '@/services/media'
import { errorText } from '@/domain/rules'
import type { Media } from '@/domain/models'
import type { UploadOptions } from '@mobile-core/upload-progress'
import { normalizeHeifImage } from '@/platforms/heif-image'

defineProps<{ nickname?: string; disabled?: boolean }>()
const avatar = defineModel<Media | null>({ default: null })
const emit = defineEmits<{ busy: [value: boolean] }>()
const auth = useAuthStore()
async function upload(path: string, options: UploadOptions) {
  const asset = await uploadPhoto(path, options)
  await resolvePhotos([{ media: [asset] }])
  return asset
}
function message(error: unknown) {
  return errorText(error).replace('照片未上传，正文已保留；请重试或移除该照片', '头像未上传，请重试或重新选择')
}
function recovery(error: unknown): 'login' | 'retry' | 'remove' {
  if (error && typeof error === 'object' && (('status' in error && error.status === 401) ||
    ('code' in error && ['NOT_AUTHENTICATED', 'AUTH_REQUIRED', 'SESSION_EXPIRED'].includes(String(error.code))))) return 'login'
  return canRetryPhoto(error) ? 'retry' : 'remove'
}
</script>

<template>
  <view class="profile-avatar-field">
    <MobileAvatarEditor v-model="avatar" :name="nickname" :scope="auth.context" :disabled="disabled"
      :upload="upload" :normalize-unsupported-image="normalizeHeifImage" :error-text="message" :recovery="recovery" @busy="emit('busy', $event)"
      @login="uni.navigateTo({ url: '/pages/login/index' })"><FishMark :size="44" /></MobileAvatarEditor>
    <text class="caption">头像会公开显示。点击“保存资料”后生效。</text>
  </view>
</template>

<style scoped>
.profile-avatar-field { display: grid; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
</style>
