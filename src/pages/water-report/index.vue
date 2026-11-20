<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onLoad, onShow, onHide, onUnload } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import FishingPhotos from '@/components/FishingPhotos.vue'
import ReportChannels from '@/components/ReportChannels.vue'
import ReportRegionFields from '@/components/ReportRegionFields.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileField from '@mobile-core/components/MobileField.vue'
import MobileSelect from '@mobile-core/components/MobileSelect.vue'
import MobileConfirmDialog from '@mobile-core/components/MobileConfirmDialog.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileDateTimeField from '@mobile-core/components/MobileDateTimeField.vue'
import MobileMediaUploader from '@mobile-core/components/MobileMediaUploader.vue'
import MobileSegmented from '@mobile-core/components/MobileSegmented.vue'
import ReportRecords from '@/components/ReportRecords.vue'
import type { MediaUploadEntry } from '@mobile-core/media-upload'
import {
  freshWaterReport,
  reportCategories,
  validateWaterReport,
  waterReportPayload,
  reportMaterial,
  localReportTime,
  hasWaterReportContent,
  waterReportDraftFromRecord,
  type WaterReport
} from '@/domain/water-report'
import { useAuthStore } from '@/stores/auth'
import { useDraftOwner } from '@/composables/useDraftOwner'
import { useMutation } from '@/composables/useMutation'
import { sessionScope, assertSession } from '@/services/session'
import { read, write } from '@/services/repository'
import { canRetryPhoto, uploadPhoto, uploadVideo, resolvePhotos } from '@/services/media'
import { canLocateReport,locateReport,describeReportLocation, type ReportLocation } from '@/platforms/report-location'
import { errorText, createId } from '@/domain/rules'
import { pickMap, consumeSelection } from '@/platforms/map-navigation'
import { isDemo } from '@/config'
import { updateWaterReportPayload } from '@/domain/report-edit'

const auth = useAuthStore(),
  draft = ref(freshWaterReport()),
  report = ref<WaterReport | null>(null),
  id = ref('')
const tab = ref('publish')
const tabs = [{ value: 'publish', label: '发布上报' }, { value: 'records', label: '我的上报记录' }]
const editing = ref<WaterReport | null>(null)
const recordsVersion = ref(0)
const recordsBusy=ref(false), editConflict=ref(false),reloadEditOpen=ref(false)
const storageNotice=ref('')
const currentPosition = ref<{ longitude: number; latitude: number } | null>(null)
const currentRegion=ref<{province:string;city:string;district:string}|null>(null)
let currentFix:ReportLocation|null=null
function rememberCurrentLocation(value:ReportLocation){
 currentFix={...value}
 currentPosition.value={longitude:value.longitude,latitude:value.latitude}
 currentRegion.value={province:value.province,city:value.city,district:value.district}
}
let applying = false, edited = false, formVersion = 0, initialized = false
let submitId = '', submitSignature = '', editBaseRevision=1
const consent = ref(false),
  copied = ref(''),
  errors = ref<Record<string, string>>({}),
  requestId = ref('')
const photos = ref<MediaUploadEntry[]>([]),
  copyOpen = ref(false)
