// Real browser/MP4 decoding with isolated HTTP fixtures. No external writes or demo covers.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { setH5TextScale } from './h5-text-scale.mjs'
const base=process.env.FISHING_H5_URL||'http://127.0.0.1:5178'
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname))
const output='artifacts/video-posters';await mkdir(output,{recursive:true})
const video=await readFile('tests/fixtures/flower-cc0.mp4'),image=await readFile('assets/brand/fish-symbol.png')
// A real second-origin server is needed for CORS: Playwright's fulfill can add ACAO.
const fixtureServer=createServer((_request,response)=>{response.writeHead(200,{'content-type':'video/mp4'});response.end(video)})
await new Promise(resolve=>fixtureServer.listen(0,'127.0.0.1',resolve))
const corsOrigin=`http://127.0.0.1:${fixtureServer.address().port}`
const owner='11111111-1111-4111-8111-111111111111', origin='https://tlfmfokyhahlpzmpliad.supabase.co'
const post={id:'22222222-2222-4222-8222-222222222222',author:{id:owner,nickname:'封面验收',city:'苏州'},title:'今天的渔获',body:'图片与视频保持相同排布，点击查看完整内容。',kind:'catch',audience:'public',status:'published',created_at:new Date().toISOString(),like_count:0,comment_count:0,media:[{id:'image-poster-check',kind:'image',path:`${owner}/image.png`,width:800,height:800},{id:'video-poster-check',kind:'video',path:`${owner}/video.mp4`,width:960,height:540,duration:5}]}
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:375,height:812},locale:'zh-CN',reducedMotion:'reduce'})
const checks=[],errors=[],escaped=[],requests=[]
let mode='slow',signature=0
await context.addInitScript(({owner})=>{
 localStorage.setItem('dyj.auth.v1',JSON.stringify({type:'object',data:{access_token:'isolated-poster-test',refresh_token:'isolated',expires_at:Date.now()/1000+3600,user:{id:owner}}}))
 const create=document.createElement.bind(document);window.posterVideos=[]
 document.createElement=function(tag,...args){const node=create(tag,...args);if(tag==='video')window.posterVideos.push(node);return node}
},{owner})
await context.routeWebSocket(/supabase\.co/,socket=>socket.close())
await context.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url())
 if(url.origin===corsOrigin)return route.continue()
 if(url.origin===base&&!url.pathname.startsWith('/poster-fixture/'))return route.continue()
 if(url.origin!==origin&&url.origin!==base){escaped.push(url.origin);return route.abort()}
 const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
 const reply=json=>route.fulfill({json,headers})
 if(req.method()==='OPTIONS')return reply({})
 if(url.pathname==='/auth/v1/user')return reply({id:owner})
 if(url.pathname.endsWith('fishing_moderation'))return reply({allowed:false})
 if(url.pathname.endsWith('fishing_read')){const {action}=req.postDataJSON()||{};return reply(action==='post'?{post,comments:[],comments_next:null}:action==='library'?{posts:[post],spots:[],trips:[]}:action==='profile'?{profile:post.author,posts:[]}:{items:[],next:null})}
 if(url.pathname.startsWith('/storage/v1/object/sign/fishing-media/')&&req.method()==='POST')return reply({signedURL:`/object/sign/fishing-media/${url.pathname.split('/').at(-1)}?token=${++signature}`})
 if(url.pathname.startsWith('/poster-fixture/')||url.pathname.startsWith('/storage/v1/object/sign/fishing-media/')){
  const isVideo=!url.pathname.endsWith('.png'),current=url.searchParams.get('mode')||mode
  if(isVideo){requests.push(req.url());if(current==='slow')await new Promise(r=>setTimeout(r,4500));else if(current==='cancel')await new Promise(r=>setTimeout(r,1800))}
  try{return await route.fulfill({status:200,contentType:isVideo?'video/mp4':'image/png',body:isVideo?(current==='broken'?Buffer.from('not a decodable video'):video):image,headers:current==='cors'?{}:headers})}catch{return}
 }
 escaped.push(`${req.method()} ${url.pathname}`);return route.abort()
})
const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message))
async function hasPoster(){await page.waitForFunction(()=>Array.from(document.querySelectorAll('.mobile-media-gallery__image img')).some(node=>(node.getAttribute('src')||'').startsWith('data:image/jpeg')),{},{timeout:18000})}
try{
 const started=Date.now();await page.goto(`${base}/#/pages/mine/library?type=posts`)
 await page.getByText('正在加载视频封面…',{exact:true}).waitFor()
 await page.screenshot({path:`${output}/slow-loading-375.png`,fullPage:true})
 await hasPoster();assert.ok(Date.now()-started>4300)
 checks.push('4500 ms real MP4 HTTP response becomes a genuine decoded frame, exceeding previous 3 s cutoff')
 const pixels=await page.evaluate(async()=>{
   const uri=Array.from(document.querySelectorAll('.mobile-media-gallery__image img')).map(n=>n.getAttribute('src')).find(s=>s?.startsWith('data:image/jpeg'))
   const img=new Image();img.src=uri;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0)
   const data=ctx.getImageData(0,0,c.width,c.height).data;let low=255,high=0;for(let i=0;i<data.length;i+=64){low=Math.min(low,data[i]);high=Math.max(high,data[i])}return{width:c.width,height:c.height,spread:high-low}
 });assert.equal(pixels.width,640);assert.equal(pixels.height,360);assert.ok(pixels.spread>80)
 for(const [name,width,height,dark,scale] of [['375',375,812,false,16],['320',320,740,false,16],['440',440,956,false,16],['landscape',844,390,false,16],['wide',1280,900,false,16],['dark-large',320,812,true,24]]){
  await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:dark?'dark':'light'});await setH5TextScale(page,scale)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`${output}/real-cover-${name}.png`,fullPage:true})
 }
 const before=requests.length;mode='normal';await page.getByRole('button',{name:/阅读全文/}).click();await hasPoster();assert.equal(requests.length,before)
 checks.push('list-to-detail signed URL refresh reuses the account-scoped media-id frame without another decode')
 await page.evaluate(async()=>{window.posterModule=await import('/src/_mobile-core/video-poster.ts')})
 const codec=await page.evaluate(async()=>{const p=window.posterModule;return (await p.captureVideoPoster(location.origin+'/poster-fixture/broken.mp4?mode=broken',{scope:'codec',cacheKey:'broken'})).length});assert.equal(codec,0,'broken codec must not return frame')
 const cors=await page.evaluate(async origin=>(await window.posterModule.captureVideoPoster(origin+'/poster-fixture/cors.mp4?mode=cors',{scope:'cors',cacheKey:'cors'})).length,corsOrigin);assert.equal(cors,0,'missing CORS must not return frame')
 checks.push('invalid codec and missing CORS return no invented frame')
 const queue=await page.evaluate(async()=>{
  const p=window.posterModule,start=window.posterVideos.length
  const runs=[0,1,2,3].map(i=>p.captureVideoPoster(location.origin+`/poster-fixture/queue-${i}.mp4?mode=cancel`,{scope:'queue',cacheKey:String(i)}))
  let max=0;const interval=setInterval(()=>{max=Math.max(max,window.posterVideos.slice(start).filter(v=>v.getAttribute('src')).length)},10)
  const results=await Promise.all(runs);clearInterval(interval);return{max,valid:results.every(s=>s.startsWith('data:image/jpeg')),remaining:window.posterVideos.slice(start).filter(v=>v.getAttribute('src')).length}
 });assert.equal(queue.max,2);assert.ok(queue.valid);assert.equal(queue.remaining,0)
 checks.push('four real videos decode with concurrency exactly two; detached decoder sources are released')
 const cancel=await page.evaluate(async()=>{
  const p=window.posterModule,controller=new AbortController(),url=location.origin+'/poster-fixture/cancel.mp4?mode=cancel',start=window.posterVideos.length
  const a=p.captureVideoPoster(url,{scope:'abort',cacheKey:'asset',signal:controller.signal}),b=p.captureVideoPoster(url,{scope:'abort',cacheKey:'asset'})
  controller.abort();const [x,y]=await Promise.all([a,b]);const second=new AbortController(),c=p.captureVideoPoster(url+'&again=1',{scope:'abort',cacheKey:'other',signal:second.signal});second.abort();await c
  return{x,good:y.startsWith('data:image/jpeg'),remaining:window.posterVideos.slice(start).filter(v=>v.getAttribute('src')).length}
 });assert.equal(cancel.x.length,0,'aborted subscriber must not receive frame');assert.ok(cancel.good);assert.equal(cancel.remaining,0)
 checks.push('aborting one subscriber preserves another; aborting last subscriber releases its decoder immediately')
 const isolation=await page.evaluate(async()=>{
  const p=window.posterModule,good=await p.captureVideoPoster(location.origin+'/poster-fixture/scope.mp4?mode=normal',{scope:'owner-a',cacheKey:'same'})
  const other=await p.captureVideoPoster(location.origin+'/poster-fixture/scope.mp4?mode=broken',{scope:'owner-b',cacheKey:'same'})
  p.clearVideoPosterScope('owner-a');const cleared=await p.captureVideoPoster(location.origin+'/poster-fixture/scope.mp4?mode=broken',{scope:'owner-a',cacheKey:'same'})
  return{good:good.startsWith('data:image/jpeg'),other,cleared}
 });assert.ok(isolation.good);assert.equal(isolation.other.length,0,'other account has no cached frame');assert.equal(isolation.cleared.length,0,'cleared account has no cached frame')
 checks.push('another account cannot read a cached frame; clearing account scope removes cached covers')
 await page.setViewportSize({width:375,height:812});await page.emulateMedia({colorScheme:'light'});await setH5TextScale(page,16)
 mode='broken';await page.reload();await page.getByRole('button',{name:'重新加载封面',exact:true}).waitFor();await page.screenshot({path:`${output}/retry-failed-cover-375.png`,fullPage:true})
 assert.equal(await page.getByRole('button',{name:/播放视频，第2项/}).count(),1)
 mode='normal';await page.getByRole('button',{name:'重新加载封面',exact:true}).click();await hasPoster();assert.equal(await page.getByText('封面暂未加载，可点击播放',{exact:true}).count(),0)
 checks.push('failed cover keeps play accessible; retry renews signed URL and displays real frame')
 await page.getByRole('button',{name:/播放视频，第2项/}).click();await page.waitForFunction(()=>document.querySelector('dialog[open] video')?.currentTime>.2);await page.screenshot({path:`${output}/real-video-preview.png`});await page.getByRole('button',{name:'关闭视频预览',exact:true}).click()
 mode='cancel';await page.reload();await page.getByText('正在加载视频封面…',{exact:true}).waitFor();await page.evaluate(()=>location.hash='/pages/mine/index');await page.waitForTimeout(100)
 assert.ok(await page.evaluate(()=>window.posterVideos.every(v=>!v.getAttribute('src'))))
 checks.push('leaving the page while a video cover is loading cancels and releases the decode')
 assert.deepEqual(errors,[]);assert.deepEqual(escaped,[])
 await writeFile(`${output}/result.json`,JSON.stringify({checks,pixels,queue,errors,escaped},null,2));console.log(JSON.stringify({checks,pixels,queue,errors,escaped},null,2))
}catch(error){await page.screenshot({path:`${output}/failure.png`,fullPage:true});throw error}finally{await context.close();await browser.close();fixtureServer.closeAllConnections();await new Promise(resolve=>fixtureServer.close(resolve))}
