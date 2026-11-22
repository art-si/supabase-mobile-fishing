// Isolated browser UI review, with no live login, upload or publishing.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir,writeFile } from 'node:fs/promises'
import { setH5TextScale } from './h5-text-scale.mjs'
const base=process.env.FISHING_H5_URL||'http://127.0.0.1:5178'
const output='artifacts/publish-design'
await mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true})
const context=await browser.newContext({viewport:{width:375,height:812}, reducedMotion:'reduce'})
const errors=[],checks=[]
await context.addInitScript(()=>{
  localStorage.setItem('dyj.auth.v1',JSON.stringify({type:'object',data:{access_token:'isolated-publish-visual',refresh_token:'isolated',expires_at:Date.now()/1000+3600,user:{id:'11111111-1111-4111-8111-111111111111'}}}))
  Object.defineProperty(navigator,'permissions',{value:{query:async()=>({state:'denied'})}})
})
await context.routeWebSocket(/supabase\.co/,(socket)=>socket.close())
await context.route('https://jupuypvmgjpnpntfetqv.supabase.co/**',(route)=>route.fulfill({headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},json:{items:[],profile:{nickname:'界面验收'}}}))
const page=await context.newPage()
page.on('pageerror',e=>errors.push(e.message))
try{
  await page.goto(`${base}/#/pages/post/compose`)
  await page.getByRole('button',{name:'分享心得',exact:true}).click()
  const body=page.locator('textarea[aria-label="分享你的心得"]')
  await body.fill('沿着水草边慢慢找鱼，记录今天的用饵和钓法。')
  const preset=page.getByRole('button',{name:'选择心得主题（选填）',exact:true})
  await preset.waitFor()
  const rect=await preset.boundingBox()
  assert.ok(rect.width>=44&&rect.height>=44)
  checks.push('topic uses the same full-width picker trigger as the other form selectors')
  await preset.click()
  await page.getByRole('dialog',{name:'选择心得主题（选填）'}).waitFor()
  await page.getByRole('checkbox',{name:'钓法技巧',exact:true}).click()
  await page.getByRole('dialog',{name:'选择心得主题（选填）'}).getByRole('button',{name:'确定',exact:true}).click()
  await preset.getByText('钓法技巧',{exact:true}).waitFor()
  checks.push('the shared topic picker still returns its selection to the editable field')
  for(const [name,width,height,dark,scale] of [['375',375,812,false,16],['320',320,740,false,16],['440',440,956,false,16],['landscape',844,390,false,16],['wide',1280,900,false,16],['dark-large',320,812,true,24]]){
    await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:dark?'dark':'light'});await setH5TextScale(page,scale)
    for(const kind of ['experience','catch']){
      await page.getByRole('button',{name:kind==='experience'?'分享心得':'晒渔获',exact:true}).click()
      await page.evaluate(()=>scrollTo(0,0))
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
      await page.screenshot({path:`${output}/${kind}-${name}.png`,fullPage:true})
      checks.push(`${kind}-${name}: no horizontal overflow and complete form grouping`)
    }
  }
  assert.deepEqual(errors,[])
  await writeFile(`${output}/result.json`,JSON.stringify({checks,errors},null,2))
  console.log(JSON.stringify({checks,errors},null,2))
}finally{await context.close();await browser.close()}
