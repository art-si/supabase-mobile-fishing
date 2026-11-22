<script setup lang="ts">
import { getCurrentInstance, ref, watch } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileConfirmDialog from '@mobile-core/components/MobileConfirmDialog.vue'
import { revealControl } from '@mobile-core/form-focus'
import FishingLoadingStatus from './FishingLoadingStatus.vue'
import { useAuthStore } from '@/stores/auth'
import type { EditSnapshot } from '@/domain/content-edit'
import type { Audience, ContentUpdateInfo } from '@/domain/models'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
const props = defineProps<{
  loading: boolean
  ready: boolean
  error: string
  conflict: boolean
  restored: boolean
  publication?: EditSnapshot['publication']
  update?: ContentUpdateInfo | null
  audience?: Audience
  directPublication?: boolean
}>()
const emit = defineEmits<{ reload: [discard: boolean] }>()
const confirm = ref(false),
  auth = useAuthStore(),
  nativeScope = getCurrentInstance()?.proxy
watch(
  () => props.conflict,
  (conflict) => {
    if (conflict) void revealControl('content-edit-conflict', { nativeScope })
  },
  { flush: 'post' }
)
watch(
  () => auth.context,
  () => {
    confirm.value = false
  }
)
</script>
<template>
  <FishingLoadingStatus v-if="loading" label="正在读取原记录…" />
  <view
    v-if="!directPublication && ready && publication?.status === 'published' && publication.audience !== 'private'"
    class="notice stack stack--tight"
    role="status"
  >
    <text class="name">{{
      audience === 'private'
        ? '保存后仅自己可见'
        : update?.status === 'rejected'
          ? '这次修改未通过审核'
          : update
            ? '正在编辑已提交的修改'
            : '修改通过审核后替换当前版本'
    }}</text>
    <text v-if="update?.status === 'rejected' && update.reason" class="caption">{{
      update.reason
    }}</text>
    <text class="caption">{{
      audience === 'private'
        ? '最新修改会直接保存为私人记录，其他钓友将不能继续访问这条分享。'
        : '当前展示的仍是已审核版本。收紧分享范围或隐藏坐标会立即生效。'
    }}</text>
  </view>
  <view v-if="conflict" id="content-edit-conflict" class="notice stack stack--tight" role="alert" tabindex="-1">
    <text class="name">这条记录已有新版本</text>
    <text class="caption">当前修改留在这个页面。请先复制需要的文字，再读取新版本继续编辑。</text>
    <MobileAction class="secondary" :disabled="loading" @click="confirm = true"
      >重新读取新版本</MobileAction
    >
  </view>
  <text v-else-if="restored" class="notice" role="status">已恢复这条记录未保存的修改。</text>
  <view v-if="error" class="stack stack--tight" role="alert">
    <text class="error">{{ error }}</text>
    <MobileAction v-if="!ready" class="secondary" :disabled="loading" @click="emit('reload', false)"
      >重试读取记录</MobileAction
    >
  </view>
  <MobileConfirmDialog
    v-model="confirm"
    title="读取新版本？"
    message="这会替换本机尚未保存的修改。已经保存的记录不受影响。"
    confirm-text="读取新版本"
    cancel-text="保留当前修改"
    destructive
    @confirm="emit('reload', true)"
  />
</template>
