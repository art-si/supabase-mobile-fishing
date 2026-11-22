// Real hosted reads and real AMap with injected browser coordinates.
import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {setH5TextScale} from './h5-text-scale.mjs'
const base=process.env.FISHING_H5_URL||'http://127.0.0.1:5178',out='artifacts/water-map-readonly'
await mkdir(out,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true,proxy:process.env.FISHING_BROWSER_PROXY?{server:process.env.FISHING_BROWSER_PROXY,bypass:'127.0.0.1,localhost'}:undefined})
const context=await browser.newContext({viewport:{width:375,height:812},locale:'zh-CN',reducedMotion:'reduce',geolocation:{longitude:114.1885,latitude:30.5128,accuracy:40}})
await context.addInitScript(()=>{
 let provider
 Object.defineProperty(window,'AMap',{configurable:true,get(){if(provider?.Map&&!provider.Map.__readOnlyCaptured){const Capture=new Proxy(provider.Map,{construct(Target,args){const map=Reflect.construct(Target,args);window.readOnlyMap=map;return map}});Capture.__readOnlyCaptured=true;provider.Map=Capture}return provider},set(value){provider=value}})
})
const errors=[],writes=[],spotReads=[],failed=[]
await context.route('**/*',route=>{
 const req=route.request(),u=new URL(req.url())
 if(/fishing_(?:write|zones_write|moderation)$/.test(u.pathname)){writes.push(u.pathname);return route.abort()}
 if(u.pathname.endsWith('fishing_map_spots'))spotReads.push(u.pathname)
 return route.continue()
})
const page=await context.newPage();page.setDefaultTimeout(45000)
page.on('pageerror',e=>errors.push(e.message.replace(/https?:\/\/\S+/g,'[URL]')))
page.on('requestfailed',r=>{const u=new URL(r.url());failed.push({host:u.hostname,path:u.pathname,error:r.failure()?.errorText})})
try{
 await page.goto(`${base}/#/pages/map/index`,{waitUntil:'domcontentloaded'})
 await page.getByText('请先开启位置',{exact:true}).waitFor()
 assert.equal(await page.locator('.amap-layer').count(),0)
 await context.grantPermissions(['geolocation'],{origin:new URL(base).origin})
 await page.locator('input[aria-label="搜索高德地点"]').waitFor()
 await page.locator('.mobile-map__loading').waitFor({state:'hidden'})
 await page.waitForFunction(()=>document.querySelector('.amap-layer')||document.body.innerText.includes('地图暂时未能加载'))
 assert.equal(await page.getByText('地图暂时未能加载',{exact:true}).count(),0)
 assert.ok(await page.locator('.amap-layer').count())
 assert.equal(await page.getByRole('button',{name:'标记禁钓区',exact:true}).count(),0)
 await page.getByRole('button',{name:'定位附近水域',exact:true}).waitFor()
 await page.getByRole('img',{name:'北太子湖',exact:true}).waitFor()
 for(const[name,width,height,dark,scale]of[['375',375,812,false,16],['320',320,740,false,16],['393',393,852,false,16],['440',440,956,false,16],['landscape',844,390,false,16],['wide',1280,900,false,16],['dark-large',320,812,true,32]]){
  if(process.argv.includes('--focused')&&name!=='375')continue
  await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:dark?'dark':'light'});await setH5TextScale(page,scale)
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
   return [
    leading.left-search.left, search.right-controls.right,
    stage.top-header.bottom, stage.bottom-innerHeight
   ]
  })
  assert.ok(edges.every(delta=>Math.abs(delta)<=1),`${name}: header, search, map area and controls share their edges`)
  assert.equal(await page.getByText('已定位到北太子湖',{exact:true}).count(),0)
  await page.screenshot({path:`${out}/map-${name}.png`})
 }
 await page.setViewportSize({width:375,height:812});await page.emulateMedia({colorScheme:'light'});await setH5TextScale(page,16)
 await page.getByRole('button',{name:'地图内禁钓区域',exact:true}).click()
 const zoneList=page.getByRole('dialog',{name:'地图内禁钓区域',exact:true});await zoneList.waitFor()
 await zoneList.getByText('正在读取禁钓区域…',{exact:true}).waitFor({state:'hidden'})
 await page.screenshot({path:`${out}/zones-list-375.png`})
 await page.keyboard.press('Escape')
 const official=JSON.parse(await readFile('data/official-zones/verified.json','utf8')).records.find(r=>r.id==='moa-eighth-16-core-water-1')
 await page.evaluate(p=>{window.readOnlyMap.setCenter([p.longitude,p.latitude]);window.readOnlyMap.setZoom(13)},official)
 const actualFence=page.getByRole('button',{name:new RegExp('查看禁钓区域：琵琶湖')}).first()
 await actualFence.waitFor()
 await page.waitForLoadState('networkidle',{timeout:12000}).catch(()=>{})
 await page.waitForTimeout(800)
 await page.screenshot({path:`${out}/official-pipa-map-375.png`})
 await actualFence.click()
 const zoneDetail=page.getByRole('dialog',{name:'禁钓提醒',exact:true});await zoneDetail.waitFor()
 await zoneDetail.getByText('官方公告',{exact:true}).waitFor()
 assert.equal(await actualFence.getAttribute('aria-pressed'),'true')
 await page.waitForTimeout(350)
 await page.screenshot({path:`${out}/official-pipa-detail-375.png`})
 await page.keyboard.press('Escape')
 await page.goto(`${base}/#/pages/spot/detail?id=6bb2c964-34db-4c83-8cde-903ee728022e`,{waitUntil:'domcontentloaded'})
 const address=page.locator('.spot-summary__place .fishing-place-link__label');await address.waitFor()
 await page.waitForFunction(()=>document.querySelector('.spot-summary__place .fishing-place-link__label')?.textContent&&!document.querySelector('.spot-summary__place .fishing-place-link__label').textContent.includes(' · '),{},{timeout:15000}).catch(()=>{})
 await page.screenshot({path:`${out}/live-spot-375.png`,fullPage:true})
 const realAddress=await address.innerText()
 assert.equal(await page.getByText('待审核',{exact:true}).count(),0)
 await page.goto(`${base}/#/pages/home/index?tab=spots`,{waitUntil:'domcontentloaded'})
 await page.getByRole('button',{name:'水域地图',exact:true}).waitFor()
 await page.locator('.spot-card').first().waitFor()
 assert.equal(await page.getByRole('button',{name:/开启定位|选择我的位置|距离由近到远/}).count(),0)
 assert.equal(await page.locator('.spot-card').filter({has:page.getByRole('button',{name:/^查看钓位：/})}).locator('.spot-card__distance').count(),0)
 await page.screenshot({path:`${out}/live-spots-guest-375.png`,fullPage:true})
 assert.equal(spotReads.length,0);assert.deepEqual(writes,[]);assert.deepEqual(errors,[])
 await writeFile(`${out}/result.json`,JSON.stringify({passed:true,spotReads,writes,errors,failed,address:realAddress,scope:'real hosted reads and AMap; browser location granted with injected coordinates; guest community cards carry no private distances'},null,2))
 console.log('PASS real hosted map, official Pipa boundaries and published spots; guest list has no location controls')
}catch(error){await page.screenshot({path:`${out}/failed.png`,fullPage:true});await writeFile(`${out}/diagnostic.json`,JSON.stringify({errors,writes,spotReads,failed,text:await page.locator('body').innerText()},null,2));throw error}finally{await context.close();await browser.close()}
