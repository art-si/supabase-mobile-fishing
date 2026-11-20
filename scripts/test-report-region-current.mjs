// H5 selector contracts with isolated GPS. Does not verify a real device position.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir,writeFile } from 'node:fs/promises'
import { setH5TextScale } from './h5-text-scale.mjs'
const base=process.env.FISHING_H5_URL||'http://127.0.0.1:5178',output='artifacts/report-region-current',owner='11111111-1111-4111-8111-111111111111'
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));await mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true}),checks=[],errors=[],escaped=[]
async function open(mode='success'){
 const context=await browser.newContext({viewport:{width:375,height:812},locale:'zh-CN',timezoneId:'Asia/Shanghai',reducedMotion:'reduce'})
 await context.addInitScript(({owner,mode})=>{
  localStorage.setItem('dyj.auth.v1',JSON.stringify({type:'object',data:{access_token:'isolated-current-region-contract',refresh_token:'fixture',expires_at:Date.now()/1000+3600,user:{id:owner}}}))
  window.permissionMode=mode==='success'?'granted':'denied';window.locationCalls=0;window.holdLocation=false;window.releaseLocation=null
  Object.defineProperty(navigator,'permissions',{value:{query:async()=>({state:window.permissionMode})}})
  window.AMap={
   Geolocation:class{getCurrentPosition(callback){window.locationCalls++;const done=()=>callback('complete',{position:{getLng:()=>115.2,getLat:()=>29.84},accuracy:12,location_type:'html5'});if(window.holdLocation)window.releaseLocation=done;else setTimeout(done,10)}},
   Geocoder:class{getAddress(point,callback){setTimeout(()=>callback('complete',{regeocode:{formattedAddress:'湖北省黄石市阳新县富池镇隔离定位样本',addressComponent:{adcode:'420222',province:'湖北省',city:'黄石市',district:'阳新县'}}}),10)}}
  }
 },{owner,mode})
 await context.routeWebSocket(/supabase\.co/,s=>s.close())
 await context.route('**/*',route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin===base||!url.protocol.startsWith('http'))return route.continue()
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
  if(url.origin==='https://tlfmfokyhahlpzmpliad.supabase.co')return route.fulfill({status:200,headers,json:url.pathname==='/auth/v1/user'?{id:owner}:{items:[]}})
  escaped.push(url.href);return route.abort()
 })
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message))
 await page.goto(`${base}/#/pages/water-report/index`,{waitUntil:'domcontentloaded'});await page.locator('#report-region').waitFor()
 return{context,page}
}
const dialog=page=>page.getByRole('dialog',{name:'选择事发地区',exact:true})
async function openPicker(page){await page.locator('#report-region').click();await dialog(page).waitFor()}
async function choose(page,name){await dialog(page).locator('input[aria-label="搜索地区"]').fill(name);await dialog(page).getByRole('button',{name:'选择'+name,exact:true}).click();await dialog(page).waitFor({state:'hidden'})}
try{
 let session=await open(),page=session.page
 await page.waitForFunction(()=>document.querySelector('#report-region')?.textContent.includes('阳新县'))
 assert.equal(await page.getByRole('button',{name:'填入当前位置',exact:true}).count(),0)
 await openPicker(page)
 const current=()=>dialog(page).getByRole('button',{name:'当前位置',exact:true})
 assert.match(await current().innerText(),/湖北省.*黄石市.*阳新县/)
 await choose(page,'海曙区');assert.match(await page.locator('#report-region').innerText(),/浙江省.*宁波市.*海曙区/)
 await openPicker(page)
 assert.match(await current().innerText(),/湖北省.*黄石市.*阳新县/)
 assert.match(await dialog(page).locator('.mobile-city-picker__current').innerText(),/海曙区/)
 for(const[name,width,height,dark,scale]of[['375',375,812,false,16],['320',320,740,false,16],['440',440,956,false,16],['landscape',812,375,false,16],['wide',1280,900,false,16],['dark-large',320,812,true,24]]){
  await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:dark?'dark':'light'});await setH5TextScale(page,scale)
  await current().focus();await current().scrollIntoViewIfNeeded()
  assert.ok(await current().evaluate(el=>{const r=el.getBoundingClientRect();return r.height>=48&&r.width>=48&&r.x>=0&&r.right<=innerWidth+1}))
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`${output}/picker-${name}.png`})
 }
 await current().click();await dialog(page).waitFor({state:'hidden'});assert.match(await page.locator('#report-region').innerText(),/湖北省.*黄石市.*阳新县/)
 assert.equal(await page.evaluate(()=>window.locationCalls),1)
 checks.push('current location is a separate item inside the picker, preserves GPS region after manual choice, and fills current region using the existing fix')
 checks.push('320/375/440/landscape/wide/dark-large sheets retain location text, current selection and focusable 48px action')
 await session.context.close()
 session=await open('denied');page=session.page
 await page.getByText('暂未获取当前位置，可手动选择地区并填写具体地点。',{exact:true}).waitFor()
 await openPicker(page);await dialog(page).getByRole('button',{name:'当前位置',exact:true}).click()
 await dialog(page).getByRole('alert').waitFor();assert.match(await dialog(page).innerText(),/定位权限已关闭/)
 await page.screenshot({path:`${output}/retry-375.png`})
 await page.evaluate(()=>{window.permissionMode='granted'})
 await dialog(page).getByRole('button',{name:'当前位置',exact:true}).click();await dialog(page).waitFor({state:'hidden'})
 assert.match(await page.locator('#report-region').innerText(),/阳新县/)
 checks.push('denied location remains in picker with actionable error and retries successfully after permission becomes available')
 await session.context.close()
 session=await open('denied');page=session.page
 await page.getByText('暂未获取当前位置，可手动选择地区并填写具体地点。',{exact:true}).waitFor();await openPicker(page)
 await page.evaluate(()=>{window.permissionMode='granted';window.holdLocation=true})
 await dialog(page).getByRole('button',{name:'当前位置',exact:true}).click();await page.waitForFunction(()=>Boolean(window.releaseLocation))
 await choose(page,'海曙区');await page.evaluate(()=>window.releaseLocation())
 await page.waitForFunction(()=>document.querySelector('#report-region')?.textContent.includes('海曙区'))
 await openPicker(page);await page.waitForFunction(()=>document.querySelector('.mobile-city-picker__locate')?.textContent.includes('阳新县'))
 assert.match(await dialog(page).locator('.mobile-city-picker__current').innerText(),/海曙区/)
 await page.screenshot({path:`${output}/manual-wins-375.png`})
 checks.push('late GPS updates only current-location suggestion and never replaces a manual region selection')
 await session.context.close();assert.deepEqual(errors,[]);assert.deepEqual(escaped,[])
}catch(error){process.exitCode=1;errors.push(String(error))}
finally{await writeFile(`${output}/result.json`,JSON.stringify({passed:!process.exitCode,checks,errors,escaped,boundary:'Isolated GPS/session/API contracts, no real location or hosted write'},null,2));console.log(JSON.stringify({passed:!process.exitCode,checks,errors}));await browser.close()}
