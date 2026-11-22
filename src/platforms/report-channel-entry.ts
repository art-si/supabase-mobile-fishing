import type { ReportEntry } from '@/domain/report-channel-entry'
import { openExternalPage } from './open-external-page'
export let reportEntryPlatform:'h5'|'weixin'='weixin'
 // #ifdef H5
 reportEntryPlatform='h5'
 // #endif
export async function openReportWebsite(url:string){
 if(!/^https:\/\//.test(url))throw new Error('请核对官方入口')
 await openExternalPage(url)
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
