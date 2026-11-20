// Isolated HTTP/session fixtures; real local PNG/MP4 decoding, no hosted writes.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { setH5TextScale } from './h5-text-scale.mjs'
const base=process.env.FISHING_H5_URL||'http://127.0.0.1:5178',output='artifacts/comment-media'
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname))
await mkdir(output,{recursive:true})
const owner='11111111-1111-4111-8111-111111111111',other='33333333-3333-4333-8333-333333333333',postId='22222222-2222-4222-8222-222222222222'
const author={id:owner,nickname:'验收钓友',city:'',bio:'',method:'',handle:'DY000000000001'},neighbor={...author,id:other,nickname:'水边钓友'}
const image=await readFile('assets/brand/fish-symbol.png'),video=await readFile('tests/fixtures/flower-cc0.mp4')
const assets=[{id:'image-existing',path:`${other}/image.png`,kind:'image',width:800,height:800}]
let comments=[{id:'comment-existing',author:neighbor,body:'草边轻口，试试小漂。',status:'published',created_at:new Date().toISOString(),reply_to_id:null,reply_to:null,media:[assets[0]]}]
const post={id:postId,author,title:'评论附件验收',body:'隔离接口样本，不是真实发布。',kind:'catch',species:'鲫鱼',method:'台钓',bait:'',audience:'public',status:'published',created_at:new Date().toISOString(),like_count:0,comment_count:1,liked:false,saved:false,media:[],review_revision:1,location_label:'测试河段'}
const writes=[],checks=[],errors=[],escaped=[]
const pass=message=>{checks.push(message);console.log('PASS',message)}
let uploadSequence=0,failFirst=true,failUpload=false
const browser=await chromium.launch({channel:'chrome',headless:true})
const context=await browser.newContext({viewport:{width:375,height:812},locale:'zh-CN',reducedMotion:'reduce'})
await context.addInitScript(owner=>localStorage.setItem('dyj.auth.v1',JSON.stringify({type:'object',data:{access_token:'isolated-comment-media',refresh_token:'fixture',expires_at:Date.now()/1000+3600,user:{id:owner}}})),owner)
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
  if(failUpload){failUpload=false;return reply({message:'STORAGE_UNAVAILABLE'},503)}
  const kind=request.postDataBuffer().includes(Buffer.from('name="kind"\r\n\r\nvideo'))?'video':'image',id=`${String(++uploadSequence).padStart(8,'0')}-4444-4444-8444-444444444444`
  const asset={id,path:`${owner}/${id}.${kind==='video'?'mp4':'png'}`,kind,width:kind==='video'?960:800,height:kind==='video'?540:800,duration:kind==='video'?5.005:undefined,size:1000}
  assets.push(asset);return reply(asset)
 }
 if(url.pathname.startsWith('/storage/v1/object/sign/fishing-media/')){
  if(request.method()==='POST')return reply({signedURL:`/object/sign/fishing-media/${url.pathname.split('/').at(-1)}?token=fixture`})
  const isVideo=url.pathname.endsWith('.mp4')
  return route.fulfill({body:isVideo?video:image,contentType:isVideo?'video/mp4':'image/png',headers})
 }
 const body=request.postDataJSON()||{},payload=body.payload||{}
 if(url.pathname.endsWith('fishing_read')){
  if(body.action==='post')return reply({post:{...post,comment_count:comments.length},comments,comments_next:null})
  if(body.action==='comments')return reply({items:comments,total:comments.length,next:null})
  if(body.action==='profile')return reply({profile:author,posts:[]})
  return reply({items:[],next:null})
 }
 if(url.pathname.endsWith('fishing_write')){
  writes.push(body)
  if(body.action==='comment'){
   if(failFirst){failFirst=false;return reply({message:'STORAGE_UNAVAILABLE'},503)}
   if(!comments.some(comment=>comment.id===payload.id))comments.unshift({id:payload.id,author,body:payload.body,status:'published',created_at:new Date().toISOString(),reply_to_id:payload.reply_to_id||null,reply_to:payload.reply_to_id?comments.find(comment=>comment.id===payload.reply_to_id)||null:null,media:(payload.media||[]).map(item=>assets.find(asset=>asset.id===item.id))})
   return reply(true)
  }
  if(body.action==='delete_comment'){comments=comments.filter(comment=>comment.id!==payload.id).map(comment=>comment.reply_to_id===payload.id?{...comment,reply_to:null}:comment);return reply(true)}
  throw new Error(`Unexpected write ${body.action}`)
 }
 if(url.pathname.endsWith('fishing_moderation'))return reply({allowed:false})
 return reply({})
})
const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message))
const modes=[['375',375,812,false,16],['320',320,740,false,16],['440',440,956,false,16],['landscape',844,390,false,16],['wide',1280,900,false,16],['dark-large',320,812,true,24]]
async function checkInputFocus(input,section,state){
 const moved=await page.evaluate(()=>{
  const fields=[...document.querySelectorAll('style')].filter(node=>node.getAttribute('data-vite-dev-id')?.includes('MobileField.vue')||node.textContent.includes('.mobile-field__label {'))
  for(const style of fields)document.head.appendChild(style)
  return fields.length
 })
 assert.ok(moved>0,'exercise the real MobileField style loading after composer styles, as HMR can do')
 await input.focus()
 const layers=await input.evaluate(node=>{
  const result=[]
  for(let layer=node;layer;layer=layer.parentElement){
   const style=getComputedStyle(layer)
   result.push({tag:layer.tagName,class:layer.className,border:style.borderWidth,outline:style.outlineWidth,outlineStyle:style.outlineStyle,shadow:style.boxShadow})
   if(layer.classList.contains('mobile-comment-composer'))break
  }
  return result
 })
 for(const layer of layers.slice(0,-1)){
  assert.equal(layer.border,'0px',`${state} nested border: ${JSON.stringify(layer)}`)
  assert.ok(layer.outlineStyle==='none'||layer.outline==='0px',`${state} nested outline: ${JSON.stringify(layer)}`)
  assert.equal(layer.shadow,'none',`${state} nested shadow: ${JSON.stringify(layer)}`)
 }
 assert.notEqual(layers.at(-1).shadow,'none','only the outer composer highlights focus')
 await writeFile(`${output}/focus-${state}.json`,JSON.stringify(layers,null,2))
 await section.locator('.mobile-comment-composer-shell').screenshot({path:`${output}/${state}-focused-375.png`})
}
async function composerLayout(section,state){
 const composer=section.locator('.mobile-comment-composer')
 for(const [name,width,height,dark,scale]of modes){
  await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:dark?'dark':'light'});await setH5TextScale(page,scale)
  await composer.scrollIntoViewIfNeeded()
  const rects=await composer.locator('.mobile-comment-composer__toolbar .mobile-action').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right}}))
  assert.equal(rects.length,3)
  assert.ok(rects.every(rect=>rect.w>=48 && rect.h>=48))
  assert.ok(rects.every(rect=>Math.abs(rect.y-rects[0].y)<1),'all toolbar actions share one row')
  assert.ok(rects.slice(1).every((rect,index)=>rect.x>=rects[index].right),'toolbar controls never overlap')
  const bounds=await composer.boundingBox()
  const meta=await section.locator('.mobile-comment-composer__meta').boundingBox()
  assert.ok(meta.y>=bounds.y+bounds.height,'character and attachment counts sit below the entire bordered composer')
  assert.ok(rects[0].x>=bounds.x && rects.at(-1).right<=bounds.x+bounds.width+1)
  assert.equal(await composer.locator('.mobile-evidence__upload').count(),0,'only icon media actions are rendered')
  if(state==='media'){
   const thumbs=await composer.locator('.mobile-evidence__preview').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{w:r.width,h:r.height,centerIsPreview:!!hit?.closest('.mobile-evidence__preview')}}))
   assert.ok(thumbs.every(thumb=>thumb.w>=48 && thumb.w<=170 && Math.abs(thumb.w-thumb.h)<2))
   // The composer may be taller than landscape, so geometry is checked here and real center clicks below.
   const ratio=await composer.locator('.mobile-comment-composer__send').evaluate(node=>{
    const style=getComputedStyle(node)
    const luminance=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>{const v=n/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0)
    const values=[luminance(style.color),luminance(style.backgroundColor)].sort((a,b)=>a-b)
    return (values[1]+.05)/(values[0]+.05)
   })
   assert.ok(ratio>=4.5,`send contrast ${name}: ${ratio}`)
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  await section.locator('.mobile-comment-composer-shell').screenshot({path:`${output}/composer-${state}-${name}.png`})
 }
 await page.setViewportSize({width:375,height:812});await page.emulateMedia({colorScheme:'light'});await setH5TextScale(page,16)
}
try{
 await page.goto(`${base}/#/pages/post/detail?id=${postId}`)
 const section=page.locator('.post-comments'),input=section.locator('textarea')
 await input.waitFor()
 assert.equal(await section.getByRole('button',{name:'拍照',exact:true}).count(),0,'browser H5 has no native camera entry')
 await composerLayout(section,'empty')
 failUpload=true
 const firstSelection=page.waitForEvent('filechooser');await section.getByRole('button',{name:'添加图片 / 视频',exact:true}).click()
 await(await firstSelection).setFiles({name:'retry-photo.png',mimeType:'image/png',buffer:image})
 await section.getByRole('button',{name:'重试上传',exact:true}).waitFor()
 assert.ok(await section.getByRole('button',{name:'发表评论',exact:true}).isDisabled())
 await section.locator('.mobile-comment-composer-shell').screenshot({path:`${output}/composer-upload-failed-375.png`})
 await section.getByRole('button',{name:'重试上传',exact:true}).click()
 await page.waitForFunction(()=>document.querySelectorAll('.post-comments .mobile-evidence__item').length===1 && document.querySelectorAll('.post-comments .mobile-media-uploader__progress').length===0 && ![...document.querySelectorAll('.post-comments button')].some(node=>node.textContent.includes('重试上传')))
 await section.getByRole('button',{name:/移除.*1/}).click()
 await page.waitForFunction(()=>document.querySelectorAll('.post-comments .mobile-evidence__item').length===0)
 pass('browser hides native camera; failed upload stays inside the composer and retries without losing its attachment')
 await input.fill('河边不错，')
 await checkInputFocus(input,section,'comment')
 await input.evaluate(node=>node.setSelectionRange(2,2))
 await section.getByRole('button',{name:'表情',exact:true}).click()
 const emoji=page.getByRole('dialog',{name:'选择表情',exact:true});await emoji.waitFor()
 const allEmoji=new Set()
 for(const category of ['心情','手势','自然','生活']){
  await emoji.getByRole('button',{name:category,exact:true}).click()
  for(const label of await emoji.locator('.mobile-emoji-picker__choice').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label'))))allEmoji.add(label)
 }
 assert.ok(allEmoji.size>=100)
 await emoji.getByRole('button',{name:'手势',exact:true}).click()
 await emoji.getByRole('button',{name:'插入赞表情',exact:true}).click()
 await emoji.waitFor({state:'hidden'})
 assert.equal(await input.inputValue(),'河边👍不错，')
 await page.waitForFunction(()=>document.activeElement?.id==='comment-input')
 await input.fill('字'.repeat(500))
 await section.getByRole('button',{name:'表情',exact:true}).click();await emoji.waitFor()
 await emoji.getByRole('button',{name:'插入赞表情',exact:true}).click();await emoji.waitFor({state:'hidden'})
 assert.equal((await input.inputValue()).length,500)
 await section.getByText('评论最多 500 字，请先减少文字再添加表情。',{exact:true}).waitFor()
 await input.fill('河边不错，');await input.evaluate(node=>node.setSelectionRange(2,2))
 await section.getByRole('button',{name:'表情',exact:true}).click();await emoji.waitFor()
 await emoji.getByRole('button',{name:'插入赞表情',exact:true}).click();await emoji.waitFor({state:'hidden'})
 await page.waitForFunction(()=>document.activeElement?.id==='comment-input')
 await page.keyboard.press('Tab')
 await page.waitForFunction(()=>document.activeElement?.id==='comment-emoji-trigger')
 assert.ok(await section.getByRole('button',{name:'表情',exact:true}).evaluate(node=>{const s=getComputedStyle(node);return s.outlineStyle!=='none'&&s.outlineWidth!=='0px'}))
 pass('120 categorized Unicode emoji preserve caret insertion, 500-character limit, text focus and toolbar keyboard focus')
 const chooser=page.waitForEvent('filechooser');await section.getByRole('button',{name:'添加图片 / 视频',exact:true}).click()
 const albumPicker=await chooser
 assert.equal(await albumPicker.element().getAttribute('capture'),null)
 assert.equal(albumPicker.isMultiple(),true)
 assert.ok((await albumPicker.element().getAttribute('accept')).includes('video/mp4'))
 await albumPicker.setFiles([{name:'catch.png',mimeType:'image/png',buffer:image},{name:'clip.mp4',mimeType:'video/mp4',buffer:video}])
 await page.waitForFunction(()=>document.querySelectorAll('.post-comments .mobile-evidence__item').length===2 && document.querySelectorAll('.post-comments .mobile-media-uploader__progress').length===0)
 await composerLayout(section,'media')
 await section.locator('.mobile-comment-composer-shell').screenshot({path:`${output}/composer-ready-375.png`})
 await page.setViewportSize({width:320,height:812});await page.emulateMedia({colorScheme:'dark'});await setH5TextScale(page,24)
 await section.locator('.mobile-evidence__preview').nth(1).click()
 await page.waitForFunction(()=>document.querySelector('dialog[open] video')?.currentTime>.2)
 await page.getByRole('button',{name:'关闭视频预览',exact:true}).click()
 assert.equal(await section.locator('.mobile-evidence__item').count(),2)
 await page.setViewportSize({width:375,height:812});await page.emulateMedia({colorScheme:'light'});await setH5TextScale(page,16)
 await section.locator('.mobile-evidence__preview').first().focus();await page.keyboard.press('Alt+ArrowRight')
 await section.getByRole('button',{name:'发表评论',exact:true}).click()
 await section.getByRole('alert').first().waitFor()
 assert.equal(await input.inputValue(),'河边👍不错，')
 assert.equal(await section.locator('.mobile-evidence__item').count(),2)
 await section.locator('.mobile-comment-composer-shell').screenshot({path:`${output}/composer-send-failed-375.png`})
 await section.getByRole('button',{name:'发表评论',exact:true}).click()
 await page.waitForFunction(()=>document.querySelectorAll('.post-comments__item').length===2 && document.querySelector('.post-comments textarea')?.value==='' && document.querySelectorAll('.post-comments .mobile-evidence__item').length===0)
 const commands=writes.filter(item=>item.action==='comment')
 assert.equal(commands.length,2);assert.equal(commands[0].payload.id,commands[1].payload.id)
 assert.deepEqual(commands[0].payload.media.map(item=>assets.find(asset=>asset.id===item.id).kind),['video','image'])
 assert.equal(await input.inputValue(),'');assert.equal(await section.locator('.mobile-evidence__item').count(),0)
 pass('mixed image/video uses the shared queue; reordered attachment IDs and emoji body survive failed send and unchanged retry')
 for(const [name,width,height,dark,scale]of modes){
  await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:dark?'dark':'light'});await setH5TextScale(page,scale)
  await section.scrollIntoViewIfNeeded()
  await page.waitForFunction(()=>document.querySelectorAll('.post-comments .mobile-media-gallery__image').length===3)
  const boxes=await section.locator('.mobile-media-gallery__item').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{w:r.width,h:r.height}}))
  assert.ok(boxes.every(box=>Math.abs(box.w-box.h)<2 && box.w<=180))
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  await page.screenshot({path:`${output}/comments-${name}.png`,fullPage:true})
  await section.getByRole('button',{name:'表情',exact:true}).click();await emoji.waitFor()
  const options=await emoji.locator('.mobile-emoji-picker__choice').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{w:r.width,h:r.height}}))
  assert.ok(options.every(box=>box.w>=48 && box.h>=48))
  await page.screenshot({path:`${output}/emoji-${name}.png`})
  await page.keyboard.press('Escape');await emoji.waitFor({state:'hidden'})
  await page.waitForFunction(()=>document.activeElement?.id==='comment-emoji-trigger')
 }
 pass('comments and emoji picker fit six viewport/text modes; single and mixed media stay compact and controls remain reachable')
 await page.setViewportSize({width:375,height:812});await page.emulateMedia({colorScheme:'light'});await setH5TextScale(page,16)
 await section.getByRole('button',{name:/播放视频，第1项/}).click()
 await page.waitForFunction(()=>document.querySelector('dialog[open] video')?.currentTime>.2)
 await page.getByRole('button',{name:'关闭视频预览',exact:true}).click()
 await section.getByRole('button',{name:/评论附件，查看大图，第2项/}).click()
 await page.locator('.mobile-image-viewer[open] img.mobile-image-viewer__loaded').waitFor()
 await page.getByRole('button',{name:'关闭预览',exact:true}).click()
 pass('comment attachments open the same full-screen image/video viewers and close with X')
 await section.getByRole('button',{name:'回复 水边钓友',exact:true}).click()
 await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='写一条回复')
 await checkInputFocus(input,section,'reply')
 const attach=page.waitForEvent('filechooser');await section.getByRole('button',{name:'添加图片 / 视频',exact:true}).click()
 await(await attach).setFiles({name:'only-photo.png',mimeType:'image/png',buffer:image})
 await page.waitForFunction(()=>document.querySelectorAll('.post-comments .mobile-evidence__item').length===1 && document.querySelectorAll('.post-comments .mobile-media-uploader__progress').length===0)
 await section.locator('.mobile-comment-composer-shell').screenshot({path:`${output}/composer-reply-375.png`})
 await section.getByRole('button',{name:'发表评论',exact:true}).click()
 await page.waitForFunction(()=>document.querySelectorAll('.post-comments__item').length===3)
 const mediaOnly=writes.filter(item=>item.action==='comment').at(-1).payload
 assert.equal(mediaOnly.body,'');assert.equal(mediaOnly.media.length,1);assert.equal(mediaOnly.reply_to_id,'comment-existing')
 await section.getByRole('button',{name:'回复 验收钓友',exact:true}).first().click()
 assert.ok((await section.locator('.post-comments__composer').innerText()).includes('[图片 / 视频]'))
 await section.getByRole('button',{name:'取消回复',exact:true}).click()
 await section.getByRole('button',{name:'删除自己的评论',exact:true}).first().click()
 const confirm=page.getByRole('alertdialog',{name:'删除这条评论？',exact:true});await confirm.waitFor()
 await confirm.getByRole('button',{name:'取消',exact:true}).click();await confirm.waitFor({state:'hidden'})
 assert.equal(comments.length,3)
 await section.getByRole('button',{name:'删除自己的评论',exact:true}).first().click()
 await confirm.getByRole('button',{name:'删除评论',exact:true}).click()
 await page.waitForFunction(()=>document.querySelectorAll('.post-comments__item').length===2)
 assert.equal(await section.getByRole('button',{name:'举报 水边钓友 的评论',exact:true}).count(),1)
 pass('media-only reply, attachment quote fallback, cancel/delete and reporting actions remain available')
 assert.deepEqual(errors,[]);assert.deepEqual(escaped,[])
 await writeFile(`${output}/result.json`,JSON.stringify({passed:true,checks,errors,uploads:uploadSequence,writes:writes.length,boundary:'Isolated HTTP/session data; actual local PNG/MP4 decoding and browser gestures. No hosted upload, post or external delivery.'},null,2))
}catch(error){await page.screenshot({path:`${output}/failure.png`,fullPage:true});throw error}
finally{await context.close();await browser.close()}
