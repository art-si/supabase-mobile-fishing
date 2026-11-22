// Real AMap SDK/tiles + local business responses. No device GPS or remote writes.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { readFile,mkdir,writeFile } from 'node:fs/promises'
import { setH5TextScale } from './h5-text-scale.mjs'
const base=process.env.FISHING_H5_URL||'http://127.0.0.1:5178', output='artifacts/map-fences/ui'
await mkdir(output,{recursive:true})
const source=JSON.parse(await readFile('data/official-zones/verified.json','utf8'))
// Deliberately isolated fixture; unverified policy boundaries are never published.
const origin=source.records[0], west=origin.longitude-.001, east=origin.longitude+.001, south=origin.latitude-.001, north=origin.latitude+.001
const zones=[{...origin,id:'isolated-map-review',title:'验收样例 · 非真实禁钓区域',description:'此区域仅用于本机界面与交互验收，不是真实管控范围，不发布远端。',source:'official',crs:'GCJ-02',status:'published',revision:1,observed_on:origin.issued_on,expires_on:origin.valid_until||'',created_at:new Date().toISOString(),radius_m:0,boundary:{type:'Polygon',coordinates:[[[west,south],[east,south],[east,north],[west,north],[west,south]]]},provenance:{bounds:{west,east,south,north}}}]