const unfinishedMedia=new Map<string,{id:string;items:MediaUploadEntry[]}>()
function releaseLocalMedia(){
 const entries=new Set([...photos.value,...[...unfinishedMedia.values()].flatMap(value=>value.items)])
 entries.forEach(item=>item.release?.());unfinishedMedia.clear()
}
function rememberUnfinishedMedia(){
 if(!photos.value.some(item=>!item.asset))return
 edited=true
 unfinishedMedia.set(draftKey(),{id:draft.value.id,items:photos.value})
 try{uni.setStorageSync(draftKey(),{...draft.value,_edited:true,...(editing.value?{_baseRevision:editBaseRevision}:{})})}catch{storageNotice.value='本机草稿暂时无法保存，请不要关闭页面。'}
}
const uploader=ref<InstanceType<typeof MobileMediaUploader>>()
const locating=ref(false),locationMessage=ref('')
const observedDate=computed({get:()=>draft.value.observed_local.slice(0,10),set:value=>{draft.value.observed_local=value+' '+observedTime.value}})
const observedTime=computed({get:()=>draft.value.observed_local.slice(11,16),set:value=>{draft.value.observed_local=observedDate.value+' '+value}})
const channelsOpen = ref(false)
// Public directory filters never restore or expose an account's private report draft.
const publicRegion = ref({ province: '', city: '', district: '' })
const active = ref(true)
let locationVersion=0, locationAttempted=false
function cancelLocation(){locationVersion++;locating.value=false;locationMessage.value=''}
watch(draft,()=>{if(!applying)edited=true}, {deep:true,flush:'sync'})
watch(()=>[draft.value.province,draft.value.city,draft.value.district,draft.value.location_label,draft.value.longitude,draft.value.latitude],()=>{if(!applying)formVersion++},{flush:'sync'})
watch(publicRegion,()=>{if(!applying)formVersion++}, {deep:true,flush:'sync'})
onHide(() => {
  active.value = false
  cancelLocation()
  copyOpen.value = false
  reloadEditOpen.value = false
})
onUnload(() => {
  active.value = false
  cancelLocation()
  releaseLocalMedia()
})
const { busy, error, run } = useMutation()
const { owner, available, resetting } = useDraftOwner(() => {
  cancelLocation();locationAttempted=false
  currentPosition.value=null;currentRegion.value=null;currentFix=null;editing.value=null;initialized=false;edited=false;formVersion++
  releaseLocalMedia()
  applying=true;draft.value = freshWaterReport();applying=false
  photos.value = []
  consent.value = false
  requestId.value = ''
  errors.value = {}
  report.value = null
  if (id.value) void loadReport()
  else void prepareDraft()
})
const draftKey = () =>
  `dyj.${isDemo ? 'demo' : 'live'}.draft.${owner.value || 'guest'}.water-report${editing.value ? '.edit.'+editing.value.id : ''}`
