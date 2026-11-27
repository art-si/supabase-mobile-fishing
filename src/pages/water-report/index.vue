<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { onLoad, onShow, onHide, onUnload, onReachBottom } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import FishingPrimaryNav from '@/components/FishingPrimaryNav.vue'
import { returnToHomeTab } from '@/services/primary-navigation'
import FishingPhotos from '@/components/FishingPhotos.vue'
import ReportChannels from './ReportChannels.vue'
import ReportRegionFields from '@/components/ReportRegionFields.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileField from '@mobile-core/components/MobileField.vue'
import MobileSelect from '@mobile-core/components/MobileSelect.vue'
import MobileConfirmDialog from '@mobile-core/components/MobileConfirmDialog.vue'
import MobileDateTimeField from '@mobile-core/components/MobileDateTimeField.vue'
import MobileMediaUploader from '@mobile-core/components/MobileMediaUploader.vue'
import { preserveMediaPickerPage, resumeMediaPickerPage } from '@mobile-core/media-picker-session'
import MobileSegmented from '@mobile-core/components/MobileSegmented.vue'
import ReportRecords from '@/components/ReportRecords.vue'
import { useListRefresh } from '@/composables/useListRefresh'
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
import { errorText, createId, validCoordinates } from '@/domain/rules'
import { pickMap, consumeSelection } from '@/platforms/map-navigation'
import { formatMapCoordinates } from '@/domain/map'
import { regionLabel, type RegionNames } from '@/domain/regions'
import { updateWaterReportPayload } from '@/domain/report-edit'
import { waterAt } from '@/platforms/water-location'

const auth = useAuthStore(),
  draft = ref(freshWaterReport()),
  report = ref<WaterReport | null>(null),
  id = ref('')
