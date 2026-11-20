// Mounted production uploader + real Uni visibility lifecycle; only the upload callback is delayed.
// This does not contact a hosted API or claim an actual native/device upload.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
const base=process.env.FISHING_H5_URL||'http://127.0.0.1:5178',out='artifacts/uploader-preparation-lifecycle'
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));await mkdir(out,{recursive:true})
const owner='11111111-1111-4111-8111-111111111111',postId='22222222-2222-4222-8222-222222222222'
const author={id:owner,nickname:'转换验收',city:'',bio:'',method:'',handle:''}
const post={id:postId,author,title:'附件处理生命周期',body:'本机隔离测试',kind:'catch',species:'',method:'',bait:'',audience:'public',status:'published',created_at:new Date().toISOString(),like_count:0,comment_count:0,liked:false,saved:false,review_revision:0,media:[]}
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:375,height:812},locale:'zh-CN'}),page=await context.newPage()
const errors=[],escaped=[],checks=[]
await context.addInitScript(owner=>{
 localStorage.setItem('dyj.auth.v1',JSON.stringify({type:'object',data:{access_token:'isolated-preparation-test',refresh_token:'fixture',expires_at:Date.now()/1000+3600,user:{id:owner}}}))
 window.fixtureVisibility='visible'
 Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.fixtureVisibility})
 Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.fixtureVisibility==='hidden'})
 window.fixtureJobs=[]
 window.fixtureUpload=(_path,options)=>new Promise(resolve=>{
  const job={options,resolve,aborted:0};window.fixtureJobs.push(job)
  options.signal.addEventListener('abort',()=>job.aborted++)
  options.onStage(window.fixtureStage);window.fixtureStage==='preparing'?options.onPreparationProgress(37):options.onProgress(42)
 })
},owner)
await context.routeWebSocket(/supabase\.co/,socket=>socket.close())
await context.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url())
 if(url.origin===base&&url.pathname==='/src/services/media.ts'){
  const response=await route.fetch(),body=await response.text(),signature='export async function uploadPhoto(filePath, options = {}) {'
  assert.ok(body.includes(signature),'the isolated test boundary must match the current compiled service')
  return route.fulfill({response,body:body.replace(signature,signature+' return window.fixtureUpload(filePath, options);')})
 }
 if(url.origin===base||!url.protocol.startsWith('http'))return route.continue()
 if(url.origin!=='https://tlfmfokyhahlpzmpliad.supabase.co'){escaped.push(url.origin);return route.abort()}
 const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'},reply=json=>route.fulfill({json,headers})
 if(req.method()==='OPTIONS')return reply({})
 if(url.pathname==='/auth/v1/user')return reply({id:owner})
 if(url.pathname.endsWith('fishing_read')){const body=req.postDataJSON()||{};return reply(body.action==='post'?{post,comments:[],comments_next:null}:body.action==='profile'?{profile:author,posts:[]}:{items:[],posts:[],spots:[],trips:[],next:null})}
 if(url.pathname.endsWith('fishing_moderation'))return reply({allowed:false})
 escaped.push(`${req.method()} ${url.pathname}`);return route.abort()
})
page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message))
async function visibility(state){await page.evaluate(value=>{window.fixtureVisibility=value;document.dispatchEvent(new Event('visibilitychange'))},state)}
async function state(){return page.evaluate(()=>window.fixtureUploader.props.modelValue.map(p=>({asset:p.asset?.id,busy:p.busy,error:p.error,stage:p.stage,progress:p.progress,preparationProgress:p.preparationProgress}))) }
async function install(stage){await page.evaluate(stage=>{
 let instance=document.querySelector('.post-comments .mobile-media-uploader').__vueParentComponent
 while(instance&&!instance.props.uploadImage)instance=instance.parent
 if(!instance)throw new Error('mounted uploader missing')
 window.fixtureUploader=instance;window.fixtureStage=stage
},stage)}
async function settle(index,id){await page.evaluate(({index,id})=>{
 const job=window.fixtureJobs[index];job.options.onPreparationProgress(99);job.options.onProgress(99);job.resolve({id,path:`fixture/${id}.jpg`,kind:'image',width:96,height:64})
},{index,id});await page.waitForTimeout(80)}
try{
 await page.goto(`${base}/#/pages/post/detail?id=${postId}`,{waitUntil:'domcontentloaded',timeout:60000})
 await page.getByRole('button',{name:'添加图片 / 视频',exact:true}).waitFor()
 await install('preparing')
 const choosing=page.waitForEvent('filechooser');await page.getByRole('button',{name:'添加图片 / 视频',exact:true}).click();await(await choosing).setFiles('tests/fixtures/image-formats/small.webp')
 await page.waitForFunction(()=>window.fixtureJobs.length===1)
 await page.getByText('处理 37%',{exact:true}).waitFor()
 await page.locator('.mobile-comment-composer-shell').screenshot({path:`${out}/preparing-375.png`})
 await visibility('hidden')
 assert.equal(await page.evaluate(()=>window.fixtureJobs[0].aborted),1)
 assert.match((await state())[0].error,/已暂停/);assert.equal((await state())[0].busy,false)
 await settle(0,'stale-preparation')
 assert.equal((await state())[0].asset,undefined);assert.equal((await state())[0].progress,undefined)
 await visibility('visible');await page.getByRole('button',{name:'重试上传',exact:true}).waitFor();await page.waitForTimeout(100)
 assert.equal(await page.evaluate(()=>window.fixtureJobs.length),1)
 checks.push('backgrounding cancels preparation; late progress/results cannot fill the draft; returning requires explicit retry')
 await install('uploading');await page.getByRole('button',{name:'重试上传',exact:true}).click();await page.getByText('上传 42%',{exact:true}).waitFor()
 // Sending/parent busy state pauses new scheduling without aborting an existing upload.
 await page.evaluate(()=>window.fixtureUploader.props.disabled=true);await page.waitForTimeout(40)
 assert.equal(await page.evaluate(()=>window.fixtureJobs[1].aborted),0)
 await page.evaluate(()=>window.fixtureUploader.props.disabled=false);await visibility('hidden')
 assert.equal(await page.evaluate(()=>window.fixtureJobs[1].aborted),1)
 await settle(1,'stale-upload');assert.equal((await state())[0].asset,undefined)
 await visibility('visible');await page.getByRole('button',{name:'重试上传',exact:true}).waitFor()
 checks.push('backgrounding aborts transport too, while ordinary disabled/busy state does not cancel it')
 await install('uploading');await page.getByRole('button',{name:'重试上传',exact:true}).click();await page.waitForFunction(()=>window.fixtureJobs.length===3);await settle(2,'confirmed-asset')
 assert.equal((await state())[0].asset,'confirmed-asset')
 await visibility('hidden');await visibility('visible')
 assert.equal((await state())[0].asset,'confirmed-asset');assert.equal(await page.getByRole('button',{name:'重试上传',exact:true}).count(),0)
 checks.push('manual retry can complete and a previously completed attachment survives page hide/show')
 assert.deepEqual(errors,[]);assert.deepEqual(escaped,[])
 await writeFile(`${out}/result.json`,JSON.stringify({checks,errors,escaped,evidence:'Real mounted component and Uni hooks; delayed callbacks are isolated test doubles, with no hosted write.'},null,2));console.log(JSON.stringify({checks,errors,escaped},null,2))
}catch(error){await page.screenshot({path:`${out}/failure.png`,fullPage:true});throw error}finally{await context.close();await browser.close()}
