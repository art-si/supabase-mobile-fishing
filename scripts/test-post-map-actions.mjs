// Isolated API and external-map adapter. Never launches another application or sends user content.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { setH5TextScale } from './h5-text-scale.mjs'
const base=process.env.FISHING_H5_URL||'http://127.0.0.1:5178'
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname))
const output='artifacts/post-map-actions';await mkdir(output,{recursive:true})
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222'
let post={id,author:{id:owner,nickname:'验收钓友',city:'武汉市',method:'台钓',bio:'',handle:''},title:'',body:'一条隔离的鱼情验收样例',kind:'catch',species:'鲫鱼',method:'台钓',bait:'蚯蚓',count:2,weight_kg:1,location_label:'湖北省武汉市某湖 · 仅供隔离验收',location_longitude:114.18,location_latitude:30.48,audience:'public',status:'published',created_at:new Date().toISOString(),media:[],liked:false,saved:false,like_count:0,comment_count:0}
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:375,height:812},reducedMotion:'reduce'})
const errors=[],escaped=[],checks=[]
await context.addInitScript(({owner})=>localStorage.setItem('dyj.auth.v1',JSON.stringify({type:'object',data:{access_token:'isolated-map-ui',refresh_token:'fixture',expires_at:Date.now()/1000+3600,user:{id:owner}}})),{owner})
await context.routeWebSocket(/supabase\.co/,socket=>socket.close())
await context.route('**/*',route=>{
 const req=route.request(),url=new URL(req.url())
 if(url.origin===base){
  if(url.pathname==='/src/platforms/open-place.ts')return route.fulfill({contentType:'application/javascript',body:`export function openPlaceMap(provider,place,webOnly=false){window.mapUiCalls??=[];window.mapUiCalls.push({provider,place,webOnly});return webOnly?'web':'attempted'}`})
  return route.continue()
 }
 if(!url.protocol.startsWith('http'))return route.continue()
 if(url.origin!=='https://tlfmfokyhahlpzmpliad.supabase.co'){escaped.push(url.origin);return route.abort()}
 const reply=json=>route.fulfill({json,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}})
 if(req.method()==='OPTIONS')return reply({})
 if(url.pathname==='/auth/v1/user')return reply({id:owner})
 const data=req.postDataJSON()||{},p=data.payload||{}
 if(url.pathname.endsWith('fishing_read')){
  if(data.action==='library')return reply({posts:p.type==='posts'?[post]:[],trips:[],spots:[]})
  if(data.action==='post')return reply({post,comments:[],comments_next:null})
  if(data.action==='profile')return reply({profile:post.author,posts:[]})
  return reply({items:[],next:null})
 }
 if(url.pathname.endsWith('fishing_write')&&data.action==='reaction'){post={...post,liked:p.enabled,like_count:p.enabled?1:0};return reply(post)}
 if(url.pathname.endsWith('fishing_moderation'))return reply({allowed:false})
 if(url.pathname.includes('/rest/v1/'))return reply([])
 escaped.push(`${req.method()} ${url.pathname}`);return route.abort()
})
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000)
try{
 await page.goto(`${base}/#/pages/post/detail?id=${id}`)
 const like=page.getByRole('button',{name:/^点赞：/});await like.waitFor()
 const outline=await like.locator('.mobile-icon__glyph').innerText()
 await like.click();const liked=page.getByRole('button',{name:/^取消点赞：/});await liked.waitFor()
 assert.equal(await liked.getAttribute('aria-pressed'),'true');assert.notEqual(await liked.locator('.mobile-icon__glyph').innerText(),outline)
 await liked.click();await like.waitFor();assert.equal(await like.locator('.mobile-icon__glyph').innerText(),outline)
 checks.push('like toggles an outlined/filled thumb and accessible pressed state without using a success check')
 for(const[mode,width,height,dark,scale]of[['375',375,812,false,16],['320',320,740,false,16],['440',440,956,false,16],['landscape',844,390,false,16],['wide',1280,900,false,16],['dark-large',320,812,true,24]]){
  await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:dark?'dark':'light'});await setH5TextScale(page,scale)
  const place=page.getByRole('button',{name:`在地图中查看：${post.location_label}`,exact:true})
  await place.focus();await place.press('Enter');const dialog=page.getByRole('dialog',{name:'在地图中查看',exact:true});await dialog.waitFor()
  assert.match(await dialog.innerText(),/按发布者分享的地点搜索/)
  for(const name of ['高德地图','百度地图','复制地点']){const box=await dialog.getByRole('button',{name,exact:true}).boundingBox();assert.ok(box.width>=44&&box.height>=44)}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  await page.screenshot({path:`${output}/chooser-${mode}.png`})
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.ok(await place.evaluate(node=>node===document.activeElement))
 }
 checks.push('six layouts preserve the address action, readable map choices, large touch targets, Escape and focus return')
 await page.setViewportSize({width:375,height:812});await setH5TextScale(page,16);await page.emulateMedia({colorScheme:'light'})
 await page.getByRole('button',{name:`在地图中查看：${post.location_label}`,exact:true}).click()
 await page.getByRole('button',{name:'百度地图',exact:true}).click()
 await page.getByRole('button',{name:'高德网页版',exact:true}).waitFor()
 await page.getByRole('button',{name:'高德网页版',exact:true}).click()
 const calls=await page.evaluate(()=>window.mapUiCalls)
 assert.deepEqual(calls.map(call=>[call.provider,call.webOnly]),[['baidu',false],['amap',true]])
 assert.ok(calls.every(call=>call.place.label===post.location_label&&call.place.approximate===true))
 await page.screenshot({path:`${output}/fallback-375.png`})
 checks.push('provider choices use only shared address data; an explicit web fallback is available without timed redirects')
 await page.getByRole('button',{name:'关闭地图选择',exact:true}).click()
 await page.goto(`${base}/#/pages/mine/library?type=posts`)
 await page.getByRole('button',{name:`在地图中查看：${post.location_label}`,exact:true}).click();await page.getByRole('dialog',{name:'在地图中查看',exact:true}).waitFor()
 checks.push('list and detail reuse the same map chooser')
 assert.deepEqual(errors,[]);assert.deepEqual(escaped,[])
 await writeFile(`${output}/result.json`,JSON.stringify({passed:true,checks,errors,escaped,boundary:'Map URL builders tested separately; native application installation/launch requires device verification.'},null,2))
 console.log(`PASS ${checks.length} post/map interaction groups`)
}finally{await browser.close()}
