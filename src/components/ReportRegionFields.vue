<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue'
import { onHide } from '@dcloudio/uni-app'
import MobileField from '@mobile-core/components/MobileField.vue'
import MobileCityPicker from '@mobile-core/components/MobileCityPicker.vue'
import { cityOptions } from '@/domain/cities'
import { districtOptions,regionId,regionNames,regionLabel,type RegionNames } from '@/domain/regions'
import { canLocateReport, locateReport, type ReportLocation } from '@/platforms/report-location'
import { useAuthStore } from '@/stores/auth'
defineOptions({ options:{styleIsolation:'apply-shared'} })
const props=withDefaults(defineProps<{province:string;city:string;district:string;currentRegion?:RegionNames|null;required?:boolean;disabled?:boolean;errors?:Record<string,string>}>(),{required:false,errors:()=>({})})
const emit=defineEmits<{'update:province':[value:string];'update:city':[value:string];'update:district':[value:string];located:[value:ReportLocation]}>()
const auth=useAuthStore(), locatedRegion=ref<RegionNames|null>(null), locationFailed=ref(false)
let request=0
watch(()=>props.currentRegion,value=>{locatedRegion.value=value?{...value}:null},{immediate:true,deep:true})
watch(()=>auth.context,()=>{request++;locatedRegion.value=null;locationFailed.value=false})
onHide(()=>{request++})
onScopeDispose(()=>{request++})
const locatedLabel=computed(()=>locatedRegion.value?regionLabel(locatedRegion.value):(locationFailed.value?'尚未获取位置，点按重试':'点按获取当前省市区'))
async function locateCurrentRegion(){
 const current=++request
 if(locatedRegion.value){
  const id=regionId(locatedRegion.value)
  if(id && !id.startsWith('province-'))return id
 }
 locationFailed.value=false
 try{
  const value=await locateReport()
  if(current!==request)throw new Error('位置选择已结束，请重新打开后定位。')
  const id=regionId(value)
  if(!id || id.startsWith('province-'))throw new Error('未能识别当前城市或区县，请手动选择。')
  locatedRegion.value={province:value.province,city:value.city,district:value.district}
  emit('located',value)
  return id
 }catch(error){
  if(current===request)locationFailed.value=true
  throw error
 }
}
const selected=computed({get:()=>regionId(props),set:(id:string)=>{
 const value=regionNames(id)
 emit('update:province',value.province);emit('update:city',value.city);emit('update:district',value.district)
}})
</script>
<template>
 <MobileField field="report-region" label="事发地区" :required="required" :error="errors.province || errors.city || errors.district">
  <MobileCityPicker v-model="selected" :cities="cityOptions" :districts="districtOptions" depth="district" :allow-partial="!required" :current-label="regionLabel(props)" label="选择事发地区" field="report-region" placeholder="选择省、市、区县" :disabled="disabled" :locate="canLocateReport || locatedRegion ? locateCurrentRegion : undefined" locate-label="当前位置" :located-label="locatedLabel" />
 </MobileField>
</template>
