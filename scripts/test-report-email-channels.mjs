// Real H5 components with isolated GPS/POI/read/mail handoff contracts. No mail, phone, upload or hosted write.
import assert from 'node:assert/strict'
import { mkdir,writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { setH5TextScale } from './h5-text-scale.mjs'
const base=process.env.FISHING_H5_URL||'http://127.0.0.1:5178',output='artifacts/report-email-channels',owner='11111111-1111-4111-8111-111111111111'
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));await mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true}),checks=[],errors=[],escaped=[]
const context=await browser.newContext({viewport:{width:375,height:812},locale:'zh-CN',timezoneId:'Asia/Shanghai',reducedMotion:'reduce',permissions:['geolocation'],geolocation:{longitude:121.55,latitude:29.87}})
const report={id:'22222222-2222-4222-8222-222222222222',category:'electric',province:'湖北省',city:'武汉市',district:'蔡甸区',location_label:'隔离验收河段',longitude:114.18,latitude:30.497,description:'亲眼所见的线索（隔离验收样本）',media:[],created_at:new Date().toISOString(),observed_at:new Date().toISOString(),status:'saved',crs:'GCJ-02'}
await context.addInitScript(({owner})=>{
 localStorage.setItem('dyj.auth.v1',JSON.stringify({type:'object',data:{access_token:'isolated-channel-fixture',refresh_token:'fixture',expires_at:Date.now()/1000+3600,user:{id:owner}}}))
 window.mailHandoffs=[]
 Object.defineProperty(navigator,'permissions',{value:{query:async()=>({state:'granted'})}})
 window.AMap={
  Geolocation:class{getCurrentPosition(done){setTimeout(()=>done('complete',{position:{getLng:()=>114.18,getLat:()=>30.497},accuracy:10}),10)}},
  Geocoder:class{getAddress(point,done){done('complete',{regeocode:{formattedAddress:'湖北省武汉市蔡甸区（隔离定位）',addressComponent:{adcode:'420114',province:'湖北省',city:'武汉市',district:'蔡甸区'}}})}},
  PlaceSearch:class{search(query,done){done('complete',{poiList:{pois:[{id:'fixture-agency',name:'蔡甸区农业综合执法大队',cityname:'武汉市',adname:'蔡甸区',address:'隔离样本',location:{getLng:()=>114.181,getLat:()=>30.498}}]}})}}
 }
},{owner})
await context.routeWebSocket(/supabase\.co/,socket=>socket.close())
await context.route('**/*',route=>{
 const req=route.request(),url=new URL(req.url()),headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
 if(url.origin===base){
  if(url.pathname==='/src/platforms/report-mail.ts')return route.fulfill({contentType:'application/javascript',body:'export function openReportMail(url){window.mailHandoffs.push(url);return true} '})
  return route.continue()
 }
 if(!url.protocol.startsWith('http'))return route.continue()
 if(url.origin==='https://jupuypvmgjpnpntfetqv.supabase.co'){
  if(req.method()==='OPTIONS')return route.fulfill({headers,json:{}})
  if(url.pathname==='/auth/v1/user')return route.fulfill({headers,json:{id:owner}})
  if(url.pathname.endsWith('/fishing_read'))return route.fulfill({headers,json:req.postDataJSON()?.payload?.id?report:{items:[],next:null}})
 }
 escaped.push(req.method()+' '+url.origin+url.pathname);return route.abort()
})
const page=await context.newPage();page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(e.message))
const button=name=>page.getByRole('button',{name,exact:true})
try{
 await page.goto(`${base}/#/pages/water-report/index?id=${report.id}`,{waitUntil:'domcontentloaded'})
 await button('举报联系方式').click()
 await page.getByText('蔡甸区农业综合执法大队',{exact:true}).waitFor()
 await page.getByText(/距所选水域约[\d.]+[米公]/).waitFor()
 const cards=page.locator('.panel').filter({has:page.getByText('信息核对：2026-11-20',{exact:true})})
 assert.match(await cards.first().innerText(),/蔡甸区农业综合执法大队/)
 const directoryNames=await page.locator('.report-channel__toggle + .stack > .panel .name').allTextContents()
 assert.equal(directoryNames[0],'蔡甸区农业综合执法大队')
 assert.ok(directoryNames.indexOf('中国渔政举报受理平台')>0)
 checks.push('current location resolves an exact same-city agency; local contact leads national fallbacks and displays real-adapter straight-line distance')
 const emailCard=page.locator('.panel').filter({has:page.getByText('公安部“长江大保护”举报中心',{exact:true})})
 await emailCard.getByRole('button',{name:'发送邮件',exact:true}).click()
 const sheet=page.getByRole('dialog',{name:'我的邮箱资料',exact:true});await sheet.waitFor()
 await button('保存邮箱资料').click();await page.getByText('请填写称呼，最多40字',{exact:true}).waitFor()
 await sheet.locator('input[aria-label="称呼"]').fill('隔离测试联系人')
 await sheet.locator('input[aria-label="联系邮箱"]').fill('invalid')
 await button('保存邮箱资料').click();await page.getByText(/请填写有效邮箱/).waitFor()
 await sheet.locator('input[aria-label="联系邮箱"]').fill('fixture@example.com')
 await page.screenshot({path:`${output}/mail-contact-375.png`})
 await button('保存邮箱资料').click()
 const confirm=page.getByRole('dialog',{name:'在自己的邮箱中发送',exact:true});await confirm.waitFor()
 assert.equal(await page.evaluate(()=>window.mailHandoffs.length),0)
 assert.match(await confirm.innerText(),/changjiangjinbu@163.com/)
 assert.match(await confirm.innerText(),/fixture@example.com/)
 await page.screenshot({path:`${output}/mail-confirm-375.png`})
 await page.keyboard.press('Escape');await confirm.waitFor({state:'hidden'})
 assert.equal(await page.evaluate(()=>window.mailHandoffs.length),0)
 await emailCard.getByRole('button',{name:'发送邮件',exact:true}).click();await confirm.waitFor();await button('打开邮箱').click()
 await page.getByText(/^已请求打开邮箱/).waitFor()
 const uri=new URL(await page.evaluate(()=>window.mailHandoffs[0]))
 assert.equal(decodeURIComponent(uri.pathname),'changjiangjinbu@163.com');assert.ok(uri.searchParams.get('body').includes(report.description));assert.ok(uri.searchParams.get('body').includes('fixture@example.com'))
 assert.equal(uri.searchParams.get('from'),null);assert.equal(uri.searchParams.get('attach'),null)
 checks.push('mail action requires personal contact details, validates inline, supports cancel, then hands encoded recipient/body to isolated mail adapter without claiming delivery')
 for(const[name,width,height,dark,size]of[['375',375,812,false,16],['320',320,740,false,16],['440',440,956,false,16],['landscape',812,375,false,16],['wide',1280,800,false,16],['dark-large',320,740,true,24]]){
  await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:dark?'dark':'light'});await setH5TextScale(page,size)
  await emailCard.scrollIntoViewIfNeeded()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  for(const group of await emailCard.locator('.mobile-action-group').all()){
   const boxes=await group.locator('button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}}))
   assert.ok(boxes.every(b=>b.h>=48&&b.w>=48))
   if(boxes.length===2&&Math.abs(boxes[0].y-boxes[1].y)<1){assert.ok(Math.abs(boxes[0].h-boxes[1].h)<1);assert.ok(Math.abs(boxes[0].w-boxes[1].w)<1)}
  }
  await page.screenshot({path:`${output}/channels-${name}.png`})
 }
 checks.push('all contact/source/email actions align, equal columns adapt at 320/375/440/landscape/wide/dark large text without overflow')
 await button('选择举报机构').click()
 const agencies=page.getByRole('dialog',{name:'选择举报机构',exact:true})
 const writeMail=agencies.getByRole('button',{name:'公安部“长江大保护”举报中心，写举报邮件',exact:true})
 await writeMail.click()
 await confirm.waitFor()
 await confirm.getByRole('button',{name:'取消',exact:true}).click()
 await confirm.waitFor({state:'hidden'})
 await writeMail.click()
 assert.equal(await page.evaluate(()=>window.mailHandoffs.length),1)
 await confirm.getByRole('button',{name:'打开邮箱',exact:true}).click()
 const picked=new URL(await page.evaluate(()=>window.mailHandoffs[1]))
 assert.equal(picked.pathname,'changjiangjinbu@163.com')
 assert.match(picked.searchParams.get('body'),/114\.18, 30\.497/)
 assert.ok(picked.searchParams.get('body').includes(report.description))
 checks.push('selecting an official mailbox in the picker prepares only the chosen recipient, saved text and exact incident coordinates')
 assert.deepEqual(escaped,[]);assert.deepEqual(errors,[])
}catch(e){process.exitCode=1;errors.push(String(e));await page.screenshot({path:`${output}/failed.png`}).catch(()=>{})}
finally{const result={passed:!process.exitCode,scope:'isolated H5 GPS/POI/API/mail contracts; no actual mail or official contact',checks,errors,escaped};await writeFile(`${output}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));await browser.close()}
