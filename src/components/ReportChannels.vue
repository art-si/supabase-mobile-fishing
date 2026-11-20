<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { onHide } from '@dcloudio/uni-app'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileConfirmDialog from '@mobile-core/components/MobileConfirmDialog.vue'
import { matchingReportChannels, type ReportChannel } from '@/domain/report-channels'
import { isDemo } from '@/config'
import { useAuthStore } from '@/stores/auth'
import type { WaterReport } from '@/domain/water-report'
import { rankedReportChannels, channelDistance, channelDistanceLabel, type ChannelPoint, type ChannelLocations } from '@/domain/report-channel-location'
import { locateReportChannels } from '@/platforms/report-channel-location'
import { reportMailto } from '@/domain/report-mail-message'
import { openReportMail } from '@/platforms/report-mail'
import { readReportEmailContact } from '@/services/report-email-contact'
import { validateReportEmailContact, type ReportEmailContact } from '@/domain/report-email'
import ReportEmailContactSheet from './ReportEmailContactSheet.vue'
import { reportChannelEntry, reportChannelType, reportEntryHelp } from '@/domain/report-channel-entry'
import { reportEntryPlatform, openReportWebsite, openReportMiniProgram } from '@/platforms/report-channel-entry'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
const props = defineProps<{ province: string; city: string; district: string; currentLocation?:ChannelPoint|null; report?:WaterReport|null }>()
const auth=useAuthStore(), locations=ref<ChannelLocations>({}), finding=ref(false)
const matching=computed(()=>matchingReportChannels(props.province,props.city,props.district))
const channels=computed(()=>rankedReportChannels(matching.value,props.currentLocation,locations.value))
let lookupVersion=0
watch(()=>[props.province,props.city,props.district,props.currentLocation],async()=>{
 const version=++lookupVersion
 locations.value={};finding.value=false
 if(!props.currentLocation||isDemo)return
 finding.value=true
 const result=await locateReportChannels(matching.value)
 if(version===lookupVersion){locations.value=result;finding.value=false}
},{immediate:true})
const emailOpen=ref(false),emailConfirm=ref(false),emailChannel=ref<ReportChannel>(),emailContact=ref<ReportEmailContact|null>(null)
function closeActions(){confirm.value=false;emailConfirm.value=false;emailOpen.value=false;emailChannel.value=undefined;emailContact.value=null;feedback.value=''}
watch(()=>auth.context,closeActions)
watch(()=>[props.province,props.city,props.district,props.report?.id],closeActions)
onHide(()=>{lookupVersion++;finding.value=false;closeActions()})
onBeforeUnmount(()=>{lookupVersion++})
const confirm = ref(false),
  selected = ref<ReportChannel>(),
  feedback = ref('')
