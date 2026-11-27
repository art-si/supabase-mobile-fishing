// Real hosted reads and real AMap with injected browser coordinates.
import {chromium,_android} from 'playwright'
import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {setH5TextScale} from './h5-text-scale.mjs'
const serial=process.env.ANDROID_SERIAL
if(serial)assert.match(serial,/^emulator-\d+$/,'Only an isolated QA emulator can run the native map audit')
const device=serial&&(await _android.devices()).find(item=>item.serial()===serial)
if(serial)assert.ok(device,'QA emulator is not connected')
const base=device?'https://localhost':process.env.FISHING_H5_URL||'http://127.0.0.1:5178',out=process.env.UI_OUTPUT_DIR||'artifacts/water-map-readonly'
await mkdir(out,{recursive:true})
const previewPort=process.env.FISHING_STATIC_PREVIEW_PORT
if(previewPort)assert.ok(!device&&new URL(base).origin==='http://localhost:5178'&&/^\d+$/.test(previewPort)&&Number(previewPort)>0&&Number(previewPort)<=65535)
const browser=!device&&await chromium.launch({channel:'chrome',headless:true,args:previewPort?[`--host-resolver-rules=MAP localhost:5178 127.0.0.1:${previewPort}`]:[],proxy:process.env.FISHING_BROWSER_PROXY?{server:process.env.FISHING_BROWSER_PROXY,bypass:'127.0.0.1,localhost'}:undefined})
const page=device?await(await device.webView({pkg:'com.diaoyouji.fishing.mapqa'})).page():await(await browser.newContext({viewport:{width:375,height:812},hasTouch:true,locale:'zh-CN',reducedMotion:'reduce',geolocation:{longitude:114.1885,latitude:30.5128,accuracy:40}})).newPage()
const context=page.context()
const capture=(name,fullPage=false)=>device?device.screenshot({path:`${out}/${name}.png`}):page.screenshot({path:`${out}/${name}.png`,fullPage})
await page.addInitScript(()=>{
 let provider
 Object.defineProperty(window,'AMap',{configurable:true,get(){if(provider?.Map&&!provider.Map.__readOnlyCaptured){const Capture=new Proxy(provider.Map,{construct(Target,args){const map=Reflect.construct(Target,args);window.readOnlyMap=map;return map}});Capture.__readOnlyCaptured=true;provider.Map=Capture}return provider},set(value){provider=value}})
})
const errors=[],writes=[],spotReads=[],failed=[]
page.on('dialog',async dialog=>{errors.push(`Unexpected native ${dialog.type()}: ${dialog.message().slice(0,120)}`);await dialog.dismiss()})
let renderedTiles=0
context.on('response',response=>{const url=new URL(response.url());if(response.ok()&&((/^jsapi-data\d+\.amap\.com$/.test(url.hostname)&&url.pathname.startsWith('/tile/'))||(/^w(?:prd|ebrd)\d+\.is\.autonavi\.com$/.test(url.hostname)&&url.pathname==='/appmaptile')))renderedTiles++})
page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.endsWith('fishing_map_spots'))spotReads.push(path)})
await page.route(/\/fishing_(?:write|zones_write|moderation)(?:\?|$)/,route=>{writes.push(new URL(route.request().url()).pathname);return route.abort()})
async function basemapColors(){
 const screenshot=(await page.screenshot()).toString('base64')
 return page.evaluate(async data=>{
  const image=new Image();image.src='data:image/png;base64,'+data;await image.decode()
  const canvas=document.createElement('canvas');canvas.width=125;canvas.height=125
  const painter=canvas.getContext('2d');painter.drawImage(image,image.width*.07,image.height*.22,image.width*.65,image.height*.49,0,0,125,125)
  const rgba=painter.getImageData(0,0,125,125).data,counts=new Map()
  for(let offset=0;offset<rgba.length;offset+=4){const color=(rgba[offset]>>4)*256+(rgba[offset+1]>>4)*16+(rgba[offset+2]>>4);counts.set(color,(counts.get(color)||0)+1)}
  return [...counts.values()].filter(count=>count>=10).length
 },screenshot)
}
page.setDefaultTimeout(45000)
page.on('pageerror',e=>errors.push(e.message.replace(/https?:\/\/\S+/g,'[URL]')))
page.on('requestfailed',r=>{const u=new URL(r.url());failed.push({host:u.hostname,path:u.pathname,error:r.failure()?.errorText})})
try{
 await page.goto(`${base}/${device?'?native-map-qa':''}#/pages/map/index`,{waitUntil:'domcontentloaded'})
 if(device)assert.equal(await page.evaluate(()=>window.Capacitor?.getPlatform()),'android')
 else{
  await page.getByText('请先开启位置',{exact:true}).waitFor()
  assert.equal(await page.locator('.amap-layer').count(),0)
  await context.grantPermissions(['geolocation'],{origin:new URL(base).origin})
 }
 await page.locator('input[aria-label="搜索高德地点"]').waitFor()
 await page.locator('.mobile-map__loading').waitFor({state:'hidden'})
 const settled=()=>page.waitForFunction(()=>document.querySelector('.amap-layer')||document.body.innerText.includes('地图暂时未能加载'))
 const unavailable=page.getByText('地图暂时未能加载',{exact:true})
 await settled()
 if(await unavailable.isVisible()){
  await capture('load-error')
  await page.getByRole('button',{name:'重新加载地图',exact:true}).click()
  await settled()
  if(await unavailable.isVisible()){
   await page.getByRole('button',{name:'改用地点搜索与静态预览',exact:true}).click()
   await page.getByText('先找到那片水',{exact:true}).waitFor();await capture('static-fallback')
   await writeFile(`${out}/recovery.json`,JSON.stringify({runtime:device?'Android emulator / Capacitor':'H5 Chromium',liveBasemap:false,retry:true,staticSearchOpened:true},null,2))
   throw Error('Online basemap unavailable after retry; the static search recovery was verified separately')
  }
 }
 assert.ok(await page.locator('.amap-layer').count())
 assert.equal(await page.getByRole('button',{name:'标记禁钓区',exact:true}).count(),0)
 await page.getByRole('button',{name:'定位附近水域',exact:true}).waitFor()
 await page.getByRole('img',{name:'北太子湖',exact:true}).waitFor()
 let colors=0
 for(let attempt=0;attempt<16&&colors<30;attempt++){await page.waitForTimeout(1200);colors=await basemapColors()}
 assert.ok(colors>=30,`North Taizi's roads and parks must render, not just its shoreline on an empty canvas (${colors} color bands, ${renderedTiles} tile responses)`)
 const profiles=device?[['android']]:[['375',375,812,false,16],['320',320,740,false,16],['393',393,852,false,16],['440',440,956,false,16],['landscape',844,390,false,16],['wide',1280,900,false,16],['dark-large',320,812,true,32]]
 for(const[name,width,height,dark,scale]of profiles){
  if(!device&&process.argv.includes('--focused')&&name!=='375')continue
  if(!device){await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:dark?'dark':'light'});await setH5TextScale(page,scale)}
  await page.waitForTimeout(350)
  await page.waitForLoadState('networkidle',{timeout:12000}).catch(()=>{})
  await page.waitForTimeout(800)
  assert.equal(await page.locator('.map-spot-pin,.map-data-status').count(),0)
  assert.equal(await page.getByRole('button',{name:'地图内钓位列表',exact:true}).count(),0)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  const edges=await page.evaluate(()=>{
   const rect=selector=>document.querySelector(selector).getBoundingClientRect()
   const leading=rect('.top-bar__icon--leading')
   const search=rect('.mobile-map__search'),controls=rect('.mobile-map__controls')
   const stage=rect('.map-stage'),header=rect('.top-bar')
   const probe=document.createElement('div');probe.style.paddingBottom='var(--mobile-safe-bottom, 0px)';document.querySelector('.map-stage').append(probe)
   const safeBottom=parseFloat(getComputedStyle(probe).paddingBottom);probe.remove()
   return [
    leading.left-search.left, search.right-controls.right,
    stage.top-header.bottom, stage.bottom+safeBottom-innerHeight
   ]
  })
  assert.ok(edges.every(delta=>Math.abs(delta)<=1),`${name}: header, search, map area and controls share their edges`)
  assert.equal(await page.getByText('已定位到北太子湖',{exact:true}).count(),0)
  await capture(`map-${name}`)
 }
 if(!device){await page.setViewportSize({width:375,height:812});await page.emulateMedia({colorScheme:'light'});await setH5TextScale(page,16)}
 const formFactor=device?'android':'375'
 const perspective=page.getByRole('button',{name:'切换三维地图',exact:true})
 const webgl=await page.evaluate(()=>window.AMap.Browser?.isWebGL!==false)
 if(!webgl){assert.equal(await perspective.count(),0);assert.equal(await page.evaluate(()=>window.readOnlyMap.getPitch()),0)}
 else{
  await perspective.click();await page.waitForFunction(()=>window.readOnlyMap.getPitch()>10)
  assert.equal(await page.getByRole('button',{name:'切换二维地图',exact:true}).getAttribute('aria-pressed'),'true')
  await capture(`map-3d-${formFactor}`)
  await page.getByRole('button',{name:'切换二维地图',exact:true}).click();await page.waitForFunction(()=>window.readOnlyMap.getPitch()===0)
 }
 const canvas=await page.locator('.mobile-map__canvas').boundingBox()
 const beforePan=await page.evaluate(()=>window.readOnlyMap.getCenter().getLng())
 if(device){
  const dpr=await page.evaluate(()=>devicePixelRatio)
  const point=(x,y)=>({x:Math.round((canvas.x+x)*dpr),y:Math.round((canvas.y+y)*dpr)})
   const start=point(85,170),end=point(160,196)
   await device.shell(`input touchscreen swipe ${start.x} ${start.y} ${end.x} ${end.y} 280`)
 }else{await page.mouse.move(canvas.x+85,canvas.y+170);await page.mouse.down();await page.mouse.move(canvas.x+160,canvas.y+196,{steps:10});await page.mouse.up()}
 await page.waitForFunction(before=>Math.abs(window.readOnlyMap.getCenter().getLng()-before)>0.00001,beforePan)
 const beforeZoom=await page.evaluate(()=>window.readOnlyMap.getZoom())
 const zoomOut=beforeZoom>=15
 const session=await context.newCDPSession(page),middle=canvas.x+canvas.width/2
 const fingers=apart=>[-1,1].map((direction,index)=>({id:index+1,x:middle+direction*apart,y:canvas.y+260}))
 const gaps=zoomOut?[96,82,68,54,40,26]:[26,40,54,68,82,96]
 try{
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:fingers(gaps[0])})
  for(const apart of gaps.slice(1)){
   await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:fingers(apart)})
   await page.evaluate(()=>new Promise(requestAnimationFrame))
  }
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
 }finally{await session.detach()}
 await page.waitForFunction(({beforeZoom,zoomOut})=>zoomOut?window.readOnlyMap.getZoom()<beforeZoom:window.readOnlyMap.getZoom()>beforeZoom,{beforeZoom,zoomOut})
 await page.getByRole('button',{name:'地图内禁钓区域',exact:true}).click()
 const zoneList=page.getByRole('dialog',{name:'地图内禁钓区域',exact:true});await zoneList.waitFor()
 await zoneList.getByText('正在读取禁钓区域…',{exact:true}).waitFor({state:'hidden'})
 await capture(`zones-list-${formFactor}`)
 await page.keyboard.press('Escape')
 const official=JSON.parse(await readFile('data/official-zones/verified.json','utf8')).records.find(r=>r.id==='moa-eighth-16-core-water-1')
 await page.evaluate(p=>{window.readOnlyMap.setCenter([p.longitude,p.latitude]);window.readOnlyMap.setZoom(13)},official)
 const actualFence=page.getByRole('button',{name:new RegExp('查看禁钓区域：琵琶湖')}).first()
 await actualFence.waitFor()
 await page.waitForLoadState('networkidle',{timeout:12000}).catch(()=>{})
 await page.waitForTimeout(800)
 await capture(`official-pipa-map-${formFactor}`)
 await actualFence.click()
 const zoneDetail=page.getByRole('dialog',{name:'禁钓提醒',exact:true});await zoneDetail.waitFor()
 await zoneDetail.getByText('官方公告',{exact:true}).waitFor()
 assert.equal(await actualFence.getAttribute('aria-pressed'),'true')
 await page.waitForTimeout(350)
 await capture(`official-pipa-detail-${formFactor}`)
 await page.keyboard.press('Escape')
 const mapEvidence={runtime:device?'Android emulator / Capacitor':'H5 Chromium',location:device?'emulator geo fix':'browser test coordinates',basemapColors:colors,tileResponses:renderedTiles,perspective:webgl?'real 3D and 2D camera':'2D only; unsupported control hidden',gestures:['pan','touch pinch',...(webgl?['3D','2D']:[])],water:'北太子湖',officialBoundary:'琵琶湖'}
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[])
 await writeFile(`${out}/map.json`,JSON.stringify(mapEvidence,null,2))
 const listRead=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/rpc/fishing_read')&&response.request().method()==='POST'&&response.request().postDataJSON()?.action==='spots'&&response.ok())
 await page.goto(`${base}/#/pages/home/index?tab=spots`,{waitUntil:'domcontentloaded'})
 const publicList=await listRead,origin=publicList.request().postDataJSON().payload.origin
 assert.ok([origin.longitude,origin.latitude].every(value=>Number.isFinite(value)&&Math.abs(value/.02-Math.round(value/.02))<1e-7),'guest search must send coarse coordinates')
 const {items}=await publicList.json();assert.ok(Array.isArray(items))
 for(const spot of items.filter(spot=>spot.precision==='hidden'))assert.ok(spot.latitude==null&&spot.longitude==null&&spot.distance_m==null,'hidden spot exposed coordinates or distance')
 await page.locator('input[aria-label="搜索钓位"]').waitFor()
 await page.locator('.spot-card').first().waitFor()
 assert.equal(await page.getByRole('button',{name:/开启定位|选择我的位置|距离由近到远/}).count(),0)
 await capture(`live-spots-guest-${formFactor}`,true)
 let spotDetail='no community spot in the current public list'
 for(const spot of items.filter(item=>item.audience==='public'&&item.status==='published')){
  const publicSpot=page.getByRole('button',{name:`查看钓位：${spot.name}`,exact:true}).first()
  if(!await publicSpot.isVisible())continue
  await publicSpot.click();await page.waitForURL(/\/pages\/spot\/detail\?id=/)
  await page.locator('.spot-summary').waitFor()
  assert.equal(await page.getByText('待审核',{exact:true}).count(),0)
  await capture(`live-spot-${formFactor}`,true);spotDetail='opened from public list';break
 }
 assert.equal(spotReads.length,0);assert.deepEqual(writes,[]);assert.deepEqual(errors,[])
 await writeFile(`${out}/result.json`,JSON.stringify({passed:true,...mapEvidence,spotReads,writes,errors,failed,spotDetail,scope:'real hosted reads and AMap; simulated location; guest query uses coarse coordinates'},null,2))
 console.log('PASS real AMap gestures, official Pipa boundaries and guest list; public detail:',spotDetail)
}catch(error){
 await capture('failed',true).catch(()=>{})
 const map=await page.evaluate(()=>({sdk:!!window.AMap,webgl:window.AMap?.Browser?.isWebGL,zoom:window.readOnlyMap?.getZoom(),pitch:window.readOnlyMap?.getPitch(),canvasOpacity:document.querySelector('.mobile-map__canvas')&&getComputedStyle(document.querySelector('.mobile-map__canvas')).opacity,visibleError:!!document.querySelector('.map-unavailable'),waterPin:!!document.querySelector('.water-map-drag-pin')})).catch(()=>null)
 await writeFile(`${out}/diagnostic.json`,JSON.stringify({map,tileResponses:renderedTiles,errors,writes,spotReads,failed,reason:String(error.message).replace(/https?:\/\/\S+/g,'[URL]').slice(0,500)},null,2));throw error
}finally{if(device)await device.close();else await browser.close()}
