// Actual Uni visibility/route/session lifecycle with an isolated Capacitor camera bridge.
// This verifies integration timing, not real device camera or permission UI.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
const base=process.env.FISHING_H5_URL||'http://127.0.0.1:5178',output='artifacts/comment-camera-handoff'
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));await mkdir(output,{recursive:true})
const owner='11111111-1111-4111-8111-111111111111',postId='22222222-2222-4222-8222-222222222222'
const image=await readFile('assets/brand/fish-symbol.png'),author={id:owner,nickname:'相机验收',city:'',bio:'',method:'',handle:''}
const post={id:postId,author,title:'相机生命周期验收',body:'隔离接口样本，没有真实提交。',kind:'catch',species:'鲫鱼',method:'台钓',bait:'',audience:'public',status:'published',created_at:new Date().toISOString(),like_count:0,comment_count:0,liked:false,saved:false,review_revision:0,media:[]}
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:375,height:812},locale:'zh-CN',permissions:['geolocation'],geolocation:{longitude:114.3,latitude:30.5}}),page=await context.newPage()
const checks=[],errors=[],escaped=[];let uploads=0
await context.addInitScript(owner=>{
 localStorage.setItem('dyj.auth.v1',JSON.stringify({type:'object',data:{access_token:'isolated-camera-handoff',refresh_token:'fixture',expires_at:Date.now()/1000+3600,user:{id:owner}}}))
 const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);window.fixtureBlobs={created:[],revoked:[]}
 URL.createObjectURL=blob=>{const url=create(blob);window.fixtureBlobs.created.push(url);return url}
 URL.revokeObjectURL=url=>{window.fixtureBlobs.revoked.push(url);return revoke(url)}
 window.fixtureVisibility='visible'
 Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.fixtureVisibility})
 Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.fixtureVisibility==='hidden'})
},owner)
await context.routeWebSocket(/supabase\.co/,socket=>socket.close())
await context.route('**/*',async route=>{
 const request=route.request(),url=new URL(request.url())
 if(url.origin===base&&url.pathname==='/fixture-camera.png')return route.fulfill({body:image,contentType:'image/png'})
 if(url.origin===base||!url.protocol.startsWith('http'))return route.continue()
 if(url.origin!=='https://jupuypvmgjpnpntfetqv.supabase.co'){escaped.push(url.origin);return route.abort()}
 const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'},reply=json=>route.fulfill({json,headers})
 if(request.method()==='OPTIONS')return reply({})
 if(url.pathname==='/auth/v1/user')return reply({id:owner})
 if(url.pathname==='/auth/v1/logout')return reply({})
 if(url.pathname.endsWith('media-upload')){uploads++;return reply({id:`fixture-camera-${uploads}`,kind:'image',path:`${owner}/camera.png`,width:800,height:800})}
 if(url.pathname.endsWith('fishing_read')){const body=request.postDataJSON()||{};if(body.action==='post')return reply({post,comments:[],comments_next:null});if(body.action==='profile')return reply({profile:author,posts:[]});return reply({items:[],posts:[],spots:[],trips:[],next:null})}
 if(url.pathname.endsWith('fishing_moderation'))return reply({allowed:false})
 escaped.push(`${request.method()} ${url.pathname}`);return route.abort()
})
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(20000)
async function detail(){await page.evaluate(id=>location.hash=`/pages/post/detail?id=${id}`,postId);await page.locator('.post-comments textarea').waitFor();await page.getByRole('button',{name:'拍照',exact:true}).waitFor()}
async function beginCamera(count){await page.getByRole('button',{name:'拍照',exact:true}).click();await page.waitForFunction(expected=>window.fixtureCamera.calls.length===expected,count)}
async function visibility(state){await page.evaluate(value=>{window.fixtureVisibility=value;document.dispatchEvent(new Event('visibilitychange'))},state)}
async function completeCamera(){await page.evaluate(async()=>{window.fixtureCamera.resolve({webPath:'/fixture-camera.png',format:'png',saved:false});await new Promise(resolve=>setTimeout(resolve,50))})}
async function composerDraft(){return page.locator('.post-comments textarea').inputValue()}
try{
 // Hydrate the isolated browser session before enabling the native bridge capability.
 await page.goto(`${base}/#/pages/settings/index`);await page.getByText('设置与隐私',{exact:true}).waitFor()
 await page.evaluate(()=>{
  window.fixtureCamera={calls:[],resolve:null}
  window.Capacitor.isNativePlatform=()=>true
  window.Capacitor.PluginHeaders=[...(window.Capacitor.PluginHeaders||[]),{name:'Camera',methods:[{name:'getPhoto',rtype:'promise'}]},{name:'Geolocation',methods:['checkPermissions','requestPermissions','getCurrentPosition'].map(name=>({name,rtype:'promise'}))}]
  window.Capacitor.nativePromise=(plugin,method,options)=>{
   if(plugin==='Geolocation')return Promise.resolve(method==='getCurrentPosition'?{coords:{longitude:114.3,latitude:30.5,accuracy:20},timestamp:Date.now()}:{location:'granted',coarseLocation:'granted'})
   if(plugin!=='Camera'||method!=='getPhoto')throw new Error(`Unexpected native call ${plugin}.${method}`)
   window.fixtureCamera.calls.push(options)
   return new Promise(resolve=>{window.fixtureCamera.resolve=resolve})
  }
 })
 await detail();await page.locator('.post-comments textarea').fill('相机返回保留正文')
 await beginCamera(1);await visibility('hidden')
 assert.equal(await composerDraft(),'相机返回保留正文')
 await visibility('visible');await completeCamera()
 await page.waitForFunction(()=>document.querySelectorAll('.post-comments .mobile-evidence__item').length===1 && !document.querySelector('.post-comments .mobile-media-uploader__progress'))
 assert.equal(uploads,1);assert.equal(await page.locator('.post-comments textarea').inputValue(),'相机返回保留正文')
 const nativeOptions=await page.evaluate(()=>window.fixtureCamera.calls[0]);assert.equal(nativeOptions.source,'CAMERA');assert.equal(nativeOptions.saveToGallery,false)
 await page.locator('.mobile-comment-composer-shell').screenshot({path:`${output}/camera-return.png`})
 await page.getByRole('button',{name:/移除.*1/}).click()
 checks.push('real Uni visibility hide/show during the native handoff keeps the draft and accepts one returned photo')
 const albumChooser=page.waitForEvent('filechooser')
 await page.getByRole('button',{name:/添加图片.*视频/}).click()
 const chooser=await albumChooser
 await visibility('hidden');assert.equal(await composerDraft(),'相机返回保留正文')
 await visibility('visible');await chooser.setFiles({name:'album.png',mimeType:'image/png',buffer:image})
 await page.waitForFunction(()=>document.querySelectorAll('.post-comments .mobile-evidence__item').length===1 && !document.querySelector('.post-comments .mobile-media-uploader__progress'))
 assert.equal(uploads,2);assert.equal(await composerDraft(),'相机返回保留正文')
 await page.locator('.mobile-comment-composer-shell').screenshot({path:`${output}/album-return.png`})
 await page.getByRole('button',{name:/移除.*1/}).click()
 checks.push('album hide/show follows the same handoff and attaches the returned image without disabling the composer')
 // A normal background event still invalidates when no native camera handoff exists.
 await visibility('hidden');assert.equal(await page.getByRole('button',{name:'拍照',exact:true}).isDisabled(),true)
 await visibility('visible');await page.getByRole('button',{name:'拍照',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'拍照',exact:true}).isDisabled(),false)
 checks.push('ordinary page backgrounding is not exempted from existing invalidation')
 await beginCamera(2);await page.evaluate(()=>location.hash='/pages/settings/index');await page.getByText('设置与隐私',{exact:true}).waitFor();await completeCamera()
 assert.equal(uploads,2);await detail();assert.equal(await page.locator('.post-comments .mobile-evidence__item').count(),0)
 checks.push('visible route departure discards the late native result even after returning to the composer')
 await beginCamera(3);await visibility('hidden')
 await page.evaluate(()=>{
  // Revoke the browser session through the real external-session listener.
  window.Capacitor.isNativePlatform=()=>false
  localStorage.removeItem('dyj.auth.v1')
  window.dispatchEvent(new StorageEvent('storage',{key:'dyj.auth.v1',newValue:null,storageArea:localStorage}))
 })
 await completeCamera();await visibility('visible')
 assert.equal(uploads,2);assert.equal(await page.locator('.post-comments .mobile-evidence__item').count(),0)
 await page.waitForFunction(()=>window.fixtureBlobs.created.every(url=>window.fixtureBlobs.revoked.includes(url)))
 checks.push('account exit during the handoff discards the photo and releases all object URLs')
 assert.deepEqual(errors,[]);assert.deepEqual(escaped,[])
 await writeFile(`${output}/result.json`,JSON.stringify({checks,uploads,errors,escaped,boundary:'Real Uni hooks and route/session transitions; simulated Capacitor bridge and local image. No device camera, hosted upload or external send.'},null,2));console.log(JSON.stringify({checks,uploads,errors},null,2))
}catch(error){await page.screenshot({path:`${output}/failure.png`,fullPage:true}).catch(()=>{});console.error({errors,escaped,uploads});throw error}finally{await context.close();await browser.close()}
