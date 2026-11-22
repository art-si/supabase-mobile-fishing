// Real HEIC decoding and media preparation in the mounted comment composer; HTTP writes are isolated.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
const base=process.env.FISHING_H5_URL||'http://127.0.0.1:5178',out='artifacts/prepared-media-preview'
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));await mkdir(out,{recursive:true})
const owner='11111111-1111-4111-8111-111111111111',postId='22222222-2222-4222-8222-222222222222'
const author={id:owner,nickname:'媒体预览验收',city:'',bio:'',method:'',handle:''}
const post={id:postId,author,title:'格式转换预览',body:'真实文件转换，隔离接口验收。',kind:'catch',species:'',method:'',bait:'',audience:'public',status:'published',created_at:new Date().toISOString(),like_count:0,comment_count:0,liked:false,saved:false,review_revision:0,media:[]}
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:375,height:812},locale:'zh-CN'}),page=await context.newPage()
const errors=[],escaped=[],uploads=[],checks=[]
await context.addInitScript(owner=>{
 localStorage.setItem('dyj.auth.v1',JSON.stringify({type:'object',data:{access_token:'isolated-preview-test',refresh_token:'fixture',expires_at:Date.now()/1000+3600,user:{id:owner}}}))
 const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);window.fixtureBlobs={created:[],revoked:[]}
 URL.createObjectURL=blob=>{const path=create(blob);window.fixtureBlobs.created.push(path);return path}
 URL.revokeObjectURL=path=>{window.fixtureBlobs.revoked.push(path);return revoke(path)}
},owner)
await context.routeWebSocket(/supabase\.co/,socket=>socket.close())
await context.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url())
 if(url.origin===base||!url.protocol.startsWith('http'))return route.continue()
 if(url.origin!=='https://jupuypvmgjpnpntfetqv.supabase.co'){escaped.push(url.origin);return route.abort()}
 const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'},reply=json=>route.fulfill({json,headers})
 if(req.method()==='OPTIONS')return reply({})
 if(url.pathname==='/auth/v1/user')return reply({id:owner})
 if(url.pathname==='/auth/v1/logout')return reply({})
 if(url.pathname.endsWith('fishing_read')){const body=req.postDataJSON()||{};return reply(body.action==='post'?{post,comments:[],comments_next:null}:body.action==='profile'?{profile:author,posts:[]}:{items:[],posts:[],spots:[],trips:[],next:null})}
 if(url.pathname.endsWith('fishing_moderation'))return reply({allowed:false})
 if(url.pathname.endsWith('media-upload')){const body=req.postDataBuffer(),video=body.includes(Buffer.from('ftyp'));uploads.push(body);const id=`33333333-3333-4333-8333-${String(uploads.length).padStart(12,'0')}`;return reply(video?{id,path:`${owner}/${id}.mp4`,kind:'video',width:640,height:360,duration:5,size:body.length}:{id,path:`${owner}/${id}.jpg`,kind:'image',width:256,height:256})}
 escaped.push(`${req.method()} ${url.pathname}`);return route.abort()
})
page.setDefaultTimeout(60000);page.on('pageerror',error=>errors.push(error.message))
async function choose(path){const selection=page.waitForEvent('filechooser');await page.getByRole('button',{name:'添加图片 / 视频',exact:true}).click();await(await selection).setFiles(path);await page.waitForFunction(()=>{
 let instance=document.querySelector('.post-comments .mobile-media-uploader')?.__vueParentComponent;while(instance&&!instance.props.uploadImage)instance=instance.parent
 window.fixtureUploader=instance;return instance?.props.modelValue.length===1&&instance.props.modelValue[0].asset
})}
async function paths(){return page.evaluate(()=>{const item=window.fixtureUploader.props.modelValue[0];return{original:item.path,preview:item.previewPath,asset:item.asset.id}})}
async function verifyRemoved(saved){await page.getByRole('button',{name:/移除.*1/}).click();await page.waitForFunction(({original,preview})=>window.fixtureBlobs.revoked.includes(original)&&window.fixtureBlobs.revoked.includes(preview),saved);assert.equal(await page.locator('.post-comments .mobile-evidence__item').count(),0)}
try{
 await page.goto(`${base}/#/pages/post/detail?id=${postId}`,{waitUntil:'domcontentloaded',timeout:60000})
 await page.getByRole('button',{name:'添加图片 / 视频',exact:true}).waitFor()
 await choose('tests/fixtures/fish-heic.heic')
 const saved=await paths();assert.ok(saved.preview&&saved.preview!==saved.original)
 const image=await page.evaluate(async({preview,original})=>{
  const blob=await(await fetch(preview)).blob(),bitmap=await createImageBitmap(blob),result={type:blob.type,width:bitmap.width,height:bitmap.height,originalAvailable:(await fetch(original)).ok};bitmap.close();return result
 },saved)
 assert.deepEqual(image,{type:'image/jpeg',width:256,height:256,originalAvailable:true})
 assert.ok(uploads[0].includes(Buffer.from([255,216,255])),'actual upload must contain JPEG bytes')
 await page.locator('.post-comments .mobile-media-uploader__image img').waitFor()
 assert.equal(await page.locator('.post-comments .mobile-media-uploader__image img').evaluate(node=>node.complete&&node.naturalWidth>0),true)
 await page.locator('.mobile-comment-composer-shell').screenshot({path:`${out}/heic-comment-thumbnail.png`})
 await page.locator('.post-comments .mobile-evidence__preview').first().click()
 await page.getByRole('button',{name:'关闭预览',exact:true}).waitFor();await page.screenshot({path:`${out}/heic-image-viewer.png`})
 await page.getByRole('button',{name:'关闭预览',exact:true}).click()
 await verifyRemoved(saved)
 checks.push('HEIC upload retains the real normalized JPEG for the visible thumbnail and shared full-screen viewer, then removing releases both source and copy')
 const fixture=process.env.PREPARED_VIDEO_FIXTURE
 if(fixture){
  await readFile(fixture);await choose(fixture);const videoPaths=await paths();assert.ok(videoPaths.preview&&videoPaths.preview!==videoPaths.original)
  await page.locator('.post-comments .mobile-evidence__preview').first().click();await page.getByRole('button',{name:'关闭视频预览',exact:true}).waitFor()
  await page.waitForFunction(()=>[...document.querySelectorAll('video')].some(video=>video.readyState>=2&&video.videoWidth>0))
  assert.ok(await page.evaluate(path=>[...document.querySelectorAll('video')].some(video=>video.currentSrc===path),videoPaths.preview))
  await page.locator('.mobile-video-viewer video').first().evaluate(video=>{video.muted=true;void video.play()})
  await page.waitForFunction(()=>[...document.querySelectorAll('.mobile-video-viewer video')].some(video=>!video.paused&&video.currentTime>.15))
  await page.screenshot({path:`${out}/normalized-video-viewer.png`});await page.getByRole('button',{name:'关闭视频预览',exact:true}).click();await verifyRemoved(videoPaths)
  checks.push('a genuinely converted container plays from its prepared MP4 in the shared viewer, and removal releases both local URLs')
 }
 await choose('tests/fixtures/fish-heic.heic');const beforeUnmount=await paths()
 await page.evaluate(async()=>{
  let instance=document.querySelector('.post-comments').__vueParentComponent;while(instance&&!instance.setupState?.auth?.signOut)instance=instance.parent
  await instance.setupState.auth.signOut()
 })
 await page.waitForFunction(({original,preview})=>window.fixtureBlobs.revoked.includes(original)&&window.fixtureBlobs.revoked.includes(preview),beforeUnmount)
 checks.push('a real account exit clears both original and retained normalized preview through the existing business release callback')
 assert.deepEqual(errors,[]);assert.deepEqual(escaped,[])
 await writeFile(`${out}/result.json`,JSON.stringify({checks,uploads:uploads.length,errors,escaped,boundary:'Actual local codecs, mounted components and viewers; isolated HTTP upload responses, no hosted write.'},null,2));console.log(JSON.stringify({checks,uploads:uploads.length,errors,escaped},null,2))
}catch(error){await page.screenshot({path:`${out}/failure.png`,fullPage:true});console.error({escaped,errors});throw error}finally{await context.close();await browser.close()}
