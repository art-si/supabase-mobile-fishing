import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchingReportChannels, type ReportChannel } from '../src/domain/report-channels'
import { rankedReportChannels, matchChannelOffice, channelDistance } from '../src/domain/report-channel-location'
const agency:ReportChannel={id:'one',name:'甲市农业局',officeName:'甲市农业局',province:'甲省',city:'甲市',kind:'phone',value:'123',instructions:'',source:'https://example.gov.cn',checked:'2026-11-20'}
test('same-jurisdiction real distances order nearest first; local beats broader jurisdiction',()=>{
 const two={...agency,id:'two'}, national={...agency,id:'national',city:undefined,province:undefined}
 const origin={longitude:114,latitude:30}, points={one:{longitude:114.2,latitude:30},two:{longitude:114.01,latitude:30},national:origin}
 assert.deepEqual(rankedReportChannels([agency,two,national],origin,points).map(x=>x.id),['two','one','national'])
 assert.deepEqual(rankedReportChannels([agency,two],null,points).map(x=>x.id),['one','two'])
 assert.deepEqual(rankedReportChannels([agency,two],origin,{two:points.two}).map(x=>x.id),['two','one'])
 assert.equal(channelDistance(origin,{longitude:Infinity,latitude:20}),undefined)
})
test('office map matches require one exact identity and correct city/district',()=>{
 const poi={name:'甲市农业局',cityname:'甲市',adname:'甲区',longitude:114,latitude:30}
 assert.deepEqual(matchChannelOffice(agency,[poi]),{longitude:114,latitude:30})
 for(const pois of [[{...poi,name:'甲市农业局附近门店'}],[{...poi,cityname:'乙市'}],[poi,poi]])assert.equal(matchChannelOffice(agency,pois),undefined)
 assert.equal(matchChannelOffice({...agency,district:'乙区'},[poi]),undefined)
})
test('verified email contacts respect jurisdictions and recheck expiration',()=>{
 const now=Date.parse('2026-11-20T12:00:00+08:00')
 const local=matchingReportChannels('湖北省','武汉市','蔡甸区',now)
 assert.equal(local[0].id,'caidian-fishery')
 assert.ok(local.find(c=>c.id==='changjiang-police')?.email)
 assert.ok(!matchingReportChannels('河北省','石家庄市','',now).some(c=>c.id==='changjiang-police'))
 assert.equal(matchingReportChannels('江西省','赣州市','会昌县',now)[0].email,'hcxnyzfd@126.com')
 assert.ok(!matchingReportChannels('江西省','赣州市','于都县',now).some(c=>c.id==='huichang-agriculture'))
 assert.equal(matchingReportChannels('江西省','赣州市','会昌县',Date.parse('2027-11-21')).length,0)
})
