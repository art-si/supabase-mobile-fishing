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

export type AgencyAction =
  | { kind: 'phone'; label: string; number: string }
  | { kind: 'entry' | 'email' | 'copy-email'; label: string; detail: string }

export interface ReportAgencyOption { channel: ReportChannel; actions: AgencyAction[] }

/** Input is already filtered for the incident, validity dates and jurisdiction. */
export function reportAgencyOptions(channels: readonly ReportChannel[], platform: 'h5' | 'weixin') {
  const options: ReportAgencyOption[] = []
  for (const channel of channels) {
    const referral = channel.id === 'local-12345' && Boolean(channel.city)
    if (channel.topic === 'general' && !channel.province && !referral) continue
    const entry = reportChannelEntry(channel, platform)
    const actions: AgencyAction[] = []
    if (entry.action === 'phone') {
      const label = channel.phoneHours ? `拨打电话（${channel.phoneHours}）` : '拨打电话'
      actions.push({ kind: 'phone', label, number: entry.value })
    } else if (channel.kind === 'website' || entry.action === 'mini-program') {
      const label = entry.action === 'website' ? '打开官方填报页' : entry.label
      actions.push({ kind: 'entry', label, detail: entry.action === 'copy' ? '在浏览器填写' : '' })
    }
    if (channel.additionalPhone) {
      actions.push({ kind: 'phone', label: channel.additionalPhone.label, number: channel.additionalPhone.number })
    }
    if (channel.email) {
      actions.push(platform === 'h5'
        ? { kind: 'email', label: '写举报邮件', detail: channel.email }
        : { kind: 'copy-email', label: '复制举报邮箱', detail: channel.email })
    }
    if (actions.length) options.push({ channel, actions })
  }
  // Put referrals after agencies that accept this type of incident themselves.
  return options.sort((a, b) => Number(a.channel.id === 'local-12345') - Number(b.channel.id === 'local-12345'))
}
