// Isolated browser/GPS/API contract fixtures; no hosted writes or actual GPS claims.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { setH5TextScale } from './h5-text-scale.mjs'
import { wgs84ToGcj02 } from '../src/_mobile-core/coordinates.ts'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178', output = 'artifacts/spot-entry'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname))
const owner = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222'
const checks = [], errors = [], escaped = [], writes = [], metrics = []
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const pass = text => { checks.push(text); console.log('PASS', text) }
const gpsPoint = wgs84ToGcj02(114.3, 30.6)
const place = { longitude: 121.55, latitude: 29.87, name: '宁波水域（隔离样本）', kind: 'water', crs: 'GCJ-02', created_at: Date.now() }
async function open(mode = 'success', editing = false, precision = 'exact') {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'zh-CN', reducedMotion: 'reduce' })
  const item = { id, name: '旧钓位', city: '武汉市', water_type: '自然水域', species: '', description: '', fee_note: '未核实', access_note: '', observed_on: '2026-11-20', audience: 'private', precision, longitude: 114.3, latitude: 30.6, media: [], author: { id: owner, nickname: '测试用户' }, status: 'published' }
  await context.addInitScript(({ owner, mode }) => {
    localStorage.setItem('dyj.auth.v1', JSON.stringify({ type: 'object', data: { access_token: 'spot-ui-contract', refresh_token: 'fixture', expires_at: Date.now() / 1000 + 3600, user: { id: owner } } }))
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'granted' }) } })
    window.locationCalls = 0; window.lookupFailure = mode === 'lookup-failure'
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition(success, fail) {
      window.locationCalls++
      const done=()=>success({coords:{longitude:114.3,latitude:30.6,accuracy:12}})
      if(window.locationCalls===2&&mode==='denied') return fail({code:1})
      if(window.locationCalls===2&&mode==='late') window.releaseLocation=done
      else done()
    } } })
    window.AMap = {
      PlaceSearch: class { searchNearBy(_query,point,_radius,callback) { callback('complete',{poiList:{pois:[{name:point[0]>120?'宁波隔离水域':'武汉隔离水域',type:'地名地址信息;自然地名;湖泊',location:{getLng:()=>point[0],getLat:()=>point[1]}}]}}) } },
      Geolocation: class { getCurrentPosition(callback) { window.locationCalls++; const done = () => callback('complete', { position: { getLng: () => 114.3, getLat: () => 30.6 }, accuracy: 12, location_type: 'html5' }); if (mode === 'late') window.releaseLocation = done; else done() } },
      Geocoder: class { getAddress(point, callback) { const run = () => callback(window.lookupFailure ? 'error' : 'complete', { regeocode: { formattedAddress: point[0] > 120 ? '浙江省宁波市海曙区隔离地点' : '湖北省武汉市江汉区隔离地点', addressComponent: point[0] > 120 ? { province: '浙江省', city: '宁波市', district: '海曙区' } : { province: '湖北省', city: '武汉市', district: '江汉区' } } }); if (window.deferLookup) window.releaseLookup = run; else run() } }
    }
  }, { owner, mode })
  await context.routeWebSocket(/supabase\.co/, socket => socket.close())
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if(url.pathname.endsWith('/water-index/manifest.json')) return route.fulfill({json:{version:'20261123T000000Z',tiles:[]}})
    if(url.hostname==='tiles.openfreemap.org') return route.fulfill({status:503,body:''})
    if (url.origin === base || !url.protocol.startsWith('http')) return route.continue()
    if (url.origin !== 'https://jupuypvmgjpnpntfetqv.supabase.co') { escaped.push(url.origin); return route.abort() }
    const reply = (json, status = 200) => route.fulfill({ status, json, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
    if (request.method() === 'OPTIONS') return reply({})
    if (url.pathname === '/auth/v1/user') return reply({ id: owner })
    if (url.pathname.endsWith('fishing_spot_creation_check')) return mode === 'ban-check-failure' ? reply({},503) : reply({ blocked: mode === 'prohibited', sources: mode === 'prohibited' ? [{ id:'contract-zone',title:'隔离禁钓范围',source:'official',source_url:'https://fixture.gov.cn/notice/1',boundary_known:true }] : [], checked_at:new Date().toISOString() })
    if (url.pathname.endsWith('fishing_read')) { const body = request.postDataJSON(); return reply(body.action === 'edit_content' ? { item, revision: 1, publication: { status: 'published', audience: 'private', precision } } : body.action === 'spot' ? item : { items: [], next: null }) }
    if (url.pathname.endsWith('fishing_write')) { const body = request.postDataJSON(); writes.push(body); return mode === 'save-failure' ? reply({ message: 'REQUEST_FAILED' }, 503) : reply({ id: body.payload.id }) }
    return reply({ items: [] })
  })
  const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${base}/#/pages/spot/create${editing ? `?id=${id}` : ''}`)
  await page.locator('#spot-name').waitFor().catch(async error=>{await page.screenshot({path:`${output}/failed-${mode}.png`,fullPage:true});console.log(JSON.stringify({mode,text:await page.locator('body').innerText(),errors}));throw error})
  return { page, context }
}
async function state(page, action, value) {
  if(action==='select') {
    await page.getByRole('button',{name:/^(?:水域地图选点|更换水域)$/}).click()
    await page.waitForURL(/pages\/map\/index\?/)
    const selectionId=await page.evaluate(value=>{
      const id=new URLSearchParams(location.hash.split('?')[1]).get('requestId')
      if(!id)throw Error('Map handoff request missing')
      localStorage.setItem(`dyj.map.selection.${id}`,JSON.stringify({type:'object',data:{...value,created_at:Date.now()}}))
      return id
    },value)
    await page.getByRole('button',{name:'返回上一页',exact:true}).click()
    await page.waitForURL(/pages\/spot\/create/)
    await page.locator('.spot-entry').waitFor()
    await page.waitForFunction(id=>!localStorage.getItem(`dyj.map.selection.${id}`),selectionId)
    await page.getByText('正在确认水域…',{exact:true}).waitFor({state:'hidden'})
    await page.waitForFunction(({owner,value})=>{
      const saved=JSON.parse(localStorage.getItem(`dyj.live.spot-draft.${owner}`)||'null'),draft=saved?.data||saved
      const edit=[...document.querySelectorAll('[role="button"],uni-button,button')].find(button=>button.textContent.trim()==='保存修改')
      return window.lookupFailure ? document.body.innerText.includes('附近水域或所在城市暂未确认')
        : edit ? document.body.innerText.includes(value.name)&&!edit.hasAttribute('disabled')&&edit.getAttribute('aria-disabled')!=='true'
        : draft?.longitude===value.longitude&&!!draft.city
    },{owner,value}).catch(async error=>{console.log(JSON.stringify({phase:'map-return',text:await page.locator('body').innerText(),errors}));await page.screenshot({path:output+'/map-return-failed.png'});throw error})
  }
  if(action==='snapshot') return page.evaluate(owner=>{
    const saved=JSON.parse(localStorage.getItem(`dyj.live.spot-draft.${owner}`)||'null')
    const draft=saved?.data||saved||{}
    return {...draft,resolved:!!draft.city&&Number.isFinite(draft.longitude)&&Number.isFinite(draft.latitude)}
  },owner)
}
try {
  let session = await open(), page = session.page
  await page.getByText('武汉市',{exact:true}).waitFor()
  assert.equal(await page.evaluate(() => window.locationCalls), 2)
  assert.equal(await page.locator('#spot-city,#spot-precision').count(), 0)
  assert.match(await page.locator('#water-type').innerText(), /自然水域/)
  assert.match(await page.locator('#spot-audience').innerText(), /公开/)
  assert.equal(await page.locator('#spot-name input').inputValue(), '')
  for (const [name,width,height,dark,font] of [['375',375,812,false,16],['320',320,740,false,16],['440',440,956,false,16],['landscape',844,390,false,16],['wide',1280,900,false,16],['dark-large',320,812,true,32]]) {
    await page.setViewportSize({ width, height }); await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' }); await setH5TextScale(page, font)
    const measure = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1, buttons: [...document.querySelectorAll('.spot-entry .mobile-action, .spot-entry [role="button"]')].filter(e => e.getBoundingClientRect().height).map(e => ({ label: e.textContent.trim(), height: e.getBoundingClientRect().height })) }))
    assert.equal(measure.overflow, false, `${name} fits`)
    assert.ok(measure.buttons.length >= 6, `${name}: measured visible Uni actions and picker triggers`)
    for (const button of measure.buttons) assert.ok(button.height >= 48, `${name} ${button.label}: ${button.height}`)
    metrics.push({ name, ...measure }); await page.screenshot({ path: `${output}/${name}.png`, fullPage: true })
  }
  pass('new form automatically resolves one GPS point, defaults public/natural/exact, and fits six layouts')
  await page.setViewportSize({ width:375,height:812 }); await page.emulateMedia({colorScheme:'light'});await setH5TextScale(page,16)
  const disclosure = page.getByRole('button', { name: /补充钓位信息/ })
  await disclosure.focus();await page.keyboard.press('Enter');await page.getByRole('textbox', { name:'到达说明', exact:true }).waitFor()
  await page.screenshot({ path: `${output}/details.png`, fullPage: true })
  await page.locator('#spot-audience').click();await page.getByRole('dialog').waitFor();await page.screenshot({ path:`${output}/audience.png` });await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'保存钓位',exact:true}).click();await page.waitForURL(/#\/(?:pages\/home\/index)?\?tab=spots/)
  const created = writes.at(-1).payload
  assert.equal(created.audience,'public');assert.equal(created.precision,'exact');assert.equal(created.city,'武汉市');assert.equal(created.longitude,gpsPoint[0]);assert.equal(created.name,'武汉隔离水域')
  pass('optional name uses actual selected place and save retains exact GCJ-02 point; disclosure and shared picker work')
  await session.context.close()

  session = await open('denied');page=session.page
  await page.getByText(/附近水域或所在城市暂未确认/).waitFor();const before=writes.length
  await page.getByRole('button',{name:'保存钓位',exact:true}).click();assert.equal(writes.length,before)
  await state(page,'select',place);assert.equal((await state(page,'snapshot')).city,'宁波市')
  await page.screenshot({path:`${output}/manual-point.png`,fullPage:true})
  pass('denied location cannot save; a real map-selection callback derives the same point’s city')
  await session.context.close()

  session=await open('late');page=session.page
  await page.waitForFunction(()=>!!window.releaseLocation);await state(page,'select',place)
  await page.evaluate(()=>window.releaseLocation());await page.waitForTimeout(100)
  assert.equal((await state(page,'snapshot')).city,'宁波市');assert.equal((await state(page,'snapshot')).longitude,121.55)
  pass('late GPS does not overwrite a map-selected city and coordinates');await session.context.close()

  session=await open('lookup-failure');page=session.page
  await page.getByText(/附近水域或所在城市暂未确认/).waitFor();assert.equal((await state(page,'snapshot')).resolved,false)
  await page.evaluate(()=>window.lookupFailure=false);await page.getByRole('button',{name:'重新定位',exact:true}).click();await page.getByText('武汉市',{exact:true}).waitFor()
  await page.evaluate(()=>window.lookupFailure=true);await state(page,'select',place)
  assert.equal((await state(page,'snapshot')).city,'');assert.equal((await state(page,'snapshot')).resolved,false)
  pass('reverse-geocode errors can retry and never combine a new point with the previous city');await session.context.close()

  session=await open('success',true,'area');page=session.page
  await page.getByText(/原记录未开放精确位置/).waitFor();assert.equal(await page.evaluate(()=>window.locationCalls),1)
  assert.match(await page.locator('#spot-audience').innerText(),/仅自己/);const previous=writes.length
  assert.equal(await page.getByRole('button',{name:'保存修改',exact:true}).isDisabled(),true);assert.equal(writes.length,previous)
  await state(page,'select',place);await page.getByRole('button',{name:'保存修改',exact:true}).click();await page.waitForURL(/#\/(?:pages\/home\/index)?\?tab=spots/)
  assert.equal(writes.at(-1).payload.audience,'private');assert.equal(writes.at(-1).payload.name,'旧钓位');assert.equal(writes.at(-1).payload.precision,'exact')
  pass('historical area/private edit requires a new point, preserves its audience and name, and uses revisioned edit');await session.context.close()

  session=await open('save-failure');page=session.page;await page.getByText('武汉市',{exact:true}).waitFor()
  await page.locator('#spot-name input').fill('我保留的钓位');await page.getByRole('button',{name:'保存钓位',exact:true}).click();await page.locator('.error').first().waitFor()
  assert.equal(await page.locator('#spot-name input').inputValue(),'我保留的钓位');assert.equal((await state(page,'snapshot')).longitude,gpsPoint[0])
  pass('failed save leaves the name and selected point available to retry');await session.context.close()
  session=await open('prohibited');page=session.page
  await page.getByText('此位置已标记为禁钓，请重新选择水域。',{exact:true}).waitFor()
  const prohibitedWrites=writes.length
  assert.equal(await page.getByRole('button',{name:'保存钓位',exact:true}).isDisabled(),true)
  await page.screenshot({path:`${output}/prohibited-375.png`,fullPage:true})
  assert.equal(writes.length,prohibitedWrites)
  pass('a confirmed prohibition is visible and disables spot creation without any write');await session.context.close()
  session=await open('ban-check-failure');page=session.page
  await page.getByText('禁钓范围暂未核对，请稍后重试或重新选点。',{exact:true}).waitFor()
  const uncheckedWrites=writes.length
  await page.getByRole('button',{name:'保存钓位',exact:true}).click()
  assert.equal(writes.length,uncheckedWrites)
  pass('a failed prohibition lookup never permits an unchecked spot write');await session.context.close()
  assert.deepEqual(errors,[]);assert.deepEqual(escaped,[])
} finally { await writeFile(`${output}/result.json`,JSON.stringify({checks,errors,escaped,writes,metrics},null,2));await browser.close() }
