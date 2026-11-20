<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onHide } from '@dcloudio/uni-app'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import { activateActionKey, preventActionKey } from '@mobile-core/action-keyboard'
import MobileConfirmDialog from '@mobile-core/components/MobileConfirmDialog.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import FishingPhotos from './FishingPhotos.vue'
import { useResource } from '@/composables/useResource'
import { useMutation } from '@/composables/useMutation'
import { useAuthStore } from '@/stores/auth'
import { read, write } from '@/services/repository'
import { reportCategories, localReportTime, type WaterReport } from '@/domain/water-report'

defineOptions({ options: { styleIsolation: 'apply-shared' } })
const emit=defineEmits<{open:[report:WaterReport];edit:[report:WaterReport];create:[];busy:[value:boolean]}>()
const auth=useAuthStore(), mutation=useMutation(), confirm=ref(false),target=ref<WaterReport|null>(null)
const storageNotice=ref('')
const {data,error,loading,load}=useResource(async()=>auth.userId?read<{items:WaterReport[]}>('water_reports'):{items:[]},{items:[]} as {items:WaterReport[]})
onMounted(()=>void load())
watch(()=>auth.context,()=>{confirm.value=false;target.value=null})
watch(mutation.busy,value=>emit('busy',value))
onHide(()=>{confirm.value=false;target.value=null})
onBeforeUnmount(()=>{confirm.value=false;target.value=null;emit('busy',false)})
function askRemove(report:WaterReport){target.value=report;confirm.value=true}
async function remove(){
 const selected=target.value
 const owner=auth.userId
 if(!selected)return
 await mutation.run(async()=>{
  await write('delete_water_report',{id:selected.id})
  try{
   uni.removeStorageSync(`dyj.live.draft.${owner}.water-report.edit.${selected.id}`)
   uni.removeStorageSync(`dyj.demo.draft.${owner}.water-report.edit.${selected.id}`)
  }catch{storageNotice.value='这份材料已删除，本机遗留草稿未能清理，不会恢复云端记录。'}
  target.value=null
  await load()
 })
}
</script>
<template>
  <view class="stack report-records">
    <text class="caption">仅你可见。可查看、编辑和删除；官方受理情况以官方渠道回复为准。</text>
    <template v-if="!auth.userId">
      <text class="notice">登录后查看你私密保存的上报记录。</text>
      <MobileAction class="primary" @click="auth.requireLogin()">手机号登录</MobileAction>
    </template>
    <template v-else>
      <MobileLoadError v-if="error" :message="error" @retry="load" />
      <text v-if="loading" class="caption" role="status">正在读取上报记录…</text>
      <view v-for="item in data.items" :key="item.id" class="panel stack report-records__item">
        <button class="mobile-action report-records__content" role="button" :tabindex="mutation.busy.value ? -1 : 0" :aria-disabled="mutation.busy.value || undefined" hover-class="mobile-action--pressed" aria-label="查看详情" :disabled="mutation.busy.value" @click="emit('open',item)" @keydown="preventActionKey" @keyup="activateActionKey($event, () => { if (!mutation.busy.value) emit('open',item) })">
          <text class="name">{{ reportCategories.find(category=>category.id===item.category)?.name }}</text>
          <text class="caption">{{ localReportTime(new Date(item.observed_at)) }} · 私密保存</text>
          <text class="body">{{ item.location_label }}</text>
          <text class="caption report-records__description">{{ item.description }}</text>
        </button>
        <FishingPhotos v-if="item.media.length" :media="item.media" label="上报记录附件" compact />
        <view class="mobile-action-group">
          <MobileAction class="secondary" :disabled="mutation.busy.value" @click="emit('edit',item)">编辑材料</MobileAction>
          <MobileAction class="danger" :disabled="mutation.busy.value" @click="askRemove(item)">删除材料</MobileAction>
        </view>
      </view>
      <template v-if="!loading && !error && !data.items.length">
        <text class="notice">还没有保存的上报记录。</text>
        <MobileAction class="secondary" @click="emit('create')">记录水域线索</MobileAction>
      </template>
      <text v-if="data.items.length" class="caption">显示最近 100 条。删除不会撤回已通过外部渠道发送的材料。</text>
      <text v-if="mutation.error.value" class="error" role="alert">{{ mutation.error.value }}</text>
      <text v-if="storageNotice" class="notice" role="status">{{ storageNotice }}</text>
    </template>
    <MobileConfirmDialog v-model="confirm" title="删除这份材料？" message="将删除应用内的文字、位置和附件访问权限，无法恢复。已发送给官方的材料或下载副本不会删除。" confirm-text="删除材料" @confirm="remove" />
  </view>
</template>
<style scoped>
.report-records__description { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.report-records__content.mobile-action { display: grid; gap: 6px; width: 100%; padding: 0; text-align: left; background: transparent; color: var(--ink); white-space: normal; border-radius: 0; }
</style>
