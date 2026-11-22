// Official-directory UI only. Clipboard and opening external pages are intercepted; nothing submitted.
import{chromium}from'playwright'
import assert from'node:assert/strict'
import{mkdir,writeFile}from'node:fs/promises'
import{setH5TextScale}from'./h5-text-scale.mjs'
const base=process.env.FISHING_H5_URL||'http://127.0.0.1:5178',out='artifacts/report-official-entries'
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));await mkdir(out,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:375,height:812},locale:'zh-CN',reducedMotion:'reduce',permissions:['geolocation'],geolocation:{longitude:120.62,latitude:31.3}}),errors=[],escaped=[],checks=[]
await context.addInitScript(()=>{
 window.copiedNames=[];window.openedUrls=[]
 window.AMap={
  Geolocation:class{getCurrentPosition(done){done('complete',{position:{getLng:()=>120.62,getLat:()=>31.3},location_type:'html5'})}},
  Geocoder:class{getAddress(point,done){done('complete',{regeocode:{addressComponent:{province:'江苏省',city:'苏州市',district:'姑苏区',adcode:'320508'}}})}}
 }
 Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.copiedNames.push(value)}}})
 window.open=(url)=>{window.openedUrls.push(url);return null}
})
await context.routeWebSocket(/supabase\.co/,socket=>socket.close())
await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===base||!url.protocol.startsWith('http'))return route.continue();escaped.push(url.origin+url.pathname);return route.abort()})
const page=await context.newPage();page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(e.message))
const card=name=>page.locator('.panel').filter({has:page.getByText(name,{exact:true})})
try{
 await page.goto(base+'/#/pages/water-report/index',{waitUntil:'domcontentloaded'})
 await page.locator('#report-region').click()
 const picker=page.getByRole('dialog',{name:'选择事发地区',exact:true});await picker.waitFor()
 await picker.getByRole('button',{name:'江苏省',exact:true}).click();await picker.getByRole('button',{name:'只选择江苏省',exact:true}).click();await picker.waitFor({state:'hidden'})
 const mini=card('江苏长江禁渔随手拍');await mini.waitFor()
 assert.match(await mini.innerText(),/微信小程序/)
 await mini.getByRole('button',{name:'复制小程序名称：江苏长江禁渔随手拍',exact:true}).click()
 await page.getByText(/^小程序名称已复制/).waitFor();assert.deepEqual(await page.evaluate(()=>window.copiedNames),['江苏长江禁渔随手拍'])
 const officialAccount=card('中国渔政微信公众号')
 assert.match(await officialAccount.innerText(),/微信公众号/);assert.doesNotMatch(await officialAccount.innerText(),/微信小程序/)
 await officialAccount.getByRole('button',{name:'复制公众号名称：中国渔政微信公众号',exact:true}).click()
 await page.getByText(/^公众号名称已复制/).waitFor();assert.equal((await page.evaluate(()=>window.copiedNames)).at(-1),'中国渔政')
 checks.push('province-specific official mini program is separate from national official account; exact names copied with honest WeChat navigation guidance')
 const website=card('12309中国检察网');await website.getByRole('button',{name:'打开官方网页：12309中国检察网',exact:true}).click()
 await page.getByText(/^已请求打开官方网页/).waitFor();assert.deepEqual(await page.evaluate(()=>window.openedUrls),['https://www.12309.gov.cn/'])
 checks.push('official public-interest website opens the published URL only; no private data in URL and no external submission')
 for(const[name,width,height,dark,size]of[['375',375,812,false,16],['320',320,740,false,16],['440',440,956,false,16],['landscape',812,375,false,16],['wide',1280,800,false,16],['dark-large',320,740,true,24]]){
  await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:dark?'dark':'light'});await setH5TextScale(page,size);await mini.scrollIntoViewIfNeeded()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  assert.ok(await mini.locator('button').evaluateAll(nodes=>nodes.every(n=>{const r=n.getBoundingClientRect();return r.width>=48&&r.height>=48})))
  await page.screenshot({path:`${out}/mini-${name}.png`})
 }
 checks.push('mini-program source/actions remain aligned and readable in six viewport/text modes')
 assert.deepEqual(errors,[]);assert.deepEqual(escaped,[])
}catch(e){process.exitCode=1;errors.push(String(e));await page.screenshot({path:`${out}/failed.png`}).catch(()=>{})}
finally{const result={passed:!process.exitCode,scope:'local H5 official directory; clipboard and external navigation intercepted, no real submission',checks,errors,escaped};await writeFile(`${out}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));await browser.close()}
