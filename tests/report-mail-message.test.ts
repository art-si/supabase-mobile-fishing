import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reportMailto } from '../src/domain/report-mail-message'
import { freshWaterReport, type WaterReport } from '../src/domain/water-report'
test('mail draft has verified recipient, encoded incident and reply contact, no fake sender or attachments',()=>{
 const {observed_local,...draft}=freshWaterReport()
 const report:WaterReport={...draft,city:'甲市',district:'甲区',description:'亲眼所见 & 未核实 = + ? #',observed_at:new Date().toISOString(),created_at:new Date().toISOString(),status:'saved',crs:'GCJ-02',longitude:114,latitude:30}
 const contact={name:'测试联系人',email:'test+reply@example.com'}
 const href=reportMailto('office@example.gov.cn',contact,report),url=new URL(href)
 assert.equal(decodeURIComponent(url.pathname),'office@example.gov.cn')
 assert.match(url.searchParams.get('subject')!,/甲市甲区/)
 assert.ok(url.searchParams.get('body')!.includes(report.description))
 assert.ok(url.searchParams.get('body')!.includes(contact.email))
 assert.match(url.searchParams.get('body')!,/另行添加原始附件/)
 assert.equal(url.searchParams.get('from'),null)
 assert.equal(url.searchParams.get('attach'),null)
 assert.throws(()=>reportMailto('office@example.gov.cn\nBcc:evil@example.com',contact,report))
 assert.throws(()=>reportMailto('office@example.gov.cn',{...contact,email:'test@example.com\r\n'},report))
})