const tab = ref('publish')
const tabs = [{ value: 'publish', label: '发布上报' }, { value: 'records', label: '我的上报记录' }]
const editing = ref<WaterReport | null>(null)
const recordsVersion = ref(0)
const records = ref<InstanceType<typeof ReportRecords>>()
const contactDirectory=ref<InstanceType<typeof ReportChannels>>()
const agencyPickerOpen = ref(false)
const submissionReport = computed(() => contactDirectory.value?.submissionReport || report.value)
const submissionNextStep = computed(() => {
  const options = contactDirectory.value?.agencies || []
  const first = options[0]?.channel
  if (!first) return '请按事发地主管部门公布的方式提交。'
  if (draft.value.category === 'other') {
    const choices = options.flatMap(({ channel }) => channel.issueLabel ? [`「${channel.issueLabel}」`] : []).join('或')
    if (!choices) return '请选择受理该问题的主管部门。'
    return `请按现场情况选择${choices}，到官网提交。`
  }
  if (first.kind === 'website') return `可到「${first.name}」填写并提交。`
  if (first.province && first.kind === 'phone') return `可联系${first.name}，按当地官方方式提交。`
  return '可拨打全国渔政举报热线，也可在微信「中国渔政」提交。'
})
onReachBottom(() => records.value?.reachBottom())
const recordsBusy=ref(false), editConflict=ref(false),reloadEditOpen=ref(false)
useListRefresh(() => records.value?.refresh(), () => tab.value === 'records' && !recordsBusy.value)
const storageNotice=ref('')
const currentPosition = ref<{ longitude: number; latitude: number } | null>(null)
const currentRegion=ref<{province:string;city:string;district:string}|null>(null)
function rememberCurrentLocation(value:ReportLocation){
 currentPosition.value={longitude:value.longitude,latitude:value.latitude}
 currentRegion.value={province:value.province,city:value.city,district:value.district}
}
let applying = false, edited = false, formVersion = 0, initialized = false, prepared = false
let mounted = false, pageOptionsLoaded = false, preparation = 0
let submitId = '', submitSignature = '', editBaseRevision=1
const copied = ref(''),
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
const locating=ref(false),locationMessage=ref(''),locationError=ref('')
const selectedRegion=ref<ReportLocation|null>(null)
let pinLookup=0
const incidentPoint=computed(()=>{
  const place=tab.value==='records' ? report.value : draft.value
  if(place?.longitude==null || place.latitude==null || !validCoordinates(place.longitude,place.latitude))return null
  return {longitude:place.longitude,latitude:place.latitude}
})
const resolvedRegion=computed(()=>{
  const place=selectedRegion.value, point=incidentPoint.value
  return point && place?.longitude===point.longitude && place.latitude===point.latitude ? place : null
})
const coordinatesText = computed(() => {
  const { longitude, latitude } = draft.value
  return longitude != null && latitude != null && validCoordinates(longitude, latitude)
    ? formatMapCoordinates(longitude, latitude) : ''
})
const observedDate=computed({get:()=>draft.value.observed_local.slice(0,10),set:value=>{draft.value.observed_local=value+' '+observedTime.value}})
const observedTime=computed({get:()=>draft.value.observed_local.slice(11,16),set:value=>{draft.value.observed_local=observedDate.value+' '+value}})
const tabbed = ref(false)
// Public directory filters never restore or expose an account's private report draft.
const publicRegion = ref({ province: '', city: '', district: '' })
const active = ref(false)
let locationVersion=0, locationAttempted=false
function cancelLocation(){locationVersion++;locating.value=false;locationMessage.value='';locationError.value=''}
function canFillCurrentRegion(){
 const value=draft.value
 return !id.value && !editing.value &&
  ![value.province,value.city,value.district].some(value=>value?.trim())
}
function resumeCurrentLocation(){
 if(!mounted || !prepared || !active.value || locating.value || tab.value!=='publish' || id.value || editing.value)return
 const fill=canFillCurrentRegion()
 if(currentRegion.value && fill && !validCoordinates(draft.value.longitude,draft.value.latitude)){
  applying=true;Object.assign(draft.value,currentRegion.value);applying=false
  return
 }
 if(!currentRegion.value || fill)void currentLocation(fill)
}
watch(draft,()=>{if(!applying)edited=true}, {deep:true,flush:'sync'})
watch(()=>[draft.value.province,draft.value.city,draft.value.district],(_next,previous)=>{
 if(applying || !previous[0] || !previous[1] || !validCoordinates(draft.value.longitude,draft.value.latitude))return
 pinLookup++;selectedRegion.value=null
 Object.assign(draft.value,{longitude:null,latitude:null})
 locationMessage.value='事发地区已更改，请重新选择水域。'
},{flush:'sync'})
watch(()=>[draft.value.province,draft.value.city,draft.value.district,draft.value.location_label,draft.value.longitude,draft.value.latitude],()=>{if(!applying)formVersion++},{flush:'sync'})
watch(publicRegion,()=>{if(!applying)formVersion++}, {deep:true,flush:'sync'})
onHide(() => {
  // #ifdef MP-WEIXIN
  if (preserveMediaPickerPage()) return
  // #endif
  active.value = false
  cancelLocation()
  copyOpen.value = false
  agencyPickerOpen.value = false
  reloadEditOpen.value = false
})
onUnload(() => {
  active.value = false
  mounted = false;preparation++
  cancelLocation()
  releaseLocalMedia()
})
const { busy, error, run } = useMutation()
const { owner, available, resetting } = useDraftOwner(() => {
  cancelLocation();locationAttempted=false
  currentPosition.value=null;currentRegion.value=null;editing.value=null;initialized=false;prepared=false;edited=false;formVersion++
  releaseLocalMedia()
  applying=true;draft.value = freshWaterReport();applying=false
  photos.value = []
  pinLookup++;selectedRegion.value=null
  requestId.value = ''
  errors.value = {}
  report.value = null
  if (id.value) void loadReport()
  else void prepareDraft()
})
const draftKey = () =>
  `dyj.live.draft.${owner.value || 'guest'}.water-report${editing.value ? '.edit.'+editing.value.id : ''}`
