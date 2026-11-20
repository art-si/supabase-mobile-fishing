// Isolated API/session/GPS fixtures; real browser media decoding, no hosted writes or delivery.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { setH5TextScale } from './h5-text-scale.mjs'
const base=process.env.FISHING_H5_URL||'http://127.0.0.1:5178',output='artifacts/report-records'
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname))
await mkdir(output,{recursive:true})
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222'
let record={id,category:'electric',province:'湖南省',city:'长沙市',district:'雨花区',location_label:'原事发河段 · 隔离验收样本',longitude:113.03,latitude:28.14,observed_at:'2026-11-19T01:20:00.000Z',description:'亲眼看到河边有人使用疑似电鱼工具。',media:[{id:'image-1',path:`${owner}/image.png`,kind:'image',width:800,height:800},{id:'video-1',path:`${owner}/video.mp4`,kind:'video',width:960,height:540,duration:5.005}],status:'saved',crs:'GCJ-02',created_at:'2026-11-19T02:00:00Z',revision:1}
let deleted=false
let releaseUpload,releaseFirstUpdate
const checks=[],errors=[],escaped=[],writes=[]
const pass=message=>{checks.push(message);console.log('PASS',message)}
const image=await readFile('assets/brand/fish-symbol.png'),video=await readFile('tests/fixtures/flower-cc0.mp4')
const browser=await chromium.launch({channel:'chrome',headless:true})
const context=await browser.newContext({viewport:{width:375,height:812},locale:'zh-CN',timezoneId:'Asia/Shanghai',reducedMotion:'reduce'})
await context.addInitScript(({owner})=>{
 localStorage.setItem('dyj.auth.v1',JSON.stringify({type:'object',data:{access_token:'isolated-report-records',refresh_token:'fixture',expires_at:Date.now()/1000+3600,user:{id:owner}}}))
 Object.defineProperty(navigator,'permissions',{value:{query:async()=>({state:'granted'})}})
 window.AMap={Geolocation:class{getCurrentPosition(callback){setTimeout(()=>callback('complete',{position:{getLng:()=>115.2,getLat:()=>29.84},accuracy:12,location_type:'html5'}),10)}},Geocoder:class{getAddress(point,callback){setTimeout(()=>callback('complete',{regeocode:{formattedAddress:'湖北省黄石市阳新县 · 当前位置样本',addressComponent:{adcode:'420222',province:'湖北省',city:'黄石市',district:'阳新县'}}}),10)}}}
},{owner})
await context.routeWebSocket(/supabase\.co/,socket=>socket.close())
await context.route('**/*',async route=>{
 const request=route.request(),url=new URL(request.url())
 if(url.origin===base||!url.protocol.startsWith('http'))return route.continue()
 if(url.origin!=='https://tlfmfokyhahlpzmpliad.supabase.co'){escaped.push(url.origin);return route.abort()}
 const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
 const reply=(json,status=200)=>route.fulfill({json,status,headers})
 if(request.method()==='OPTIONS')return reply({})
 if(url.pathname==='/auth/v1/user')return reply({id:owner})
 if(url.pathname==='/functions/v1/media-upload'){
  await new Promise(resolve=>{releaseUpload=resolve})
  return reply({error:'PHOTO_SERVICE_UNAVAILABLE'},503)
 }
 if(url.pathname.startsWith('/storage/v1/object/sign/fishing-media/')){
  if(request.method()==='POST')return reply({signedURL:`/object/sign/fishing-media/${url.pathname.split('/').at(-1)}?token=fixture`})
  return route.fulfill({body:url.pathname.endsWith('.mp4')?video:image,contentType:url.pathname.endsWith('.mp4')?'video/mp4':'image/png',headers})
 }
 const body=request.postDataJSON()||{},p=body.payload||{}
 if(url.pathname.endsWith('fishing_read')){
  if(body.action==='water_reports')return reply(p.id?record:{items:deleted?[]:[record]})
  return reply({items:[],next:null})
 }
 if(url.pathname.endsWith('fishing_write')){
  writes.push(body)
  if(body.action==='update_water_report'){
   if(writes.filter(item=>item.action==='update_water_report').length===1){await new Promise(resolve=>{releaseFirstUpdate=resolve});return reply({message:'STORAGE_UNAVAILABLE'},503)}
   record={...record,...p,media:record.media,revision:2,updated_at:new Date().toISOString()};return reply(record)
  }
  if(body.action==='delete_water_report'){deleted=true;return reply(true)}
  if(body.action==='save_water_report'){record={...record,...p,media:[],revision:1};deleted=false;return reply(record)}
  throw new Error(`Unexpected write ${body.action}`)
 }
 return reply({})
})
const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message))
try{
 await page.goto(`${base}/#/pages/water-report/history`)
 await page.waitForURL(/water-report\/index\?tab=records/)
 await page.getByRole('button',{name:'查看详情',exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'我的线索材料',exact:true}).count(),0)
 assert.equal(await page.getByRole('button',{name:'发布上报',exact:true}).count(),1)
 assert.equal(await page.getByRole('button',{name:'我的上报记录',exact:true}).getAttribute('aria-pressed'),'true')
 pass('legacy history route opens one page with publish and personal-record tabs')
 for(const [name,width,height,dark,scale] of [['375',375,812,false,16],['320',320,740,false,16],['440',440,956,false,16],['landscape',844,390,false,16],['wide',1280,900,false,16],['dark-large',320,812,true,24]]){
  await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:dark?'dark':'light'});await setH5TextScale(page,scale)
  await page.locator('.mobile-media-gallery__grid').scrollIntoViewIfNeeded()
  await page.waitForFunction(()=>document.querySelectorAll('.mobile-media-gallery__image').length===2)
  const boxes=await page.locator('.mobile-media-gallery__item').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{w:r.width,h:r.height}}))
  assert.ok(boxes.every(box=>Math.abs(box.w-box.h)<2 && box.w<180),'compact equal square thumbnails')
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  const actions=await page.locator('.report-records__item .mobile-action-group > .mobile-action').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,h:r.height}}))
  assert.ok(actions.every(action=>action.h>=48))
  for(const action of actions)for(const peer of actions.filter(peer=>Math.abs(peer.y-action.y)<2))assert.ok(Math.abs(peer.h-action.h)<2)
  await page.screenshot({path:`${output}/records-${name}.png`,fullPage:true})
 }
 pass('six viewport/text modes keep compact media and aligned record actions with 48px targets')
 await page.setViewportSize({width:375,height:812});await page.emulateMedia({colorScheme:'light'});await setH5TextScale(page,16)
 await page.getByRole('button',{name:'查看详情',exact:true}).click()
 await page.getByRole('button',{name:'返回上报记录',exact:true}).waitFor()
 await page.locator('.mobile-media-gallery__grid.is-compact').waitFor()
 assert.equal(await page.locator('.mobile-media-gallery__grid.is-full').count(),0)
 await page.getByRole('button',{name:/播放视频，第2项/}).click()
 await page.waitForFunction(()=>document.querySelector('dialog[open] video')?.currentTime>.2)
 await page.getByRole('button',{name:'关闭视频预览',exact:true}).click()
 await page.getByRole('button',{name:/查看大图，第1项/}).click()
 await page.locator('.mobile-image-viewer[open] img.mobile-image-viewer__loaded').waitFor()
 await page.getByRole('button',{name:'关闭预览',exact:true}).click()
 await page.screenshot({path:`${output}/detail-375.png`,fullPage:true})
 pass('saved report shows compact shared media and reuses fullscreen image/video preview with X')
 await page.getByRole('button',{name:'编辑材料',exact:true}).click()
 await page.locator('textarea[aria-label="现场情况"]').waitFor()
 assert.match(await page.locator('#report-region').innerText(),/湖南省.*长沙市.*雨花区/)
 assert.equal(await page.locator('input[aria-label="具体水域与位置"]').inputValue(),record.location_label)
 assert.match(await page.locator('#report-time-time').innerText(),/09:20/)
 assert.equal(await page.getByText('已自动填入当前位置，可按实际事发地点修改。',{exact:true}).count(),0)
 assert.equal(await page.getByRole('button',{name:'填入当前位置',exact:true}).count(),0)
 const description=page.locator('textarea[aria-label="现场情况"]')
 await description.fill('补充现场信息：两人在岸边使用工具，持续约十分钟。')
 await page.getByRole('checkbox',{name:/我确认将文字/}).click()
 await page.getByRole('button',{name:'保存修改',exact:true}).click()
 await page.waitForFunction(()=>document.querySelector('textarea[aria-label="现场情况"]')?.disabled)
 assert.equal(await page.locator('input[aria-label="具体水域与位置"]').isDisabled(),true)
 assert.equal(await page.getByRole('button',{name:'我的上报记录',exact:true}).isDisabled(),true)
 assert.ok(releaseFirstUpdate);releaseFirstUpdate()
 await page.getByRole('alert').filter({hasText:/暂|失败|重试/}).first().waitFor()
 assert.match(await description.inputValue(),/补充现场信息/)
 await page.getByRole('button',{name:'保存修改',exact:true}).click()
 await page.getByRole('button',{name:'返回上报记录',exact:true}).waitFor()
 const updates=writes.filter(item=>item.action==='update_water_report')
 assert.equal(updates.length,2);assert.equal(updates[0].payload.id,id);assert.equal(updates[0].payload.expected_revision,1)
 assert.equal(updates[0].payload.request_id,updates[1].payload.request_id)
 assert.equal(updates[0].payload.observed_at,'2026-11-19T01:20:00.000Z')
 pass('edit preserves incident location/time; failed update keeps fields and retry command identity for the same record')
 await page.evaluate(({owner,record})=>localStorage.setItem(`dyj.live.draft.${owner}.water-report.edit.${record.id}`,JSON.stringify({type:'object',data:{...record,observed_local:'2026-11-19 09:20',description:'较早保存但尚未提交的编辑草稿。',_edited:true,_baseRevision:1}})),{owner,record})
 await page.getByRole('button',{name:'编辑材料',exact:true}).click()
 await page.getByText(/这份材料已在其他地方更新。当前显示/).waitFor()
 assert.equal(await page.getByRole('button',{name:'保存修改',exact:true}).isDisabled(),true)
 assert.match(await description.inputValue(),/较早保存/)
 await page.waitForTimeout(100)
 assert.equal(await page.evaluate(({owner,id})=>JSON.parse(localStorage.getItem(`dyj.live.draft.${owner}.water-report.edit.${id}`)).data._baseRevision,{owner,id}),1)
 await page.getByRole('button',{name:'重新读取最新材料',exact:true}).click()
 const reloadDialog=page.getByRole('dialog',{name:'使用最新材料？',exact:true});await reloadDialog.waitFor()
 await reloadDialog.getByRole('button',{name:'取消',exact:true}).click()
 assert.match(await description.inputValue(),/较早保存/)
 await page.getByRole('button',{name:'重新读取最新材料',exact:true}).click()
 await reloadDialog.getByRole('button',{name:'使用最新材料',exact:true}).click()
 await page.waitForFunction(value=>document.querySelector('textarea[aria-label="现场情况"]')?.value===value,record.description)
 assert.equal(await description.inputValue(),record.description)
 await page.getByRole('button',{name:'返回记录，保留编辑草稿',exact:true}).click()
 pass('stale local edit retains its base revision and content, blocks overwrite, and reloads only after explicit choice')
 await page.getByText(record.description,{exact:true}).waitFor()
 await page.getByRole('button',{name:'删除材料',exact:true}).click()
 const dialog=page.getByRole('alertdialog',{name:'删除这份材料？',exact:true});await dialog.waitFor()
 await page.screenshot({path:`${output}/delete-dialog-375.png`})
 await dialog.getByRole('button',{name:'取消',exact:true}).click()
 await dialog.waitFor({state:'hidden'})
 assert.equal(deleted,false)
 await page.getByRole('button',{name:'删除材料',exact:true}).click()
 await dialog.getByRole('button',{name:'删除材料',exact:true}).click()
 await page.getByText('还没有保存的上报记录。',{exact:true}).waitFor()
 pass('delete has cancellable confirmation and refreshes only the private record list')
 await page.getByRole('button',{name:'发布上报',exact:true}).click()
 await page.waitForFunction(()=>document.querySelector('#report-region')?.textContent.includes('阳新县'))
 assert.match(await page.locator('input[aria-label="具体水域与位置"]').inputValue(),/当前位置样本/)
 await page.locator('textarea[aria-label="现场情况"]').fill('当前河边看到疑似违规网捕情况。')
 await page.getByRole('checkbox',{name:/我确认将文字/}).click()
 await page.getByRole('button',{name:'私密保存，选择官方渠道',exact:true}).click()
 await page.getByRole('button',{name:'返回上报记录',exact:true}).waitFor()
 assert.equal(writes.filter(item=>item.action==='save_water_report').length,1)
 assert.notEqual(writes.at(-1).payload.id,id)
 pass('new report defaults back to current location/time, saves once, then appears in personal records')
 await page.getByRole('button',{name:'发布上报',exact:true}).click()
 await page.locator('textarea[aria-label="现场情况"]').waitFor()
 await page.getByRole('checkbox',{name:/我确认将文字/}).click()
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'添加图片 / 视频',exact:true}).click()
 await(await chooser).setFiles({name:'retry.png',mimeType:'image/png',buffer:image})
 await page.waitForFunction(()=>document.querySelectorAll('.mobile-media-uploader__progress').length>0)
 assert.equal(await page.getByRole('button',{name:'我的上报记录',exact:true}).isDisabled(),true)
 for(let i=0;i<100 && !releaseUpload;i++)await page.waitForTimeout(20)
 assert.ok(releaseUpload);releaseUpload()
 await page.getByRole('button',{name:/重试/}).first().waitFor()
 await page.getByRole('button',{name:'我的上报记录',exact:true}).click()
 await page.getByRole('button',{name:'查看详情',exact:true}).click()
 await page.getByRole('button',{name:'编辑材料',exact:true}).click()
 await page.getByRole('button',{name:'返回记录，保留编辑草稿',exact:true}).click()
 await page.getByRole('button',{name:'发布上报',exact:true}).click()
 await page.locator('.mobile-evidence__item').waitFor()
 assert.equal(await page.locator('.mobile-evidence__item').count(),1)
 await page.getByRole('button',{name:/重试/}).first().waitFor()
 pass('uploads block tab switching; failed local attachments survive viewing and editing another record')
 assert.deepEqual(errors,[]);assert.deepEqual(escaped,[])
 await writeFile(`${output}/result.json`,JSON.stringify({passed:true,checks,errors,writes:writes.length,boundary:'Isolated GPS/API/session fixtures, real local PNG and MP4 decoding. No hosted writes, GPS or external submission.'},null,2))
}catch(error){await page.screenshot({path:`${output}/failure.png`,fullPage:true});throw error}
finally{await context.close();await browser.close()}
