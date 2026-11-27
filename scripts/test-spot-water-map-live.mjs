// Real AMap + real water geometry and public Supabase reads. No accounts or remote writes.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { setH5TextScale } from './h5-text-scale.mjs'
const base=process.env.FISHING_H5_URL||'http://127.0.0.1:5178',out='artifacts/spot-water-map-live'
await mkdir(out,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true})
const context=await browser.newContext({viewport:{width:375,height:812},locale:'zh-CN',reducedMotion:'reduce',
  geolocation:{longitude:114.1885,latitude:30.5128,accuracy:20},permissions:['geolocation']})
await context.addInitScript(()=>{
  let provider
  Object.defineProperty(window,'AMap',{configurable:true,get(){
    if(provider?.Map&&!provider.Map.__readOnlyCaptured){
      const Map=new Proxy(provider.Map,{construct(Target,args){const map=Reflect.construct(Target,args);window.readOnlyMap=map;return map}})
      Map.__readOnlyCaptured=true;provider.Map=Map
    }return provider
  },set(value){provider=value}})
})
const writes=[],errors=[],statuses=[]
await context.route('**/*',route=>{
  const u=new URL(route.request().url())
  if(u.hostname.endsWith('.supabase.co')&&/fishing_(?:write|zones_write|moderation)$/.test(u.pathname)){
    writes.push(u.pathname);return route.abort()
  }return route.continue()
})
const page=await context.newPage();page.setDefaultTimeout(40000)
page.on('pageerror',error=>errors.push(error.message.replace(/https?:\/\/\S+/g,'[URL]')))
page.on('response',response=>{
  const u=new URL(response.url())
  if(u.pathname.includes('_AMapService')||u.pathname.endsWith('fishing_zones_read')) statuses.push({path:u.pathname,status:response.status()})
})
try{
  await page.goto(base+'/#/pages/map/index?pick=1&context=water&requestId=water-readonly-check',{waitUntil:'domcontentloaded'})
  const confirm=page.getByRole('button',{name:'确认这处水域',exact:true})
  await confirm.waitFor();assert.equal(await confirm.isEnabled(),true)
  await page.getByRole('img',{name:'北太子湖',exact:true}).waitFor()
  for(const[name,width,height,dark,font]of[['375',375,812,false,16],['320',320,740,false,16],['440',440,956,false,16],
    ['landscape',844,390,false,16],['wide',1280,900,false,16],['dark-large',320,812,true,28]]){
    await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:dark?'dark':'light'});await setH5TextScale(page,font)
    await page.waitForTimeout(600)
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
    await confirm.focus()
    await page.screenshot({path:`${out}/water-${name}.png`})
  }
  await page.setViewportSize({width:375,height:812});await page.emulateMedia({colorScheme:'light'});await setH5TextScale(page,16)
  await confirm.click()
  const selection=await page.evaluate(()=>{
    const value=JSON.parse(localStorage.getItem('dyj.map.selection.water-readonly-check')||'null')
    return value?.data||value
  })
  assert.equal(selection?.kind,'water');assert.equal(selection.crs,'GCJ-02');assert.equal(selection.name,'北太子湖')
  assert.ok(Number.isFinite(selection.longitude)&&Number.isFinite(selection.latitude))
  // Also inspect the deployed official polygon on the actual basemap, not a fixture overlay.
  await page.goto(base+'/#/pages/map/index',{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.readOnlyMap?.setCenter&&document.querySelector('.amap-layer'))
  await page.getByRole('img',{name:'北太子湖',exact:true}).waitFor()
  const official=JSON.parse(await readFile('data/official-zones/verified.json','utf8')).records.find(row=>row.id==='moa-eighth-16-core-water-1')
  await page.evaluate(point=>window.readOnlyMap.setZoomAndCenter(13,[point.longitude,point.latitude]),official)
  const fence=page.getByRole('button',{name:/查看禁钓区域：琵琶湖/}).first();await fence.waitFor()
  await page.waitForTimeout(1000);await page.screenshot({path:out+'/official-boundary-375.png'})
  await fence.click()
  await page.getByRole('dialog',{name:'禁钓提醒',exact:true}).waitFor()
  await page.getByText('官方公告',{exact:true}).waitFor()
  await page.screenshot({path:out+'/official-detail-375.png'})
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[])
  await writeFile(out+'/result.json',JSON.stringify({passed:true,mode:'real-map-real-public-reads-injected-device-location',selection,statuses,writes,errors},null,2))
  console.log('PASS real water selection and GCJ-02 handoff, six layouts/focus, and deployed official prohibition on the real map')
}catch(error){await page.screenshot({path:out+'/failed.png'});throw error}
finally{await context.close();await browser.close()}
