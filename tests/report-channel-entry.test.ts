import {test}from'node:test'
import assert from'node:assert/strict'
import{REPORT_CHANNELS,matchingReportChannels}from'../src/domain/report-channels'
import{reportAgencyOptions,reportChannelEntry,reportChannelType,reportEntryHelp}from'../src/domain/report-channel-entry'
test('official mini programs remain distinct from public accounts and match the actual jurisdiction',()=>{
 const now=Date.parse('2026-11-20T12:00:00+08:00')
 const mini=REPORT_CHANNELS.find(c=>c.id==='jiangsu-wechat')!,account=REPORT_CHANNELS.find(c=>c.id==='national-wechat')!
 assert.equal(reportChannelType(mini),'微信小程序');assert.equal(reportChannelType(account),'微信公众号')
 for(const platform of ['h5','weixin']as const){
  assert.deepEqual(reportChannelEntry(mini,platform),{action:'copy',value:'江苏长江禁渔随手拍',label:'复制小程序名称'})
  assert.equal(reportChannelEntry(account,platform).label,'复制公众号名称')
  assert.match(reportEntryHelp(mini,platform),/微信.*小程序/)
 }
 assert.ok(matchingReportChannels('江苏省','苏州市','',now).some(c=>c.id===mini.id))
 assert.ok(!matchingReportChannels('浙江省','宁波市','',now).some(c=>c.id===mini.id))
 assert.ok(matchingReportChannels('广西壮族自治区','桂林市','七星区',now).some(c=>c.id==='guilin-lijiang-mini'))
 assert.ok(!matchingReportChannels('广西壮族自治区','南宁市','',now).some(c=>c.id==='guilin-lijiang-mini'))
})
test('the agency picker offers scoped destinations with an actionable method on this platform', () => {
 const now=Date.parse('2026-11-22T12:00:00+08:00')
 const caidian=matchingReportChannels('湖北省','武汉市','蔡甸区',now,{category:'electric',areaCode:'027'})
 const h5=reportAgencyOptions(caidian,'h5'), mp=reportAgencyOptions(caidian,'weixin')
 assert.equal(h5[0].channel.id,'caidian-fishery')
 assert.deepEqual(h5[0].actions.filter(a=>a.kind==='phone').map(a=>a.number),['027-84995835','027-84993165'])
 assert.equal(h5.at(-1)?.channel.value,'027-12345')
 assert.ok(h5.find(r=>r.channel.id==='changjiang-police')?.actions.some(a=>a.kind==='email'))
 assert.ok(mp.find(r=>r.channel.id==='changjiang-police')?.actions.some(a=>a.kind==='copy-email'))
 assert.ok(!h5.some(r=>['national-wechat','national-procuratorate-web','environment-report'].includes(r.channel.id)))
 const national=matchingReportChannels('浙江省','宁波市','江北区',now,{category:'other'})
 for(const platform of ['h5','weixin'] as const){
  const options=reportAgencyOptions(national,platform)
  assert.deepEqual(options.map(r=>r.channel.id),['water-supervision','environment-report'])
  assert.ok(options.every(r=>r.actions.some(a=>a.label===(platform==='h5'?'打开官方填报页':'复制官网链接'))))
  assert.ok(options[0].actions.some(a=>a.kind==='phone'&&a.number==='12314'))
 }
 assert.deepEqual(reportAgencyOptions(matchingReportChannels('香港特别行政区','','',now),'h5'),[])
})
test('web entries open only their official website and unsupported mini direct launches fall back to names',()=>{
 const web=REPORT_CHANNELS.find(c=>c.id==='national-procuratorate-web')!,mini=REPORT_CHANNELS.find(c=>c.id==='jiangsu-wechat')!
 assert.deepEqual(reportChannelEntry(web,'h5'),{action:'website',value:'https://www.12309.gov.cn/',label:'打开官方网页'})
 assert.deepEqual(reportChannelEntry(web,'weixin'),{action:'copy',value:'https://www.12309.gov.cn/',label:'复制官网链接'})
 assert.ok(REPORT_CHANNELS.filter(c=>c.kind==='mini-program').every(c=>!c.miniProgram),'directory has no guessed AppId')
 const documented={...mini,miniProgram:{appId:'wx0123456789abcdef',path:'pages/home',source:'https://example.gov.cn/verified-entry'}}
 assert.equal(reportChannelEntry(documented,'h5').action,'copy')
 assert.equal(reportChannelEntry(documented,'weixin').action,'mini-program')
 assert.equal(reportChannelEntry({...documented,miniProgram:{...documented.miniProgram,appId:'unknown'}},'weixin').action,'copy')
})
