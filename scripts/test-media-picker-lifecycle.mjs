// Actual routed H5 composer and session transitions, isolated API fixtures; no hosted write.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
const base=process.env.FISHING_H5_URL||'http://127.0.0.1:5178',output='artifacts/media-picker-sources'
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));await mkdir(output,{recursive:true})
const owner='11111111-1111-4111-8111-111111111111',postId='22222222-2222-4222-8222-222222222222'
const image=await readFile('assets/brand/fish-symbol.png'),author={id:owner,nickname:'选择器验收',city:'',bio:'',method:'',handle:''}
const post={id:postId,author,title:'选择器生命周期验收',body:'隔离测试，只检查离页和退出后的附件清理。',kind:'catch',species:'鲫鱼',method:'台钓',bait:'',additives:'',weight_kg:null,count:null,length_cm:null,occurred_on:'2026-11-20',location_label:'',audience:'public',status:'published',created_at:new Date().toISOString(),like_count:0,comment_count:0,liked:false,saved:false,review_revision:0,media:[]}
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:375,height:812},locale:'zh-CN'}),page=await context.newPage()
const checks=[],errors=[],escaped=[];let uploads=0
await context.addInitScript(owner=>{
 localStorage.setItem('dyj.auth.v1',JSON.stringify({type:'object',data:{access_token:'isolated-picker-lifecycle',refresh_token:'fixture',expires_at:Date.now()/1000+3600,user:{id:owner}}}))
 const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);window.fixtureBlobs={created:[],revoked:[]}
 URL.createObjectURL=blob=>{const url=create(blob);window.fixtureBlobs.created.push(url);return url}
 URL.revokeObjectURL=url=>{window.fixtureBlobs.revoked.push(url);return revoke(url)}
},owner)
await context.routeWebSocket(/supabase\.co/,socket=>socket.close())
await context.route('**/*',async route=>{
 const request=route.request(),url=new URL(request.url())
 if(url.origin===base||!url.protocol.startsWith('http'))return route.continue()
 if(url.origin!=='https://jupuypvmgjpnpntfetqv.supabase.co'){escaped.push(url.origin);return route.abort()}
 const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'},reply=json=>route.fulfill({json,headers})
 if(request.method()==='OPTIONS')return reply({})
 if(url.pathname==='/auth/v1/user')return reply({id:owner})
 if(url.pathname==='/auth/v1/logout')return reply({})
 if(url.pathname.endsWith('media-upload')){uploads++;return reply({id:'fixture-unexpected-upload',kind:'image',path:'never-upload.png',width:800,height:800})}
 if(url.pathname.endsWith('fishing_read')){const body=request.postDataJSON()||{};if(body.action==='post')return reply({post,comments:[],comments_next:null});if(body.action==='profile')return reply({profile:author,posts:[]});return reply({items:[],posts:[],spots:[],trips:[],next:null})}
 if(url.pathname.endsWith('fishing_moderation'))return reply({allowed:false})
 escaped.push(`${request.method()} ${url.pathname}`);return route.abort()
})
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(20000)
async function detail(){await page.evaluate(id=>location.hash=`/pages/post/detail?id=${id}`,postId);await page.locator('.post-comments textarea').waitFor();await page.getByRole('button',{name:'添加图片 / 视频',exact:true}).waitFor()}
async function choose(){const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'添加图片 / 视频',exact:true}).click();return await chooser}
async function assertReleased(expected){await page.waitForFunction(count=>window.fixtureBlobs.created.length>=count&&window.fixtureBlobs.created.every(url=>window.fixtureBlobs.revoked.includes(url)),expected);assert.equal(uploads,0);assert.equal(await page.locator('.post-comments .mobile-evidence__item').count(),0)}
try{
 await page.goto(`${base}/#/pages/post/detail?id=${postId}`);await page.locator('.post-comments textarea').waitFor()
 const first=await choose();await page.evaluate(()=>location.hash='/pages/settings/index');await page.getByText('设置与隐私',{exact:true}).waitFor()
 await first.setFiles({name:'late-after-hide.png',mimeType:'image/png',buffer:image});await assertReleased(1)
 checks.push('a real filechooser result arriving after route hide is discarded, its blob released, and no upload starts')
 await detail();const second=await choose();await page.evaluate(()=>location.hash='/pages/settings/index');await page.getByText('设置与隐私',{exact:true}).waitFor();await detail()
 await second.setFiles({name:'late-after-return.png',mimeType:'image/png',buffer:image});await assertReleased(2)
 checks.push('returning to the page before an old picker completes does not revive the old selection')
 const third=await choose();const accountExit=await page.evaluate(async()=>{
  // Invoke the mounted component's real Pinia action, avoiding a second Vite/HMR module instance.
  let instance=document.querySelector('.post-comments').__vueParentComponent
  while(instance&&!instance.setupState?.auth?.signOut)instance=instance.parent
  if(!instance)throw new Error('Mounted authentication store unavailable')
  const auth=instance.setupState.auth,before=auth.context;await auth.signOut();return{changed:auth.context!==before,signedIn:auth.signedIn}
 });assert.deepEqual(accountExit,{changed:true,signedIn:false})
 await third.setFiles({name:'late-after-account-exit.png',mimeType:'image/png',buffer:image});await assertReleased(3)
 checks.push('the real signOut session boundary prevents late attachment insertion or upload and releases the created blob')
 assert.equal(await page.locator('input[type=file]').count(),0)
 assert.deepEqual(errors,[]);assert.deepEqual(escaped,[])
 await writeFile(`${output}/lifecycle-result.json`,JSON.stringify({checks,uploads,blobs:await page.evaluate(()=>({created:window.fixtureBlobs.created.length,revoked:window.fixtureBlobs.revoked.length})),errors,escaped},null,2));console.log(JSON.stringify({checks,uploads,errors,escaped},null,2))
}catch(error){await page.screenshot({path:`${output}/lifecycle-failure.png`,fullPage:true}).catch(()=>{});console.error(JSON.stringify({errors,escaped,uploads}));throw error}finally{await context.close();await browser.close()}
