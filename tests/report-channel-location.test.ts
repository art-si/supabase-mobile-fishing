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
 assert.ok(matchingReportChannels('江西省','赣州市','会昌县',Date.parse('2027-11-21')).every(c=>c.standingNational))
})
test('the selected water determines the city transfer line and issue-specific public entry',()=>{
 const now=Date.parse('2026-11-21T12:00:00+08:00')
 const channels=(province:string,city:string,district:string,areaCode:string,category='electric')=>
   matchingReportChannels(province,city,district,now,{areaCode,category})
 const shiyan=channels('湖北省','十堰市','丹江口市','0719')
 assert.equal(shiyan[0].value,'0719-12345')
 assert.equal(shiyan.filter(c=>c.id==='local-12345').length,1)
 assert.ok(!shiyan.some(c=>c.topic==='water'))
 const ningbo=channels('浙江省','宁波市','海曙区','0574')
 assert.equal(ningbo[0].value,'0574-12345')
 assert.equal(channels('湖北省','武汉市','蔡甸区','027')[0].id,'caidian-fishery')
 const water=channels('浙江省','宁波市','海曙区','0574','other')
 assert.ok(water.some(c=>c.value==='https://supe.mwr.gov.cn/#/'))
 assert.ok(water.some(c=>c.value==='https://jubao.mee.gov.cn/'))
 assert.ok(channels('上海市','上海市','青浦区','021').some(c=>c.id==='shanghai-agriculture-form'))
 assert.ok(!ningbo.some(c=>c.id==='shanghai-agriculture-form'))
 assert.ok(!water.some(c=>c.id==='national-fishery'))
 assert.equal(channels('浙江省','宁波市','海曙区','330203').find(c=>c.id==='local-12345')?.value,'12345')
})