watch(
  () => auth.context,
  () => {
    copyOpen.value = false
    reloadEditOpen.value=false
    copied.value = ''
    consent.value = false
  }
)
async function restore() {
  if (!available.value) return false
  const scope = sessionScope.value
  let found=false
  try {
    const existing = uni.getStorageSync(draftKey())
    if (existing?.id && hasWaterReportContent(existing)) {
      found=true
      applying=true
      const { _edited: ignored, _baseRevision, ...fields } = existing
      if(editing.value)editBaseRevision=Number(_baseRevision||1)
      editConflict.value=Boolean(editing.value && Number(_baseRevision||1)!==(editing.value.revision||1))
      draft.value = fields
      applying=false;edited=true
      await resolvePhotos([draft.value])
      assertSession(scope)
      const cached=unfinishedMedia.get(draftKey())
      photos.value = cached?.id===draft.value.id ? cached.items : draft.value.media.map((asset) => ({ key:`saved-${asset.id}`,path: asset.url || asset.path, kind:asset.kind||'image', asset,busy:false,error:'' }))
    }
  } catch {
    /* keep owner draft; unavailable photo can be removed and reselected */
  }
  return found
}
async function prepareDraft(){
 if(initialized)return
 initialized=true
 const restored=await restore()
 if(!restored){
  applying=true;draft.value={...freshWaterReport(),...(currentFix||{})};applying=false;edited=false
  locationMessage.value=currentFix?'已自动填入当前位置，可按实际事发地点修改。':''
 }
 if(!locationAttempted)void currentLocation(!restored && !id.value)
}
async function currentLocation(fillDraft=false){
 if(!canLocateReport || locating.value)return
 locationAttempted=true
 const current=++locationVersion,scope=sessionScope.value,locationOwner=auth.userId,draftId=draft.value.id,version=formVersion
 locating.value=true;locationMessage.value=''
 try{
  const value=await locateReport()
  if(current!==locationVersion || (scope!==sessionScope.value && Boolean(locationOwner || auth.userId)) || !active.value)return
  rememberCurrentLocation(value)
  if(version===formVersion){
   applying=true
   if(!available.value)Object.assign(publicRegion.value,{province:value.province,city:value.city,district:value.district})
   else if(fillDraft && draft.value.id===draftId && !id.value && !editing.value)Object.assign(draft.value,value)
   applying=false
   if(fillDraft)locationMessage.value='已自动填入当前位置，可按实际事发地点修改。'
  }
 }catch{
  if(current===locationVersion && active.value)locationMessage.value='暂未获取当前位置，可手动选择地区并填写具体地点。'
 }finally{if(current===locationVersion)locating.value=false}
}
async function loadReport() {
  if (busy.value) return
  const target=id.value
  report.value = null
  await run(async () => {
    const value=await read<WaterReport>('water_reports', { id: target })
    if(target===id.value && tab.value==='records' && active.value)report.value=value
  })
}
onLoad((options) => {
  id.value = options?.id || ''
  tab.value=id.value || options?.tab==='records'?'records':'publish'
  if (id.value) {void loadReport();void currentLocation()}
  else void prepareDraft()
})
watch(
  draft,
  () => {
    if (!available.value || resetting.value || (id.value && !editing.value)) return
    try {
      uni.setStorageSync(draftKey(), {...draft.value,_edited:edited,...(editing.value?{_baseRevision:editBaseRevision}:{})})
    } catch {
      error.value = '设备空间不足，文字草稿暂时无法保存'
    }
  },
  { deep: true }
)
onShow(() => {
  active.value = true
  if (!available.value) return
  if (id.value) {
    void loadReport()
    return
  }
  const selected = consumeSelection(requestId.value)
  if (selected && tab.value==='publish') {
    requestId.value = ''
    void applySelectedPlace(selected)
  }
})
async function applySelectedPlace(selected:{longitude:number;latitude:number;name:string}){
 formVersion++;const version=formVersion,scope=sessionScope.value,target=draft.value.id
 applying=true
 Object.assign(draft.value,{longitude:selected.longitude,latitude:selected.latitude,location_label:selected.name,province:'',city:'',district:''})
 applying=false;edited=true
 locationMessage.value='正在识别所选地点的省市区…'
 try{
  const value=await describeReportLocation([selected.longitude,selected.latitude])
  if(scope!==sessionScope.value || version!==formVersion || draft.value.id!==target || !active.value)return
  applying=true;Object.assign(draft.value,{province:value.province,city:value.city,district:value.district});applying=false
  locationMessage.value='已按所选地点更新省市区。'
 }catch{
  if(version===formVersion && active.value)locationMessage.value='所选地点已保留，请手动补充对应的省市区。'
 }
}
function selectLocation() {
  if (auth.requireLogin()) requestId.value = pickMap()
}
function clearLocation() {
  draft.value.longitude = null
  draft.value.latitude = null
}
function syncMedia() {
  draft.value.media = photos.value.flatMap((p) => (p.asset ? [p.asset] : []))
  delete errors.value.media
}
const uploadRecovery=(error:unknown)=>canRetryPhoto(error)?'retry' as const:'remove' as const
async function save() {
  if (!available.value || !auth.requireLogin()) return
  if(editConflict.value){error.value='这份材料已在其他地方更新，请先重新读取最新材料。你的编辑草稿仍保留。';return}
  errors.value = validateWaterReport(draft.value)
  if(photos.value.some(item=>!item.asset))errors.value.media='请等待附件上传完成，失败的附件可重试或移除。'
  if (!consent.value) errors.value.consent = '请先确认私密保存说明'
  if (Object.keys(errors.value).length) {
    uni.pageScrollTo({ scrollTop: 0, duration: 0 })
    return
  }
  const scope = sessionScope.value
  await run(async () => {
    assertSession(scope)
    const payload=waterReportPayload(draft.value)
    const signature=JSON.stringify(payload)
    if(signature!==submitSignature){submitSignature=signature;submitId=createId()}
    try{
      report.value = await write<WaterReport>(editing.value?'update_water_report':'save_water_report', editing.value ? updateWaterReportPayload(draft.value,editBaseRevision,submitId) : payload)
    }catch(failure){
      if((failure as {code?:string}).code==='EDIT_CONFLICT')editConflict.value=true
      throw failure
    }
    storageNotice.value=''
    unfinishedMedia.delete(draftKey())
    try{uni.removeStorageSync(draftKey())}catch{storageNotice.value='材料已保存，但本机草稿未能清理；请以后从“我的上报记录”查看最新内容。'}
    id.value = report.value.id
    editing.value=null;initialized=false;tab.value='records';recordsVersion.value++
    if(active.value)uni.pageScrollTo({scrollTop:0,duration:0})
  })
}
async function selectTab(value:string){
 if(busy.value||recordsBusy.value||uploader.value?.uploading||uploader.value?.choosing)return
 if(value==='records' && tab.value==='publish')rememberUnfinishedMedia()
 if(value==='records' && editing.value){await cancelEdit();return}
 tab.value=value;copyOpen.value=false
 if(value==='publish' && !editing.value && (id.value || !initialized)){
  id.value='';report.value=null;initialized=false;photos.value=[];consent.value=false
  await prepareDraft()
  if(!edited && currentPosition.value)void currentLocation(true)
 }
 if(value==='records'){report.value=null;id.value='';recordsVersion.value++}
}
function viewReport(value:WaterReport){report.value=value;id.value=value.id;tab.value='records';error.value='';uni.pageScrollTo({scrollTop:0,duration:0})}
function backToRecords(){report.value=null;id.value='';tab.value='records';recordsVersion.value++}
async function editReport(value:WaterReport){
 if(tab.value==='publish')rememberUnfinishedMedia()
 editConflict.value=false
 locationMessage.value=''
  editBaseRevision=value.revision||1
 editing.value=value;id.value='';report.value=null;tab.value='publish';consent.value=false;errors.value={};error.value=''
 applying=true;draft.value=waterReportDraftFromRecord(value);applying=false;edited=true;formVersion++
 photos.value=value.media.map(asset=>({key:`saved-${asset.id}`,path:asset.url||asset.path,kind:asset.kind||'image',asset,busy:false,error:''}))
 submitId='';submitSignature=''
 await restore()
 uni.pageScrollTo({scrollTop:0,duration:0})
}
async function cancelEdit(){
 if(busy.value||uploader.value?.uploading||uploader.value?.choosing)return
 rememberUnfinishedMedia()
 editing.value=null;editConflict.value=false;initialized=false;id.value='';report.value=null;photos.value=[];consent.value=false;errors.value={};error.value=''
 await prepareDraft();tab.value='records';recordsVersion.value++
}
async function reloadEdit(){
 const target=editing.value
 if(!target)return
 await run(async()=>{
  const latest=await read<WaterReport>('water_reports',{id:target.id})
  uni.removeStorageSync(draftKey())
  await editReport(latest)
 })
}
function copyMaterial() {
  if (!report.value || !available.value) return
  uni.setClipboardData({
    data: reportMaterial(report.value),
    showToast: false,
    success: () => {
      copied.value = '文字材料已复制。图片和视频需在官方渠道另外上传，尚未向管理单位发送。'
    },
    fail: () => {
      copied.value = '复制失败，请手动整理材料。'
    }
  })
}
</script>
<template>
  <FishingShell title="线索上报" back>
    <view class="fishing-content stack">
      <MobileSegmented :model-value="tab" :options="tabs" label="线索上报页面" :disabled="busy || recordsBusy || uploader?.uploading || uploader?.choosing" @update:model-value="selectTab" />
      <text v-if="storageNotice" class="notice" role="status">{{ storageNotice }}</text>
      <text v-if="isDemo" class="notice"
        >本机体验 · 材料只保存在本机，不上传云端、不联系官方。</text
      >
      <text v-if="tab==='publish'" class="notice"
        >先确保自身安全，不靠近、不阻拦。有人身危险时请联系当地警方。只描述亲眼所见，由主管单位核实。</text
      >
      <ReportRecords v-if="tab==='records' && !report" :key="`${auth.context}-${recordsVersion}`" @open="viewReport" @edit="editReport" @create="selectTab('publish')" @busy="recordsBusy=$event" />
      <template v-else-if="tab==='records' && available && report">
        <view class="mobile-action-group">
          <MobileAction class="secondary" @click="backToRecords">返回上报记录</MobileAction>
          <MobileAction class="secondary" @click="editReport(report)">编辑材料</MobileAction>
        </view>
        <view class="panel stack">
          <text class="heading">已私密保存</text>
          <text class="body"
            >保存不会自动发送给管理单位。通过下方官方渠道提交后，以官方回复为准。</text
          >
          <text class="name">{{
            reportCategories.find((c) => c.id === report!.category)?.name
          }}</text>
          <text class="caption"
            >{{ localReportTime(new Date(report.observed_at)) }} · {{ report.province }}
            {{ report.city }} {{ report.district }}</text
          >
          <text class="body">{{ report.location_label }}</text>
          <text class="body" selectable>{{ report.description }}</text>
          <FishingPhotos
            v-if="report.media.length"
            :media="report.media"
            label="私密线索附件"
            compact
          />
          <MobileAction class="primary" @click="copyOpen = true">复制文字材料</MobileAction>
          <text v-if="copied" class="notice" role="status">{{ copied }}</text>
        </view>
        <ReportChannels
          :province="report.province"
          :city="report.city"
          :district="report.district"
          :current-location="currentPosition"
          :report="report"
        />
      </template>
      <template v-else-if="tab==='publish' && available && !id">
        <view v-if="editing" class="panel stack stack--tight">
          <text class="name">编辑上报材料</text>
          <text class="caption">修改应用内这份材料，不会更新已通过外部渠道发送的副本。</text>
          <template v-if="editConflict">
            <text class="error" role="alert">这份材料已在其他地方更新。当前显示的是保留的编辑草稿，请重新读取最新材料后再保存。</text>
            <MobileAction class="secondary" :disabled="busy" @click="reloadEditOpen=true">重新读取最新材料</MobileAction>
          </template>
          <MobileAction class="text-action" :disabled="busy || uploader?.uploading || uploader?.choosing" @click="cancelEdit">返回记录，保留编辑草稿</MobileAction>
        </view>
        <view class="panel stack">
          <MobileField field="report-kind" label="疑似问题"
            ><MobileSelect
              v-model="draft.category"
              field="report-kind"
              label="疑似问题"
              placeholder="选择疑似问题"
              :options="reportCategories"
              :disabled="busy"
          /></MobileField>
          <text class="caption"
            >网捕不一定违法；是否符合禁渔、许可及网具规定，由主管部门判断。</text
          >
          <ReportRegionFields
            v-model:province="draft.province"
            v-model:city="draft.city"
            v-model:district="draft.district"
            :errors="errors"
            :disabled="busy"
            :current-region="currentRegion"
            @located="rememberCurrentLocation"
            required
          />
          <MobileField
            v-model="draft.location_label"
            field="report-place"
            label="具体水域与位置"
            :maxlength="200"
            :error="errors.location_label"
            :disabled="busy"
            placeholder="水库、湖泊、河段及附近标志物"
            required
          />
          <text v-if="locating || locationMessage" class="caption" role="status">{{ locating ? '正在获取当前位置…' : locationMessage }}</text>
          <!-- #ifdef H5 -->
          <MobileAction class="secondary" :disabled="busy" @click="selectLocation"
            >高德定位／选点</MobileAction
          >
          <!-- #endif -->
          <!-- #ifdef MP-WEIXIN -->
          <MobileAction class="secondary" :disabled="busy" @click="selectLocation"
            >高德地点搜索选点</MobileAction
          >
          <!-- #endif -->
          <text class="caption">{{
            draft.longitude === null
              ? '未提供坐标。定位不可用时，可手填详细地点；不会自动追踪位置。'
              : `已选位置：${draft.longitude}, ${draft.latitude}。请确认是事发地点。`
          }}</text>
          <MobileAction v-if="draft.longitude !== null" class="text-action" :disabled="busy" @click="clearLocation"
            >清除坐标，保留文字地点</MobileAction
          >
          <MobileDateTimeField v-model:date="observedDate" v-model:time="observedTime" field="report-time" label="事发时间" :error="errors.observed_local" :disabled="busy" required />
          <text class="caption">{{ editing ? '保留原事发时间，可按实际情况修改。' : '默认当前时间，请按实际事发时间调整。' }}</text>
          <MobileField
            v-model="draft.description"
            field="report-description"
            label="现场情况"
            multiline
            :maxlength="2000"
            show-count
            :error="errors.description"
            :disabled="busy"
            placeholder="看到什么工具、行为、人数及持续时间；不确定的内容请注明，不要猜测身份。"
            required
          />
        </view>
        <view class="panel stack">
          <view class="row row--between"><text class="name">现场图片 / 视频</text><text class="caption">{{ photos.length }} / 6</text></view>
        <view class="stack stack--tight">
          <MobileAction
            class="text-action report-consent"
            role="checkbox"
            :aria-checked="consent"
            :disabled="busy"
            @click="consent = !consent"
            ><view class="report-consent__box" aria-hidden="true"
              ><wd-checkbox
                :model-value="consent"
                type="circle"
                :readonly="true"
                checked-color="var(--lake)"
                unchecked-color="var(--reed)"
                custom-style="--wot-checkbox-icon-size:22px;pointer-events:none;" /></view
            ><text>{{
              isDemo
                ? '我确认将体验材料保存在本机'
                : '我确认将文字、所选坐标、图片和视频私密保存到钓友集云端'
            }}</text></MobileAction
          >
          <text v-if="!isDemo" class="caption"
            >材料将私密保存到钓友集，主要存储在中国大陆境外的德国法兰克福。材料不进入社区，也不会自动发给任何外部单位。请勿上传无关人员隐私。</text
          >
          <text v-if="errors.consent" class="error" role="alert">{{ errors.consent }}</text>
          <MobileAction
            class="text-action"
            @click="uni.navigateTo({ url: '/pages/settings/legal?type=privacy' })"
            >查看隐私说明</MobileAction
          >
        </view>

          <MobileMediaUploader ref="uploader" v-model="photos" :scope="auth.context" :active="active" :accept="['image','video']" :limit="6" :max-image-bytes="8*1024*1024" :max-video-bytes="20*1024*1024" :upload-image="uploadPhoto" :upload-video="uploadVideo" :error-text="errorText" :recovery="uploadRecovery" :disabled="busy || !consent" upload-label="添加图片 / 视频" @change="syncMedia" />
          <text v-if="!consent" class="caption">确认上方私密保存说明后，可添加图片和视频。</text>
          <text v-if="errors.media" class="error" role="alert">{{ errors.media }}</text>
          <text class="caption">最多 6 项，图片每张 8MB、视频每段 20MB。可选常见图片和视频格式，添加后自动处理并私密上传；请保留手机原片。</text>
        </view>
        <MobileAction class="primary" :disabled="busy || uploader?.uploading || editConflict" @click="save">{{
          busy ? '正在保存材料…' : editing ? '保存修改' : '私密保存，选择官方渠道'
        }}</MobileAction>
        <text class="caption">文字草稿自动保存在当前账号本机。保存成功不等于举报送达。</text>
        <MobileAction
          class="text-action"
          :aria-expanded="channelsOpen"
          @click="channelsOpen = !channelsOpen"
          >{{ channelsOpen ? '收起官方渠道' : '先查看官方举报渠道' }}</MobileAction
        >
        <ReportChannels
          v-if="channelsOpen"
          :province="draft.province"
          :city="draft.city"
          :district="draft.district"
          :current-location="currentPosition"
        />
      </template>
      <view v-else-if="tab==='publish' && !available" class="stack">
        <view class="panel stack">
          <text class="name">事发地区</text>
          <text class="caption">选择事发地，优先显示当地官方渠道。</text>
          <ReportRegionFields
            v-model:province="publicRegion.province"
            v-model:city="publicRegion.city"
            v-model:district="publicRegion.district"
            :current-region="currentRegion"
            @located="rememberCurrentLocation"
          />
        </view>
        <ReportChannels
          :province="publicRegion.province"
          :city="publicRegion.city"
          :district="publicRegion.district"
          :current-location="currentPosition"
        />
        <text class="caption">需要保存图片、视频和现场记录，可登录后私密保存。</text>
        <MobileAction class="secondary" @click="auth.requireLogin()">手机号登录</MobileAction>
      </view>
      <text v-if="error" class="error" role="alert">{{ error }}</text>
      <MobileAction
        v-if="id && !report && available"
        class="secondary"
        :disabled="busy"
        @click="loadReport"
        >{{ busy ? '正在读取材料…' : '重新读取材料' }}</MobileAction
      >
    </view>
    <MobileConfirmDialog v-model="reloadEditOpen" title="使用最新材料？" message="将用最新保存的材料替换当前编辑草稿。若需保留补充内容，请先复制相关文字。" confirm-text="使用最新材料" :destructive="false" @confirm="reloadEdit" />
    <MobileConfirmDialog
      v-model="copyOpen"
      title="复制私密材料？"
      message="文字和你提供的精确坐标会进入系统剪贴板。请只粘贴到核验过的官方渠道，图片和视频不会一同复制。"
      confirm-text="复制文字材料"
      :destructive="false"
      @confirm="copyMaterial"
    />
  </FishingShell>
</template>
<style scoped>
.report-consent.mobile-action {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  text-align: left;
  white-space: normal;
  color: var(--ink);
  min-height: 48px;
  line-height: 1.5;
}
.report-consent__box {
  box-sizing: border-box;
  flex: 0 0 22px;
  height: 1.5em;
  min-height: 22px;
  display: grid;
  place-items: center;
  pointer-events: none;
}
</style>
