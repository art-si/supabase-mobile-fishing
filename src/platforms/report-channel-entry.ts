import type { ReportEntry } from '@/domain/report-channel-entry'
// #ifdef H5
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
// #endif
export let reportEntryPlatform:'h5'|'weixin'='weixin'
 // #ifdef H5
 reportEntryPlatform='h5'
 // #endif
export async function openReportWebsite(url:string){
 if(!/^https:\/\//.test(url))throw new Error('请核对官方入口')
 // #ifdef H5
 if(Capacitor.isNativePlatform())await Browser.open({url})
 else window.open(url,'_blank','noopener,noreferrer')
 return
 // #endif
 // #ifndef H5
 await new Promise<void>((resolve,reject)=>uni.setClipboardData({data:url,showToast:false,success:()=>resolve(),fail:reject}))
 // #endif
}
export async function openReportMiniProgram(entry:ReportEntry){
 // #ifdef MP-WEIXIN
 if(entry.action==='mini-program'){
  await new Promise<void>((resolve,reject)=>uni.navigateToMiniProgram({appId:entry.value,path:entry.path,envVersion:'release',success:()=>resolve(),fail:reject}))
  return
 }
 // #endif
 throw new Error('请在微信内搜索官方小程序')
}
