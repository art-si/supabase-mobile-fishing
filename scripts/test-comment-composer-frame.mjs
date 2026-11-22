// Narrow regression: real Uni textarea layers in normal, attached and reply states.
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
const base=process.env.FISHING_H5_URL||'http://127.0.0.1:5178',out='artifacts/comment-composer-frame'
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));await mkdir(out,{recursive:true})
const owner='11111111-1111-4111-8111-111111111111',postId='22222222-2222-4222-8222-222222222222'
const author={id:owner,nickname:'输入框验收',city:'',bio:'',method:'',handle:''}
const post={id:postId,author,body:'隔离接口验收',title:'',kind:'catch',audience:'public',status:'published',created_at:new Date().toISOString(),like_count:0,comment_count:1,media:[],review_revision:1}
const comment={id:'comment-existing',author:{...author,id:'33333333-3333-4333-8333-333333333333'},body:'试试轻口钓法',status:'published',created_at:new Date().toISOString(),reply_to_id:null,reply_to:null,media:[]}
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:375,height:812},locale:'zh-CN',reducedMotion:'reduce'}),page=await context.newPage()
const errors=[],escaped=[],records=[];let passed=false
await context.addInitScript(owner=>localStorage.setItem('dyj.auth.v1',JSON.stringify({type:'object',data:{access_token:'isolated-comment-frame',refresh_token:'fixture',expires_at:Date.now()/1000+3600,user:{id:owner}}})),owner)
await context.routeWebSocket(/supabase\.co/,socket=>socket.close())
await context.route('**/*',async route=>{
 const request=route.request(),url=new URL(request.url())
 if(url.origin===base||!url.protocol.startsWith('http'))return route.continue()
 if(url.origin!=='https://jupuypvmgjpnpntfetqv.supabase.co'){escaped.push(url.origin);return route.abort()}
 const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'},reply=json=>route.fulfill({json,headers})
 if(request.method()==='OPTIONS')return reply({})
 if(url.pathname==='/auth/v1/user')return reply({id:owner})
 if(url.pathname.endsWith('fishing_read')){const body=request.postDataJSON()||{};return reply(body.action==='post'?{post,comments:[comment],comments_next:null}:body.action==='profile'?{profile:author,posts:[]}:{items:[],next:null})}
 if(url.pathname.endsWith('media-upload'))return reply({id:'44444444-4444-4444-8444-444444444444',path:`${owner}/image.jpg`,kind:'image',width:256,height:256})
 if(url.pathname.endsWith('fishing_moderation'))return reply({allowed:false})
 escaped.push(`${request.method()} ${url.pathname}`);return route.abort()
})
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(30000)
async function inspect(state,focused){
 const input=page.locator('.post-comments textarea')
 if(focused)await input.focus();else await input.evaluate(node=>{node.blur();document.activeElement?.blur?.()})
 const layers=await page.locator('.mobile-comment-composer__input').evaluate(root=>{
  const rules=[]
  const visit=sheet=>{try{for(const rule of sheet.cssRules||[]){if(rule.selectorText&&rule.style)rules.push(rule);else if(rule.cssRules)visit(rule)}}catch{}}
  for(const sheet of document.styleSheets)visit(sheet)
  return [root,...root.querySelectorAll('*')].filter(node=>node.getBoundingClientRect().height>0).map(node=>{
   const style=getComputedStyle(node)
   return{tag:node.tagName,class:node.className,border:style.borderWidth,borderColor:style.borderColor,radius:style.borderRadius,background:style.backgroundColor,outline:style.outlineStyle,shadow:style.boxShadow,
    matches:rules.filter(rule=>{try{return node.matches(rule.selectorText)&&/border|background|outline|box-shadow/.test(rule.style.cssText)}catch{return false}}).map(rule=>({selector:rule.selectorText,style:rule.style.cssText}))}
  })
 })
 records.push({state,focused,layers})
 await page.locator('.mobile-comment-composer-shell').screenshot({path:`${out}/${state}-${focused?'focused':'blurred'}-375.png`})
 if(!process.argv.includes('--inspect-only')){
  for(const layer of layers){
   assert.equal(layer.border,'0px',`${state} ${layer.class} border`)
   assert.equal(layer.radius,'0px',`${state} ${layer.class} radius`)
   assert.equal(layer.background,'rgba(0, 0, 0, 0)',`${state} ${layer.class} background`)
   assert.equal(layer.shadow,'none',`${state} ${layer.class} shadow`)
   assert.equal(layer.outline,'none',`${state} ${layer.class} outline`)
  }
  const shadow=await page.locator('.mobile-comment-composer').evaluate(node=>getComputedStyle(node).boxShadow)
  assert.equal(shadow==='none',!focused,'focus is shown only on the outer composer')
 }
}
try{
 await page.goto(`${base}/#/pages/post/detail?id=${postId}`);await page.locator('.post-comments textarea').waitFor()
 await inspect('empty',false);await inspect('empty',true)
 const selection=page.waitForEvent('filechooser');await page.getByRole('button',{name:'添加图片 / 视频',exact:true}).click();await(await selection).setFiles('assets/brand/fish-symbol.png')
 await page.waitForFunction(()=>!!document.querySelector('.post-comments .mobile-media-uploader__image img')?.naturalWidth)
 await inspect('attached',false);await inspect('attached',true)
 await page.getByRole('button',{name:'回复 输入框验收',exact:true}).first().click()
 await inspect('reply',false);await inspect('reply',true)
 const moved=await page.evaluate(()=>{const fields=[...document.querySelectorAll('style')].filter(style=>style.dataset.viteDevId?.includes('MobileField.vue'));fields.forEach(style=>document.head.appendChild(style));return fields.length})
 assert.ok(moved>0)
 await inspect('reply-hmr',false);await inspect('reply-hmr',true)
 const emoji=page.getByRole('button',{name:'表情',exact:true})
 for(let step=0;step<10&&!await emoji.evaluate(node=>node===document.activeElement);step++)await page.keyboard.press('Tab')
 assert.ok(await emoji.evaluate(node=>node===document.activeElement),'Tab reaches the emoji tool')
 assert.notEqual(await emoji.evaluate(node=>getComputedStyle(node).outlineStyle),'none','keyboard tool focus remains visible')
 assert.deepEqual(errors,[]);assert.deepEqual(escaped,[])
 passed=!process.argv.includes('--inspect-only')
 console.log(`${passed?'PASS':'INSPECTED'} ${records.length} real composer states${passed?'; no inner field border':''}`)
}finally{
 await writeFile(`${out}/result.json`,JSON.stringify({passed,records,errors,escaped},null,2));await browser.close()
}
