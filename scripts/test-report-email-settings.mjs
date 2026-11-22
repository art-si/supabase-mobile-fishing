// Isolated H5 local contact settings. No real sign-in, email send or backend write.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { setH5TextScale } from './h5-text-scale.mjs'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178', output = 'artifacts/report-email-settings'
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname))
await mkdir(output,{recursive:true})
const browser = await chromium.launch({channel:'chrome',headless:true}), context = await browser.newContext({viewport:{width:375,height:812},locale:'zh-CN',reducedMotion:'reduce'})
const checks=[], errors=[], requests=[]
const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222'
await context.addInitScript(owner=>{
 if(!localStorage.getItem('dyj.auth.v1')) localStorage.setItem('dyj.auth.v1',JSON.stringify({type:'object',data:{access_token:'isolated-email-contact-fixture',refresh_token:'fixture',expires_at:Date.now()/1000+3600,user:{id:owner}}}))
},owner)
await context.routeWebSocket(/supabase\.co/,socket=>socket.close())
await context.route('**/*',route=>{
 const request=route.request(),url=new URL(request.url())
 if(url.origin===base||!url.protocol.startsWith('http'))return route.continue()
 const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
 if(url.origin==='https://jupuypvmgjpnpntfetqv.supabase.co') return route.fulfill({status:200,headers,json:url.pathname==='/auth/v1/user'?{id:owner}:{allowed:false,items:[]}})
 requests.push(url.href); return route.abort()
})
const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
const button=name=>page.getByRole('button',{name,exact:true})
const sheet=()=>page.getByRole('dialog',{name:'我的邮箱资料',exact:true})
async function open(){await page.getByRole('button',{name:'我的邮箱资料 官方渠道邮件联系'}).click();await sheet().waitFor()}
async function capture(name){await page.evaluate(()=>document.fonts.ready);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`${output}/${name}.png`})}
try{
 await page.goto(base+'/#/pages/settings/index',{waitUntil:'domcontentloaded'});await open()
 await button('保存邮箱资料').click()
 await page.getByText('请填写称呼，最多40字',{exact:true}).waitFor()
 assert.ok(await page.locator('#report-email-name-input').evaluate(el=>el===document.activeElement))
 await page.locator('input[aria-label="称呼"]').fill('隔离验收钓友')
 await page.locator('input[aria-label="联系邮箱"]').fill('invalid')
 await button('保存邮箱资料').click()
 assert.ok(await page.locator('#report-email-address-input').evaluate(el=>el===document.activeElement))
 await page.locator('input[aria-label="联系邮箱"]').fill('fishing.test@example.com')
 await page.getByText('请填写有效邮箱，例如 name@example.com',{exact:true}).waitFor({state:'hidden'})
 await button('保存邮箱资料').click();await sheet().waitFor({state:'hidden'})
 assert.equal(await page.evaluate(owner=>JSON.parse(localStorage.getItem(`dyj.live.draft.${owner}.report-email-contact`)).data.email,owner),'fishing.test@example.com')
 checks.push('required name and single email validate inline, focus errors and store only under current owner')
 await open();assert.equal(await page.locator('input[aria-label="联系邮箱"]').inputValue(),'fishing.test@example.com')
 await page.locator('input[aria-label="联系邮箱"]').fill('unsaved@example.com');await button('取消').click();await open()
 assert.equal(await page.locator('input[aria-label="联系邮箱"]').inputValue(),'fishing.test@example.com')
 checks.push('cancel never changes saved mailbox contact and reopening restores prior values')
 for(const [width,height,dark,size] of [[320,740,false,16],[375,812,false,16],[440,956,false,16],[812,375,false,16],[1280,800,true,16],[320,740,true,24]]){
  await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:dark?'dark':'light'});await setH5TextScale(page,size)
  await button('保存邮箱资料').focus()
  const rects=await sheet().locator('.mobile-action-group .mobile-action').evaluateAll(nodes=>nodes.map(el=>{const r=el.getBoundingClientRect();return{width:r.width,height:r.height,y:r.y,x:r.x}}))
  assert.ok(rects.every(r=>r.height>=48 && r.width>=48));assert.ok(rects[0].y===rects[1].y || rects[0].x===rects[1].x)
  assert.ok(rects.every(r=>r.y>=0 && r.y+r.height<=height+1),'footer actions fully visible including landscape')
  await capture(`sheet-${width}-${height}-${dark?'dark':'light'}-${size}`)
 }
 checks.push('mailbox sheet fits 320/375/440/landscape/wide/dark-large text with focus and aligned 48px actions')
 await page.keyboard.press('Escape');await sheet().waitFor({state:'hidden'})
 await page.evaluate(other=>{const stored=JSON.parse(localStorage.getItem('dyj.auth.v1'));stored.data.user.id=other;localStorage.setItem('dyj.auth.v1',JSON.stringify(stored))},other)
 await page.reload({waitUntil:'domcontentloaded'});await open()
 assert.equal(await page.locator('input[aria-label="联系邮箱"]').inputValue(),'')
 await page.locator('input[aria-label="称呼"]').fill('第二账号');await page.locator('input[aria-label="联系邮箱"]').fill('other@example.com')
 await button('保存邮箱资料').click();await open();await button('清除本机邮箱资料').click();await sheet().waitFor({state:'hidden'})
 assert.equal(await page.evaluate(other=>localStorage.getItem(`dyj.live.draft.${other}.report-email-contact`),other),null)
 assert.ok(await page.evaluate(owner=>localStorage.getItem(`dyj.live.draft.${owner}.report-email-contact`),owner))
 checks.push('another account never sees prior account contact; clearing only removes own contact')
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[])
}catch(e){process.exitCode=1;errors.push(String(e));await page.screenshot({path:`${output}/failed.png`}).catch(()=>{})}
finally{await writeFile(`${output}/result.json`,JSON.stringify({passed:!process.exitCode,scope:'isolated H5 local mailbox settings; no real mail sent',checks,errors,requests},null,2));console.log(JSON.stringify({passed:!process.exitCode,checks,errors}));await browser.close()}
