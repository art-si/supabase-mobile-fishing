import type { ReportChannel } from './report-channels'
export type ReportEntry = { action:'phone'|'copy'|'website'; value:string; label:string } | { action:'mini-program'; value:string; path?:string; label:string }
export function reportChannelType(channel:ReportChannel){
 return {'phone':'举报电话','wechat':'微信公众号','mini-program':'微信小程序','website':'官方网站'}[channel.kind]
}
export function reportChannelEntry(channel:ReportChannel,platform:'h5'|'weixin'):ReportEntry{
 if(channel.kind==='phone')return{action:'phone',value:channel.value,label:'拨打举报电话'}
 if(channel.kind==='website')return platform==='h5'?{action:'website',value:channel.value,label:'打开官方网页'}:{action:'copy',value:channel.value,label:'复制官网链接'}
 if(channel.kind==='mini-program'&&platform==='weixin'&&channel.miniProgram&&/^wx[\da-f]{16}$/i.test(channel.miniProgram.appId)&&/^https:\/\//.test(channel.miniProgram.source))return{action:'mini-program',value:channel.miniProgram.appId,path:channel.miniProgram.path,label:'打开官方小程序'}
 return{action:'copy',value:channel.value,label:channel.kind==='mini-program'?'复制小程序名称':'复制公众号名称'}
}
export function reportEntryHelp(channel:ReportChannel,platform:'h5'|'weixin'){
 const entry=reportChannelEntry(channel,platform)
 if(channel.kind==='mini-program'&&entry.action==='copy')return '复制名称后，在微信「搜索 → 小程序」中进入；图片、视频和文字需在官方入口提交。'
 if(channel.kind==='wechat')return '复制名称后，在微信「搜索 → 公众号」中核对官方认证，再进入举报功能。'
 if(channel.kind==='website'&&platform==='weixin')return '复制链接后在浏览器打开官网，材料需在官方页面提交。'
 return ''
}
