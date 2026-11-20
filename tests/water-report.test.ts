import test from 'node:test'
import assert from 'node:assert/strict'
import {
  freshWaterReport,
  reportTimestamp,
  validateWaterReport,
  waterReportPayload,
  reportMaterial,
  hasWaterReportContent,
  waterReportDraftFromRecord,
  type WaterReport
} from '../src/domain/water-report'
import { matchingReportChannels, REPORT_CHANNELS } from '../src/domain/report-channels'

test('empty automatic defaults refresh, explicit incident drafts and edit timestamps survive', () => {
  const old = {...freshWaterReport(new Date('2026-11-19T08:00:00+08:00')),province:'浙江省',city:'宁波市',district:'海曙区',location_label:'旧自动定位'}
  assert.equal(hasWaterReportContent(old),false)
  assert.equal(hasWaterReportContent({...old,_edited:true}),true)
  assert.equal(hasWaterReportContent({...old,description:'看到有人在河里电鱼'}),true)
  assert.equal(hasWaterReportContent({...old,media:[{id:'asset',path:'x',width:1,height:1}]}),true)
  const record={...old, observed_at:'2026-11-19T00:00:00Z',created_at:'2026-11-19T01:00:00Z',status:'saved',crs:'GCJ-02'} as WaterReport
  const draft=waterReportDraftFromRecord(record)
  assert.equal(draft.id,record.id)
  assert.equal(reportTimestamp(draft.observed_local),record.observed_at.replace('Z','.000Z'))
  assert.equal(draft.location_label,record.location_label)
  assert.ok(!('created_at' in draft) && !('status' in draft))
})
test('report validates observed facts, real date and optional paired coordinates', () => {
  const draft = {
    ...freshWaterReport(),
    province: '湖北省',
    city: '黄石市',
    location_label: '测试水域',
    description: '看到疑似电鱼工具',
    observed_local: '2026-11-19 10:00'
  }
  assert.deepEqual(validateWaterReport(draft, Date.parse('2026-11-20')), {})
  assert.equal(reportTimestamp('2026-02-30 10:00'), null)
  assert.equal(reportTimestamp('2026-11-19 25:30'), null)
  assert.ok(validateWaterReport({ ...draft, latitude: 30 }, Date.parse('2026-11-20')).location)
  assert.ok(
    validateWaterReport({ ...draft, observed_local: '2030-11-19 10:00' }, Date.parse('2026-11-20'))
      .observed_local
  )
  assert.ok(validateWaterReport({ ...draft, description: '猜的' }).description)
})
test('report payload has no delivery claim or attachment URLs; copy explicitly omits photos', () => {
  const draft = freshWaterReport()
  draft.media = [{ id: 'photo', path: 'private.jpg', url: 'secret', width: 40, height: 40 }]
  const payload = waterReportPayload(draft)
  assert.deepEqual(payload.media, [{ id: 'photo' }])
  assert.ok(!('status' in payload) && !('recipient' in payload))
  const text = reportMaterial({
    ...draft,
    longitude: 114.95,
    latitude: 30.21,
    observed_at: new Date().toISOString(),
    created_at: '',
    status: 'saved',
    crs: 'GCJ-02'
  } as WaterReport)
  assert.ok(text.includes('需在官方渠道另行提交'))
  assert.match(text, /坐标（GCJ-02）：114\.95, 30\.21/)
  assert.ok(!text.includes('secret') && !text.includes('private.jpg'))
})
test('nationwide fallback never claims a guessed local recipient; county matching is exact', () => {
  const now = Date.parse('2026-11-19T12:00:00Z')
  const unknown = matchingReportChannels('云南省', '未知市', '', now)
  assert.ok(unknown.some((c) => c.id === 'national-fishery'))
  assert.ok(unknown.every((c) => !c.province))
  assert.equal(matchingReportChannels('湖北省', '黄石市', '阳新县', now)[0].id, 'yangxin-fishery')
  assert.ok(
    !matchingReportChannels('湖北省', '黄石市', '大冶市', now).some(
      (c) => c.id === 'yangxin-fishery'
    )
  )
  assert.deepEqual(matchingReportChannels('香港特别行政区', '', '', now), [])
  assert.deepEqual(matchingReportChannels('湖北省', '黄石市', '', Date.parse('2027-11-19')), [])
})
test('every actionable channel has a dated official source; none pretends to be an API', () => {
  assert.equal(new Set(REPORT_CHANNELS.map((c) => c.id)).size, REPORT_CHANNELS.length)
  for (const c of REPORT_CHANNELS) {
    const url = new URL(c.source)
    assert.equal(url.protocol, 'https:')
    assert.ok(
      url.hostname.endsWith('.gov.cn') ||
        url.hostname.endsWith('.agri.cn') ||
        url.hostname === 'www.agri.cn'
    )
    assert.ok(['phone', 'wechat', 'mini-program', 'website'].includes(c.kind))
    assert.match(c.checked, /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(new Date(c.checked).toISOString().slice(0, 10), c.checked)
  }
})
test('official prefecture aliases stay inside their province and never use partial names', () => {
  const now = Date.parse('2026-11-20T12:00:00Z')
  for (const city of ['湘西土家族苗族自治州', '湘西州', ' 湘西自治州 ']) {
    const channels = matchingReportChannels('湖南省', city, '凤凰县', now)
    assert.equal(channels[0].id, 'hunan-xiangxi-agriculture')
    assert.equal(channels.filter((c) => c.province).length, 1)
  }
  for (const [province, city] of [
    ['湖北省', '湘西州'],
    ['湖南省', '湘西州附近'],
    ['湖南省', '长沙县'],
    ['湖南省', '']
  ]) {
    assert.ok(matchingReportChannels(province, city, '', now).every((c) => !c.province))
  }
  assert.equal(
    matchingReportChannels('湖南省', '长沙市', '长沙县', now)[0].id,
    'hunan-changsha-agriculture'
  )
})
test('new county contacts require the correct city and district, and stop at recheck deadline', () => {
  const checked = Date.parse('2026-11-20')
  const langxi = (now: number, city = '宣城市', district = '郎溪县') =>
    matchingReportChannels('安徽省', city, district, now).filter((c) => c.id === 'langxi-fishery')
  assert.equal(langxi(checked).length, 1)
  assert.equal(langxi(checked, '黄山市').length, 0)
  assert.equal(langxi(checked, '宣城市', '宣州区').length, 0)
  assert.equal(langxi(checked, '宣城市', '').length, 0)
  assert.equal(langxi(checked - 1).length, 0)
  assert.equal(langxi(checked + 180 * 86400000 - 1).length, 1)
  assert.equal(langxi(checked + 180 * 86400000).length, 0)
})
test('verified city channels rank ahead of province; annual notices expire independently', () => {
  const now = Date.parse('2026-11-19T12:00:00Z')
  const channels = matchingReportChannels('黑龙江省', '伊春市', '', now)
  assert.equal(channels[0].value, '0458-6113718')
  assert.equal(channels[1].id, 'heilongjiang-fishery')
  assert.equal(matchingReportChannels('黑龙江省', '大兴安岭', '', now)[0].value, '0457-2133008')
  const expired = matchingReportChannels(
    '黑龙江省',
    '伊春',
    '',
    Date.parse('2027-01-01T00:00:00+08:00')
  )
  assert.ok(expired.length > 0 && expired.every((c) => !c.province))
  assert.equal(matchingReportChannels('江西省', '赣州市', '于都县', now)[0].value, '0797-6223923')
  assert.equal(matchingReportChannels('广东省', '云浮市', '', now)[0].value, '0766-8923252')
})