const browser=await chromium.launch({channel:'chrome',headless:true,proxy:process.env.FISHING_BROWSER_PROXY?{server:process.env.FISHING_BROWSER_PROXY,bypass:'127.0.0.1,localhost'}:undefined})
const context=await browser.newContext({viewport:{width:375,height:812},locale:'zh-CN',reducedMotion:'reduce'})
const checks=[],errors=[],writes=[],reads=[],spotReads=[]
await context.addInitScript(()=>{
 localStorage.setItem('dyj.auth.v1',JSON.stringify({type:'object',data:{access_token:'isolated-fence-ui',refresh_token:'isolated',expires_at:Date.now()/1000+3600,user:{id:'11111111-1111-4111-8111-111111111111'}}}))
 Object.defineProperty(navigator,'permissions',{value:{query:async()=>({state:'denied'})}})
 let provider
 Object.defineProperty(window,'AMap',{configurable:true,get(){
  if(provider?.Map&&!provider.Map.__reviewCaptured){
   const Capture=new Proxy(provider.Map,{construct(Target,args){const map=Reflect.construct(Target,args);window.fenceReviewMap=map;window.fenceReviewMapComplete=false;map.on('complete',()=>{window.fenceReviewMapComplete=true});return map}})
   Capture.__reviewCaptured=true;provider.Map=Capture
  }
  return provider
 },set(value){provider=value}})
})
await context.routeWebSocket(/supabase\.co/,(socket)=>socket.close())
await context.route('https://jupuypvmgjpnpntfetqv.supabase.co/**',async route=>{
 const request=route.request(), path=new URL(request.url()).pathname
 if(path.includes('/amap-js/'))return route.continue()
 const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
 if(request.method()==='OPTIONS')return route.fulfill({status:204,headers})
 const data=request.postDataJSON()||{}
 if(path.endsWith('fishing_map_spots'))spotReads.push(data)
 if(path.endsWith('fishing_read')&&data.action==='spot')return route.fulfill({headers,json:{id:data.payload.id,name:'验收钓位',location_label:'隔离圈选验收地址',city:'宜兴市',author:{id:'11111111-1111-4111-8111-111111111111'},longitude:zones[0].longitude,latitude:zones[0].latitude,precision:'exact',fishing_status:'prohibited'}})
 if(path.endsWith('fishing_zones_read')){
  reads.push(data)
  const b=data.payload||{}
  return route.fulfill({headers,json:{items:zones.filter(z=>{const v=z.provenance.bounds;return v.west<=b.east&&v.east>=b.west&&v.south<=b.north&&v.north>=b.south}),zoom_in:false,truncated:false}})
 }
 if(path.endsWith('fishing_zones_write')){writes.push(data);return route.fulfill({headers,json:{id:data.payload.id,status:'published',revision:1}})}
 return route.fulfill({headers,json:{items:[],next:null}})
})
const page=await context.newPage();page.setDefaultTimeout(40000)
page.on('pageerror',e=>errors.push(e.message))
async function verifyCenteredLoading(){
 const loadingPage=await context.newPage()
 loadingPage.setDefaultTimeout(40000)
 loadingPage.on('pageerror',e=>errors.push(e.message))
 let release
 const gate=new Promise(resolve=>{release=resolve})
 await loadingPage.route(/^https:\/\/webapi\.amap\.com\/maps\?/,async route=>{await gate;await route.continue()})
 try{
  const requested=loadingPage.waitForRequest(request=>{const url=new URL(request.url());return url.hostname==='webapi.amap.com'&&url.pathname==='/maps'})
  await loadingPage.goto(`${base}/#/pages/map/index`,{waitUntil:'domcontentloaded'})
  await requested
  const indicator=loadingPage.locator('.mobile-map__loading .mobile-loading-status')
  await indicator.waitFor()
  for(const [name,width,height,dark,scale]of[['375',375,812,false,16],['320-dark-large',320,740,true,24]]){
   await loadingPage.setViewportSize({width,height})
   await loadingPage.emulateMedia({colorScheme:dark?'dark':'light'})
   await setH5TextScale(loadingPage,scale)
   const stage=await loadingPage.locator('.map-stage').boundingBox(),status=await indicator.boundingBox()
   assert.ok(Math.abs(status.x+status.width/2-stage.x-stage.width/2)<2,'loading is horizontally centered in the map stage')
   assert.ok(Math.abs(status.y+status.height/2-stage.y-stage.height/2)<2,'loading is vertically centered in the map stage')
   assert.ok(await loadingPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
   await loadingPage.screenshot({path:`${output}/loading-${name}.png`})
  }
  release()
  await loadingPage.waitForFunction(()=>window.fenceReviewMapComplete===true)
  await loadingPage.locator('.mobile-map__loading').waitFor({state:'hidden'})
  assert.ok(await loadingPage.locator('.amap-layer').count()>0)
  checks.push('blocked SDK loading is centered at 375px and 320px dark large text; releasing it renders the real map')
 }finally{release();await loadingPage.close()}
}
try{
 if(!process.argv.includes('--main-only'))await verifyCenteredLoading()
 await page.goto(`${base}/#/pages/map/index`)
 const input=page.locator('input[aria-label="搜索高德地点"]')
 await input.waitFor();await page.waitForFunction(()=>!!window.fenceReviewMap)
 await page.waitForFunction(()=>window.fenceReviewMapComplete===true)
 await page.locator('.mobile-map__loading').waitFor({state:'hidden'})
 assert.equal(await page.getByRole('button',{name:'重新加载地图',exact:true}).count(),0)
 const searchBox=await page.locator('.mobile-map__search').boundingBox(), mapBox=await page.locator('.mobile-map__canvas').boundingBox()
 assert.ok(searchBox.width>=mapBox.width-25,'search fills the map width with only page insets')
 const before=await page.locator('.mobile-map__canvas').boundingBox()
 await input.fill('宜兴团氿')
 const option=page.getByRole('option').first();await option.waitFor()
 await page.waitForFunction(()=>document.querySelector('[role=option]')?.getAttribute('aria-selected')==='true')
 await page.waitForFunction(()=>!!document.querySelector('.mobile-map__pin svg'))
 const after=await page.locator('.mobile-map__canvas').boundingBox()
 assert.equal(Math.round(before.y),Math.round(after.y));assert.equal(Math.round(before.height),Math.round(after.height))
 assert.ok(await option.locator('.mobile-search__suggestion-icon').count())
 checks.push('first suggestion is highlighted with a location icon and immediately previews a custom map pin; the map never shifts')
 await page.screenshot({path:`${output}/search-375.png`})
 await input.press('Escape')
 await page.evaluate(z=>{window.fenceReviewMap.setCenter([z.longitude,z.latitude]);window.fenceReviewMap.setZoom(14)},zones[0])
 const fence=page.getByRole('button',{name:new RegExp('查看禁钓区域：'+zones[0].title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))})
 await fence.waitFor();await fence.click()
 const detail=page.getByRole('dialog',{name:'禁钓区域',exact:true});await detail.waitFor()
 await detail.getByText(zones[0].location_label,{exact:true}).waitFor()
 assert.ok((await detail.innerText()).includes('官方公告'))
 await page.screenshot({path:`${output}/official-detail-375.png`})
 await page.keyboard.press('Escape');await detail.waitFor({state:'hidden'})
 checks.push('clicking an isolated polygon opens its location, description, source and policy links')
 for(const [name,width,height,dark,scale]of[['375',375,812,false,16],['320',320,740,false,16],['440',440,956,false,16],['landscape',844,390,false,16],['wide',1280,900,false,16],['dark-large',320,812,true,24]]){
  await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:dark?'dark':'light'});await setH5TextScale(page,scale)
  await page.waitForTimeout(500)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  assert.equal(await page.getByRole('button',{name:'我的位置',exact:true}).count(),0)
  assert.equal(await page.getByRole('button',{name:'查看天气',exact:true}).count(),0)
  assert.equal(await page.getByRole('button',{name:'地图内钓位列表',exact:true}).count(),0)
  assert.equal(await page.locator('.map-spot-pin,.map-data-status').count(),0)
  assert.equal(spotReads.length,0)
  await page.screenshot({path:`${output}/map-${name}.png`})
  checks.push(`${name}: real map, forbidden zones only; no saved-spot pins, counts, list or API requests`)
 }
 await page.setViewportSize({width:375,height:812});await page.emulateMedia({colorScheme:'light'});await setH5TextScale(page,16)
 await page.getByRole('button',{name:'标记禁钓区',exact:true}).click()
 assert.equal(await page.locator('.mobile-map__pin svg').count(),0)
 const drawingZoom=await page.evaluate(()=>window.fenceReviewMap.getZoom())
 const canvas=await page.locator('.mobile-map__canvas').boundingBox()
 for(const [index,[x,y]]of[[.4,.42],[.58,.42],[.58,.54],[.4,.54]].entries()){await page.mouse.click(canvas.x+canvas.width*x,canvas.y+canvas.height*y);await page.getByText(`已选 ${index+1} 个边界点`,{exact:true}).waitFor()}
 await page.getByText('已选 4 个边界点',{exact:true}).waitFor()
 assert.equal(await page.locator('.mobile-map__vertex').count(),4)
 assert.equal(await page.evaluate(()=>window.fenceReviewMap.getZoom()),drawingZoom)
 checks.push('rapid consecutive map taps retain every distinct boundary point without double-click zoom')
 await page.getByRole('button',{name:'填写禁钓区说明',exact:true}).click()
 const form=page.getByRole('dialog',{name:'禁钓区说明',exact:true});await form.waitFor()
 await page.locator('input[aria-label="禁钓区名称"]').fill('隔离验收，不写入远端')
 await page.locator('input[aria-label="地理位置"]').fill('本机交互验收地点')
 await page.locator('textarea[aria-label="禁钓依据与描述"]').fill('仅用于验证多边形上报流程，不是真实管控信息，不提交远端。')
 await form.getByRole('checkbox').click()
 await page.screenshot({path:`${output}/report-375.png`})
 await form.getByRole('button',{name:'保存禁钓标记',exact:true}).click()
 await form.waitFor({state:'hidden'})
 assert.equal(writes.length,1);assert.equal(writes[0].payload.boundary.type,'Polygon');assert.equal(writes[0].payload.boundary.coordinates[0].length,5)
 checks.push('water-surface marking saves a closed polygon and description directly; remote writes were intercepted')
 await page.goto(`${base}/#/pages/map/index?markSpot=22222222-2222-4222-8222-222222222222`)
 await page.reload({waitUntil:'domcontentloaded'})
 await page.getByText('圈出禁钓水域',{exact:true}).waitFor()
 await page.waitForFunction(()=>window.fenceReviewMapComplete===true)
 await page.locator('.mobile-map__loading').waitFor({state:'hidden'})
 const at=await page.evaluate(()=>{const p=window.fenceReviewMap.getCenter();return[p.getLng(),p.getLat()]})
 assert.ok(Math.abs(at[0]-zones[0].longitude)<.00001&&Math.abs(at[1]-zones[0].latitude)<.00001)
 const bounds=await page.locator('.mobile-map__canvas').boundingBox()
 for(const [x,y]of[[.4,.42],[.58,.42],[.58,.54]]){await page.mouse.click(bounds.x+bounds.width*x,bounds.y+bounds.height*y);await page.waitForTimeout(220)}
 await page.getByRole('button',{name:'填写禁钓区说明',exact:true}).click()
 await page.getByRole('dialog',{name:'禁钓区说明',exact:true}).waitFor()
 assert.equal(await page.locator('input[aria-label="禁钓区名称"]').inputValue(),'验收钓位禁钓区')
 assert.equal(await page.locator('input[aria-label="地理位置"]').inputValue(),'隔离圈选验收地址')
 await page.waitForTimeout(350)
 await page.screenshot({path:`${output}/spot-handoff-375.png`})
 checks.push('spot entry centers on authorized coordinates, starts boundary drawing and reuses its name and address')
 assert.deepEqual(errors,[])
 await writeFile(`${output}/result.json`,JSON.stringify({checks,errors,readCount:reads.length,boundary:'Real AMap rendering; isolated business API. No actual GPS, publication or moderation.'},null,2))
 console.log(JSON.stringify({checks,errors},null,2))
}catch(error){await page.screenshot({path:`${output}/failed.png`});console.log(JSON.stringify({drawing:await page.locator('.zone-drawing').innerText().catch(()=>''),vertices:await page.locator('.mobile-map__vertex').count(),errors}));throw error}finally{await context.close();await browser.close()}