function choose(channel: ReportChannel) {
  if(channel.kind!=='phone'){void enterChannel(channel);return}
  selected.value = channel
  confirm.value = true
}
const entry=(channel:ReportChannel)=>reportChannelEntry(channel,reportEntryPlatform)
function actionLabel(channel:ReportChannel){return channel.kind==='phone'?`拨打${channel.name}`:entry(channel).label+`：${channel.name}`}
async function enterChannel(channel:ReportChannel){
 if(isDemo)return
 const action=entry(channel)
 feedback.value=''
 try{
  if(action.action==='website'){
   await openReportWebsite(action.value)
   feedback.value='已请求打开官方网页，请在官方入口填写并提交；材料不会自动传过去。'
  }else if(action.action==='mini-program'){
   await openReportMiniProgram(action)
   feedback.value='已打开官方小程序，请核对受理范围后提交；材料不会自动传过去。'
  }else if(action.action==='copy'){
   await new Promise<void>((resolve,reject)=>uni.setClipboardData({data:action.value,showToast:false,success:()=>resolve(),fail:reject}))
   feedback.value=channel.kind==='website'?'官网链接已复制，请在浏览器打开并提交材料。':channel.kind==='mini-program'?'小程序名称已复制，请在微信「搜索 → 小程序」中进入并核对官方主体。':'公众号名称已复制，请在微信核对官方认证后进入举报功能。'
  }
 }catch{feedback.value=channel.kind==='website'?'未能打开官网，可复制链接后在浏览器访问。':`暂未完成，请在微信搜索“${channel.value}”并核对官方主体。`}
}
function composeEmail(channel:ReportChannel){
 if(isDemo||!auth.requireLogin()||!channel.email)return
 emailChannel.value=channel
 try{
  const contact=readReportEmailContact(auth.userId)
  if(!contact || Object.keys(validateReportEmailContact(contact)).length){emailOpen.value=true;return}
  emailContact.value=contact;emailConfirm.value=true
 }catch{emailOpen.value=true}
}
function contactSaved(contact:ReportEmailContact){
 emailContact.value=contact
 // Opening another sheet waits until the contact editor has dismissed.
 emailOpen.value=false
 if(emailChannel.value)emailConfirm.value=true
}
function sendEmail(){
 if(isDemo||!emailChannel.value?.email||!emailContact.value||!auth.signedIn)return
 try{
  const opened=openReportMail(reportMailto(emailChannel.value.email,emailContact.value,props.report))
  feedback.value=opened?'已请求打开邮箱，请选择自己的发件账户并确认发送。图片、视频需另行添加；本应用无法确认邮件是否发出。':'此端不能打开系统邮箱，请复制邮箱和文字材料，到自己的邮箱中发送。'
 }catch{feedback.value='未能打开邮箱，请复制邮箱和文字材料后手动发送。'}
}
function copyEmail(channel:ReportChannel){
 if(!channel.email)return
 uni.setClipboardData({data:channel.email,showToast:false,success:()=>{feedback.value='举报邮箱已复制。'},fail:()=>{feedback.value='复制失败，请长按邮箱复制。'}})
}
function contact() {
  // Exploring fixtures must never contact a real public agency.
  if (isDemo) return
  const channel = selected.value
  if (!channel || channel.kind!=='phone') return
  feedback.value = ''
    uni.makePhoneCall({
      phoneNumber: channel.value,
      success: () => {
        feedback.value = '已打开拨号，不代表接通或受理。图片和视频不会随电话发送。'
      },
      fail: () => {
        feedback.value = `未能打开拨号，请手动拨打 ${channel.value}。`
      }
    })
}
async function source(channel: ReportChannel) {
  try {
    await openReportWebsite(channel.source)
    if(reportEntryPlatform==='weixin')feedback.value='官方来源链接已复制，可在浏览器核对。'
  } catch {
    feedback.value = '未能打开官方来源，请稍后重试。'
  }
}
</script>
<template>
  <view class="stack">
    <text class="heading">官方举报渠道</text>
    <text class="caption"
      >优先显示事发辖区；同级机构有位置时，按距当前定位由近到远排列。是否受理以官方答复为准。</text
    >
    <text v-if="finding" class="caption" role="status">正在匹配附近机构…</text>
    <text v-if="isDemo" class="notice">本机体验只展示渠道，不拨号、不发送材料。</text>
    <text v-if="!channels.length" class="notice"
      >此地区暂无可用的已核验渠道，请向当地官方部门核实。不要把线索发给身份不明的联系人。</text
    >
    <view v-for="channel in channels" :key="channel.id" class="panel stack stack--tight">
      <text class="name">{{ channel.name }}</text>
      <text v-if="channel.kind !== 'phone'" class="caption">{{ reportChannelType(channel) }}</text>
      <text v-if="locations[channel.id] && currentLocation" class="caption">{{ channelDistanceLabel(channelDistance(currentLocation,locations[channel.id])) }} · 高德直线距离</text>
      <text v-if="channel.address" class="caption">{{ channel.address }}</text>
      <text v-if="channel.value !== channel.name" class="body" selectable>{{ channel.value }}</text>
      <text v-if="channel.email" class="body report-channel__email" selectable>{{ channel.email }}</text>
      <text class="caption">{{ channel.instructions }}</text>
      <view class="mobile-action-group">
        <MobileAction
          class="secondary"
          :disabled="isDemo"
          :aria-label="actionLabel(channel)"
          @click="choose(channel)"
          >{{ entry(channel).label }}</MobileAction
        >
        <MobileAction class="secondary" @click="source(channel)">查看官方来源</MobileAction>
      </view>
      <text v-if="reportEntryHelp(channel,reportEntryPlatform)" class="caption">{{ reportEntryHelp(channel,reportEntryPlatform) }}</text>
      <view v-if="channel.email" class="mobile-action-group">
        <MobileAction class="secondary" :disabled="isDemo" @click="composeEmail(channel)">发送邮件</MobileAction>
        <MobileAction class="secondary" @click="copyEmail(channel)">复制邮箱</MobileAction>
      </view>
      <text v-if="channel.email" class="caption">打开自己的邮箱确认发送；文字自动填入，图片和视频需在邮件中添加。</text>
      <text class="caption">信息核对：{{ channel.checked }}</text>
    </view>
    <text v-if="feedback" class="notice" role="status">{{ feedback }}</text>
    <text v-if="currentLocation && !finding && !Object.keys(locations).length && channels.length" class="caption">暂未匹配到机构的准确位置，已按事发辖区排列。</text>
    <MobileAction v-if="auth.signedIn && channels.some(c=>c.email)" class="text-action" @click="emailChannel=undefined;emailOpen=true">我的联系邮箱</MobileAction>
    <ReportEmailContactSheet v-model="emailOpen" @saved="contactSaved" />
    <MobileConfirmDialog v-model="emailConfirm" title="在自己的邮箱中发送" :message="`收件人：${emailChannel?.name || ''}（${emailChannel?.email || ''}）。联系邮箱：${emailContact?.email || ''}。将带入文字材料${report ? '和所选坐标' : ''}；请在邮件中另行添加图片、视频，并确认发件账户。`" confirm-text="打开邮箱" :destructive="false" @confirm="sendEmail" />
    <MobileConfirmDialog
      v-model="confirm"
      title="打开拨号？"
      :message="`${selected?.name || ''}：${selected?.value || ''}。不会自动发送你的图片、视频或坐标。`"
      confirm-text="打开拨号"
      :destructive="false"
      @confirm="contact"
    />
  </view>
</template>
<style scoped>
.report-channel__email { overflow-wrap:anywhere; }
</style>
