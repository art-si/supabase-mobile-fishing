// Isolated API/session fixtures, with actual local PNG and MP4 decoding. No hosted write.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { setH5TextScale } from './h5-text-scale.mjs'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178'
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname))
const output = 'artifacts/post-media-gallery'
await mkdir(output,{recursive:true})
const image = await readFile('assets/brand/fish-symbol.png')
const video = await readFile('tests/fixtures/flower-cc0.mp4')
const owner = '11111111-1111-4111-8111-111111111111'
const post = { id: '22222222-2222-4222-8222-222222222222', author: { id:owner,nickname:'媒体验收',city:'苏州',bio:'',method:'',handle:'' }, title:'今天的渔获',body:'水草边慢慢找鱼，记录这次出钓。', kind:'catch', species:'鲫鱼',method:'台钓',bait:'蚯蚓',additives:'',weight_kg:3,count:10,length_cm:null,occurred_on:'2026-11-20',location_label:'测试水域 · 隔离界面样例',audience:'public',status:'published',created_at:new Date().toISOString(),like_count:0,comment_count:0,liked:false,saved:false,review_revision:0,media:[{id:'image-1',path:`${owner}/image.png`,kind:'image',width:800,height:800},{id:'video-1',path:`${owner}/video.mp4`,kind:'video',width:960,height:540,duration:5.005}] }
const browser = await chromium.launch({channel:'chrome',headless:true})
const context = await browser.newContext({viewport:{width:375,height:812},locale:'zh-CN',reducedMotion:'reduce'})
const errors=[],escaped=[],checks=[]
await context.addInitScript(({owner})=>localStorage.setItem('dyj.auth.v1',JSON.stringify({type:'object',data:{access_token:'isolated-post-media',refresh_token:'isolated',expires_at:Date.now()/1000+3600,user:{id:owner}}})),{owner})
await context.routeWebSocket(/supabase\.co/,socket=>socket.close())
await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url())
  if(url.origin===base||!url.protocol.startsWith('http'))return route.continue()
  if(url.origin!=='https://tlfmfokyhahlpzmpliad.supabase.co'){escaped.push(url.origin);return route.abort()}
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
  const reply=json=>route.fulfill({json,headers})
  if(req.method()==='OPTIONS')return reply({})
  if(url.pathname==='/auth/v1/user')return reply({id:owner})
  if(url.pathname.endsWith('fishing_moderation'))return reply({allowed:false})
  if(url.pathname.endsWith('fishing_read')){
    const {action}=req.postDataJSON()||{}
    if(action==='post')return reply({post,comments:[],comments_next:null})
    if(action==='library')return reply({posts:[post],spots:[],trips:[]})
    if(action==='profile')return reply({profile:post.author,posts:[]})
    return reply({items:[],next:null})
  }
  if(url.pathname.startsWith('/storage/v1/object/sign/fishing-media/')){
    if(req.method()==='POST')return reply({signedURL:`/object/sign/fishing-media/${url.pathname.split('/').at(-1)}?token=fixture`})
    const isVideo=url.pathname.endsWith('.mp4')
    return route.fulfill({status:200,contentType:isVideo?'video/mp4':'image/png',body:isVideo?video:image,headers:{...headers,'accept-ranges':'bytes'}})
  }
  escaped.push(`${req.method()} ${url.pathname}`);return route.abort()
})
const page=await context.newPage()
page.on('pageerror',error=>errors.push(error.message))
try {
  await page.goto(`${base}/#/pages/mine/library?type=posts`)
  await page.locator('.mobile-media-gallery__image').first().waitFor()
  await page.waitForFunction(()=>document.querySelectorAll('.mobile-media-gallery__image').length===2)
  for(const [name,width,height,dark,scale] of [['375',375,812,false,16],['320',320,740,false,16],['440',440,956,false,16],['landscape',844,390,false,16],['wide',1280,900,false,16],['dark-large',320,812,true,24]]){
    await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:dark?'dark':'light'});await setH5TextScale(page,scale)
    const boxes=await page.locator('.mobile-media-gallery__item').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{w:r.width,h:r.height}}))
    assert.equal(boxes.length,2)
    assert.ok(boxes.every(box=>Math.abs(box.w-box.h)<2),`${name}: square mixed media`)
    assert.ok(Math.abs(boxes[0].h-boxes[1].h)<2,`${name}: matched image/video height`)
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
    await page.screenshot({path:`${output}/library-${name}.png`,fullPage:true})
    checks.push(`library-${name}: equal square image/video thumbnails, no horizontal overflow`)
  }
  await page.setViewportSize({width:375,height:812});await page.emulateMedia({colorScheme:'light'});await setH5TextScale(page,16)
  await page.getByRole('button',{name:/播放视频，第2项/}).click()
  await page.getByRole('dialog',{name:'视频预览',exact:true}).waitFor()
  await page.waitForFunction(()=>document.querySelector('dialog[open] video')?.currentTime>.2)
  const close=page.getByRole('button',{name:'关闭视频预览',exact:true}),box=await close.boundingBox()
  assert.ok(box.width>=44&&box.height>=44&&box.y<80)
  await page.screenshot({path:`${output}/video-preview-375.png`})
  await close.click()
  assert.equal(await page.locator('dialog[open]').count(),0)
  assert.ok(await page.getByRole('button',{name:/播放视频，第2项/}).evaluate(node=>node===document.activeElement))
  checks.push('list video opens the shared full-screen player, plays real MP4, closes with X and returns focus')
  await page.getByRole('button',{name:/阅读全文/}).click()
  await page.locator('.mobile-media-gallery__grid.is-compact').waitFor()
  await page.waitForFunction(()=>document.querySelectorAll('.mobile-media-gallery__image').length===2)
  for(const [name,width,height,dark,scale] of [['375',375,812,false,16],['320',320,740,false,16],['440',440,956,false,16],['landscape',844,390,false,16],['wide',1280,900,false,16],['dark-large',320,812,true,24]]){
    await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:dark?'dark':'light'});await setH5TextScale(page,scale)
    const boxes=await page.locator('.mobile-media-gallery__item').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{w:r.width,h:r.height}}))
    assert.ok(boxes.every(box=>Math.abs(box.w-box.h)<2),`${name}: matching compact image/video grid`)
    assert.ok(Math.abs(boxes[0].h-boxes[1].h)<2,`${name}: matched image/video height`)
    assert.equal(await page.locator('.post-card > video').count(),0)
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
    await page.screenshot({path:`${output}/detail-${name}.png`,fullPage:true})
    checks.push(`detail-${name}: same compact thumbnail grid as list and no giant inline black player`)
  }
  await page.setViewportSize({width:375,height:812});await page.emulateMedia({colorScheme:'light'});await setH5TextScale(page,16)
  await page.getByRole('button',{name:/查看大图，第1项/}).click()
  await page.locator('.mobile-image-viewer[open] img.mobile-image-viewer__loaded').waitFor()
  await page.screenshot({path:`${output}/image-preview-375.png`})
  await page.getByRole('button',{name:'关闭预览',exact:true}).click()
  checks.push('detail image reuses the same full-screen image viewer as the uploader')
  await page.getByRole('button',{name:/播放视频，第2项/}).click()
  await page.waitForFunction(()=>document.querySelector('dialog[open] video')?.currentTime>.2)
  await page.evaluate(()=>{ window.galleryReviewPlayer=document.querySelector('dialog[open] video'); location.hash='/pages/mine/library?type=posts' })
  await page.waitForFunction(()=>document.querySelectorAll('dialog[open]').length===0)
  assert.ok(await page.evaluate(()=>window.galleryReviewPlayer?.paused))
  checks.push('leaving the page closes the shared player and pauses its real video')
  assert.deepEqual(errors,[]);assert.deepEqual(escaped,[])
  await writeFile(`${output}/result.json`,JSON.stringify({checks,errors,escaped},null,2))
  console.log(JSON.stringify({checks,errors,escaped},null,2))
} catch(error){await page.screenshot({path:`${output}/failure.png`,fullPage:true});throw error}
finally{await context.close();await browser.close()}