watch(
  () => auth.context,
  () => {
    copyOpen.value = false
    reloadEditOpen.value=false
    copied.value = ''
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
 initialized=true;prepared=false
 const current=++preparation,scope=sessionScope.value,draftOwner=owner.value
 const restored=await restore()
 if(current!==preparation || scope!==sessionScope.value || draftOwner!==owner.value)return
 if(!restored){
  applying=true;draft.value={...freshWaterReport(),...currentRegion.value};applying=false;edited=false
  locationMessage.value=''
 }
 prepared=true
 resumeCurrentLocation()
}
async function currentLocation(fillDraft=false){
 if(!canLocateReport || locating.value)return
 locationAttempted=true
 const current=++locationVersion,scope=sessionScope.value,locationOwner=auth.userId,draftId=draft.value.id,version=formVersion
 const point=fillDraft && canFillCurrentRegion() && validCoordinates(draft.value.longitude,draft.value.latitude)
  ? [draft.value.longitude!,draft.value.latitude!] as [number,number] : undefined
 locating.value=true;locationMessage.value='';locationError.value=''
 try{
  const value=await locateReport()
  if(current!==locationVersion || (scope!==sessionScope.value && Boolean(locationOwner || auth.userId)) || !active.value)return
  rememberCurrentLocation(value)
  // A retained incident point belongs to its own region, even when the user is elsewhere now.
  const draftRegion=point?await describeReportLocation(point):value
  if(current!==locationVersion || (scope!==sessionScope.value && Boolean(locationOwner || auth.userId)) || !active.value)return
  if(version===formVersion){
   applying=true
   if(!available.value){
    if(!Object.values(publicRegion.value).some(value=>value.trim()))Object.assign(publicRegion.value,currentRegion.value)
   }
   else if(fillDraft && canFillCurrentRegion() && draft.value.id===draftId)Object.assign(draft.value,{province:draftRegion.province,city:draftRegion.city,district:draftRegion.district})
   applying=false
  }
  // Resolve a default only for a blank new incident. A location lookup must never
  // overwrite a typed description, a saved pin, or a different chosen region.
  const blankWater=()=>available.value && !id.value && !editing.value &&
   !draft.value.location_label.trim() && !validCoordinates(draft.value.longitude,draft.value.latitude) &&
   (['province','city','district'] as const).every(key=>!draft.value[key] || draft.value[key]===value[key])
  if(version===formVersion && blankWater()){
   try{
    const water=await waterAt([value.longitude,value.latitude])
    const area=await describeReportLocation([water.longitude,water.latitude])
    if(current!==locationVersion || scope!==sessionScope.value || !active.value ||
     draft.value.id!==draftId || version!==formVersion || !blankWater())return
    applying=true
    Object.assign(draft.value,{province:area.province,city:area.city,district:area.district,
     longitude:water.longitude,latitude:water.latitude,location_label:water.name})
    selectedRegion.value=area
    applying=false
   }catch{
    // Region-only reporting remains available when no verified nearby water exists.
   }
  }
 }catch(failure){
  if(current===locationVersion && active.value){
   const code=(failure as {code?:unknown}|null)?.code
   locationError.value=typeof code==='string'&&/^[A-Z][A-Z0-9_]{1,63}$/.test(code)?code:''
   locationMessage.value=code==='MAP_QUOTA_EXCEEDED'?'地区查询暂时繁忙，请稍后重试或手动选择事发地区。':'暂未获取当前位置，请选择事发地区。'
  }
 }finally{if(current===locationVersion)locating.value=false}
}
// Read-only acceptance state: no body, attachments, account ID or coordinates are exposed.
defineExpose({reportLocationState:()=>({mounted,prepared,initialized,active:active.value,locationAttempted,
 locating:locating.value,locationError:locationError.value,locationMessage:locationMessage.value,
 region:{province:draft.value.province,city:draft.value.city,district:draft.value.district},
 regionCached:Boolean(currentRegion.value),hasLocationLabel:Boolean(draft.value.location_label?.trim()),
 hasPoint:validCoordinates(draft.value.longitude,draft.value.latitude),ownerReady:available.value,formVersion})})
async function loadReport() {
  if (busy.value) return
  const target=id.value
  report.value = null
  await run(async () => {
    const value=await read<WaterReport>('water_reports', { id: target })
    if(target===id.value && tab.value==='records' && active.value)report.value=value
  })
}
function loadPage(options?:Record<string,string|undefined>){
  pageOptionsLoaded=true
  tabbed.value = options?.tabbed === '1'
  id.value = options?.id || ''
  tab.value=id.value || options?.tab==='records'?'records':'publish'
  if (id.value) void loadReport()
  else void prepareDraft()
}
onLoad(loadPage)
onMounted(() => {
  mounted=true
  // Native first onShow can precede the Vue page's initial mount/onLoad delivery.
  if(!pageOptionsLoaded){
    const page=(typeof getCurrentPages==='function'?getCurrentPages().at(-1):undefined) as {options?:Record<string,string|undefined>}|undefined
    loadPage(page?.options)
  }
  resumeCurrentLocation()
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
  // #ifdef MP-WEIXIN
  if (resumeMediaPickerPage()) return
  // #endif
  if (!available.value) {resumeCurrentLocation();return}
  if (id.value) {
    void loadReport()
    return
  }
  const selected = consumeSelection(requestId.value)
  if (selected && tab.value==='publish') {
    requestId.value = ''
    void applySelectedPlace(selected)
    return
  }
  resumeCurrentLocation()
})
async function applySelectedPlace(selected:{longitude:number;latitude:number;name:string}, region?:RegionNames){
 cancelLocation()
 formVersion++;const version=++pinLookup,scope=sessionScope.value,target=draft.value.id
 selectedRegion.value=null
 applying=true
 Object.assign(draft.value,{longitude:selected.longitude,latitude:selected.latitude,location_label:selected.name},region || {province:'',city:'',district:''})
 delete errors.value.location
 delete errors.value.location_label
 applying=false;edited=true
 if(region){
  selectedRegion.value={...selected,...region,location_label:selected.name}
  delete errors.value.province
  delete errors.value.city
  locationMessage.value=''
  return
 }
 locationMessage.value='正在识别所选地点的省市区…'
 try{
  const value=await describeReportLocation([selected.longitude,selected.latitude])
  if(scope!==sessionScope.value || version!==pinLookup || draft.value.id!==target ||
    draft.value.longitude!==selected.longitude || draft.value.latitude!==selected.latitude)return
  selectedRegion.value=value
  applying=true;Object.assign(draft.value,{province:value.province,city:value.city,district:value.district});applying=false
  delete errors.value.province
  delete errors.value.city
  delete errors.value.district
  locationMessage.value=''
 }catch{
  if(version===pinLookup && scope===sessionScope.value && draft.value.id===target)locationMessage.value='请确认所选水域的省市区。'
 }
}
function selectLocation() {
  if (auth.requireLogin()) requestId.value = pickMap('water')
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
    await nextTick()
    if (active.value && scope === sessionScope.value) {
      uni.pageScrollTo({scrollTop:0,duration:0})
      agencyPickerOpen.value = true
    }
  })
}
async function selectTab(value:string){
 if(busy.value||recordsBusy.value||uploader.value?.uploading||uploader.value?.choosing)return
 if(value==='records' && tab.value==='publish')rememberUnfinishedMedia()
 if(value==='records' && editing.value){await cancelEdit();return}
 tab.value=value;copyOpen.value=false
 if(value==='publish' && !editing.value && (id.value || !initialized)){
  id.value='';report.value=null;initialized=false;photos.value=[]
  await prepareDraft()
  if(!edited && currentPosition.value)void currentLocation(true)
 }
 if(value==='records'){report.value=null;id.value='';recordsVersion.value++}
}
function viewReport(value:WaterReport){report.value=value;id.value=value.id;tab.value='records';error.value='';uni.pageScrollTo({scrollTop:0,duration:0})}
watch(()=>report.value?.id,()=>{copied.value='';copyOpen.value=false;agencyPickerOpen.value=false},{flush:'sync'})
function backToRecords(){report.value=null;id.value='';tab.value='records';recordsVersion.value++}
async function editReport(value:WaterReport){
 if(tab.value==='publish')rememberUnfinishedMedia()
 editConflict.value=false
 locationMessage.value=''
  editBaseRevision=value.revision||1
 editing.value=value;id.value='';report.value=null;tab.value='publish';errors.value={};error.value=''
 applying=true;draft.value=waterReportDraftFromRecord(value);applying=false;edited=true;formVersion++
 photos.value=value.media.map(asset=>({key:`saved-${asset.id}`,path:asset.url||asset.path,kind:asset.kind||'image',asset,busy:false,error:''}))
 submitId='';submitSignature=''
 await restore()
 uni.pageScrollTo({scrollTop:0,duration:0})
}
async function cancelEdit(){
 if(busy.value||uploader.value?.uploading||uploader.value?.choosing)return
 rememberUnfinishedMedia()
 editing.value=null;editConflict.value=false;initialized=false;id.value='';report.value=null;photos.value=[];errors.value={};error.value=''
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
  const material = submissionReport.value
  if (!material || !available.value) return
  uni.setClipboardData({
    data: reportMaterial(material),
    showToast: false,
    success: () => {
      copied.value = '已复制时间、地点、坐标和现场情况，可到官方入口粘贴。'
    },
    fail: () => {
      copied.value = '复制失败，请手动整理材料。'
    }
  })
}
</script>
<template>
  <FishingShell :title="tabbed ? '举报' : '线索上报'" :tabbed="tabbed" :back="!tabbed">
    <view class="fishing-content stack">
      <MobileSegmented :model-value="tab" :options="tabs" label="线索上报页面" :disabled="busy || recordsBusy || uploader?.uploading || uploader?.choosing" @update:model-value="selectTab" />
      <view v-if="tab === 'publish'" class="notice report-notice report-notice--safety" role="note" aria-labelledby="report-safety-title">
        <MobileIcon name="shield" size="1.125rem" color="var(--float)" />
        <view class="report-notice__copy">
          <text id="report-safety-title" class="report-notice__title">现场安全提醒</text>
          <text>请保持安全距离，避免上前阻拦或与人争执。遇到人身危险请先报警。只记录亲眼所见，由主管部门核实。</text>
        </view>
      </view>
      <text v-if="storageNotice" class="notice" role="status">{{ storageNotice }}</text>
      <template v-if="tab==='records' && !report">
        <ReportRecords ref="records" :key="`${auth.context}-${recordsVersion}`" @open="viewReport" @edit="editReport" @create="selectTab('publish')" @busy="recordsBusy=$event" />
      </template>
      <template v-else-if="tab==='records' && available && report">
        <view class="mobile-action-group">
          <MobileAction class="secondary" @click="backToRecords">返回上报记录</MobileAction>
          <MobileAction class="secondary" @click="editReport(report)">编辑材料</MobileAction>
        </view>
        <view class="panel stack">
          <text class="heading">到官方渠道完成上报</text>
          <text class="body">材料已存入「我的上报记录」。选择机构后，请在电话中说明情况，或按官方入口要求提交材料。</text>
          <MobileAction id="report-choose-agency" class="primary" aria-haspopup="dialog" @click="agencyPickerOpen = true">选择举报机构</MobileAction>
          <MobileAction class="secondary" @click="copyOpen = true">复制文字材料</MobileAction>
          <text v-if="copied" class="notice" role="status">{{ copied }}</text>
          <text v-if="contactDirectory?.recordFeedback" class="notice" role="status">{{ contactDirectory.recordFeedback }}</text>
        </view>
        <view class="panel stack">
          <text class="heading">上报材料</text>
          <text class="name">{{
            reportCategories.find((c) => c.id === report!.category)?.name
          }}</text>
          <text class="caption"
            >{{ localReportTime(new Date(report.observed_at)) }} · {{ regionLabel(submissionReport || report) }}</text
          >
          <text class="body">{{ report.location_label }}</text>
          <text class="body" selectable>{{ report.description }}</text>
          <FishingPhotos
            v-if="report.media.length"
            :media="report.media"
            label="私密线索附件"
            compact
          />
        </view>
        <ReportChannels ref="contactDirectory" :key="report.id" v-model:picker-open="agencyPickerOpen" compact
          :province="report.province"
          :city="report.city"
          :district="report.district"
          :incident-point="incidentPoint"
          :resolved-region="resolvedRegion"
          :category="report.category"
          :report="report"
          :copy-feedback="copied"
          @copy-material="copyOpen = true"
        />
      </template>
      <template v-else-if="tab==='publish' && available && !id">
        <view v-if="editing" class="panel stack stack--tight">
          <text class="name">编辑上报材料</text>
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
          <text v-if="(!coordinatesText && locating) || locationMessage" class="caption" role="status">{{ locating && !coordinatesText ? '正在获取当前位置…' : locationMessage }}</text>
          <MobileAction class="secondary" :disabled="busy" @click="selectLocation"
            >水域地图选点</MobileAction
          >
          <text v-if="coordinatesText" class="caption" role="status">已选位置：{{ coordinatesText }}</text>
          <text v-else-if="errors.location" class="error" role="alert">{{ errors.location }}</text>
          <MobileDateTimeField v-model:date="observedDate" v-model:time="observedTime"
            field="report-time" label="事发时间" :error="errors.observed_local"
            :disabled="busy" disable-future required />
          <MobileField
            v-model="draft.description"
            field="report-description"
            label="现场情况"
            multiline
            :maxlength="2000"
            show-count
            :error="errors.description"
            :disabled="busy"
            placeholder="描述现场看到的情况"
            required
          />
        </view>
        <view class="panel stack">
          <view class="section-head"><text class="name">现场图片 / 视频</text><text class="caption media-count">{{ photos.length }} / 6</text></view>
          <MobileMediaUploader ref="uploader" v-model="photos" :scope="auth.context" :active="active" :accept="['image','video']" :limit="6" :max-image-bytes="8*1024*1024" :max-video-bytes="20*1024*1024" :upload-image="uploadPhoto" :upload-video="uploadVideo" :error-text="errorText" :recovery="uploadRecovery" :disabled="busy" upload-label="添加图片 / 视频" @change="syncMedia" />
          <text v-if="errors.media" class="error" role="alert">{{ errors.media }}</text>
          <text class="caption">最多 6 项，图片每张 8 MB，视频每段 20 MB。</text>
        </view>
        <view class="stack stack--tight">
          <MobileAction class="primary" aria-haspopup="dialog" aria-describedby="report-submit-help" :disabled="busy || uploader?.uploading || uploader?.choosing || editConflict" @click="save">{{
            busy ? '正在保存材料…' : '上报'
          }}</MobileAction>
          <view class="notice report-notice" role="note" aria-labelledby="report-submit-title">
            <MobileIcon name="info" size="1.125rem" color="var(--lake)" />
            <view class="report-notice__copy">
              <text id="report-submit-title" class="report-notice__title">上报去向</text>
              <text id="report-submit-help">材料存入「我的上报记录」后，会弹出可选举报机构。{{ submissionNextStep }}办理情况以接收部门回复为准。</text>
            </view>
          </view>
        </view>
        <ReportChannels ref="contactDirectory" compact :province="draft.province" :city="draft.city" :district="draft.district"
          :incident-point="draft.province ? incidentPoint : null" :resolved-region="resolvedRegion" :category="draft.category" />
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
    <FishingPrimaryNav v-if="tabbed" active="reports" @navigate="returnToHomeTab" />
  </FishingShell>
</template>

<style scoped>
.report-notice {
  background: var(--lake-soft);
  font-size: var(--fishing-action-size);
  line-height: 1.55;
}
.report-notice--safety {
  background: var(--float-soft);
}
.report-notice__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.report-notice__title {
  color: var(--ink);
  font-weight: 650;
}
</style>
