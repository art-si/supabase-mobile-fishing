// Layout measurements from the local Supabase QA account.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {readBuildFiles} from './miniapp-package.mjs'
import {assertLocalConfig, requireLocalWechat} from './ui-contract-target.mjs'
const build=resolve(process.env.MINIAPP_UI_BUILD_DIR||'dist/ui-local/mp-weixin')
const config=[...readBuildFiles(build).values()].map(x=>x.toString()).find(x=>x.includes('supabaseUrl:')&&x.includes('phoneAuth:'))
assertLocalConfig(config || '')
const require=createRequire(resolve('artifacts/miniapp-tools/package.json'))
const client=await require('miniprogram-automator').connect({wsEndpoint:process.env.MINIAPP_ENDPOINT || 'ws://127.0.0.1:9423'})
const output=resolve(process.env.UI_OUTPUT_DIR || 'artifacts/weixin-ui-parity/post-comment-flow')
await mkdir(output,{recursive:true})
const pause=ms=>new Promise(r=>setTimeout(r,ms)),results=[],exceptions=[]
client.on('exception',e=>exceptions.push(String(e.message||e.text)))
const timer=setTimeout(()=>{console.error('Comment layout check timed out');process.exit(2)},95000)
async function op({name,kind,event,values,selector,field}){
 return client.evaluate(({name,kind,event,values,selector,field})=>{
  const all=[],seen=new Set();const walk=x=>{if(!x||seen.has(x))return;seen.add(x);all.push(x);for(const c of x.$children||[])walk(c)}
  walk(getCurrentPages().at(-1)?.$vm)
  const vm=all.find(x=>x.$options?.__name===name&&(!field||x.$props.field===field))
  if(!vm)throw Error('Missing '+name)
  if(kind==='emit'){vm.$emit(event,...values);return true}
  if(kind==='props')return {plain:vm.$props.plain,adjustPosition:vm.$props.adjustPosition,value:vm.$props.modelValue}
  if(kind==='rects')return new Promise(done=>{setTimeout(()=>done(null),1500);const q=wx.createSelectorQuery().in(vm.$scope);q.selectAll(selector).boundingClientRect();q.exec(x=>done(x?.[0]||[]))})
  return false
 },{name,kind,event,values,selector,field})
}
async function shot(name){await client.screenshot({path:resolve(output,name+'.png')});console.log('SAVED '+name)}
try{
 console.log('OPEN post')
 await client.callWxMethod('reLaunch',{url:'/pages/post/detail?id=a1111111-1111-4111-8111-111111111111'})
 await pause(1000)
 await requireLocalWechat(client, config)
 await pause(1000)
 const info=await client.evaluate(()=>({height:wx.getWindowInfo().windowHeight,capsule:wx.getMenuButtonBoundingClientRect().bottom}))
 console.log('SCROLL to editor')
 await client.callWxMethod('pageScrollTo',{scrollTop:100000,duration:0})
 await pause(500)
 const before=await op({name:'PostComments',kind:'rects',selector:'#post-comment-composer'})
 assert.equal(before?.length,1);assert.ok(before[0].height>=140,'native container owns the complete editor height')
 assert.equal((await op({name:'MobileCommentComposer',kind:'rects',selector:'.mobile-comment-composer__reply'})).length,0,'no empty reply slot')
 assert.equal((await op({name:'MobileCommentComposer',kind:'rects',selector:'.mobile-comment-composer__meta'})).length,0,'no empty counter slot')
 const emptyAttachments=await op({name:'MobileCommentComposer',kind:'rects',selector:'.mobile-comment-composer__attachments'})
 assert.ok(emptyAttachments.every(r=>r.height===0),'empty uploader keeps no layout gap')
 await shot('editor-closed')
 console.log('SET draft')
 await op({name:'MobileField',field:'comment',kind:'emit',event:'update:modelValue',values:['键盘升降后保留这段评论草稿']})
 const props=await op({name:'MobileField',field:'comment',kind:'props'})
 assert.equal(props.plain,true);assert.equal(props.adjustPosition,false)
 assert.equal((await op({name:'MobileCommentComposer',kind:'rects',selector:'.mobile-comment-composer__meta'})).length,1,'counter appears with content')
 console.log('OPEN keyboard height')
 await op({name:'MobileField',field:'comment',kind:'emit',event:'keyboard',values:[300]})
 await pause(600)
 const box=await op({name:'PostComments',kind:'rects',selector:'#post-comment-composer'})
 const send=await op({name:'MobileCommentComposer',kind:'rects',selector:'.mobile-comment-composer__send'})
 assert.equal(box?.length,1);assert.equal(send?.length,1)
 assert.ok(box[0].height>=140 && box[0].top>=info.capsule,'editor remains below the capsule')
 assert.ok(send[0].bottom<=info.height-300,'the complete send button is above the keyboard')
 assert.ok(send[0].bottom<=box[0].bottom+1,'toolbar belongs to the editor height')
 await shot('editor-keyboard-open')
 console.log('CLOSE keyboard height')
 await op({name:'MobileField',field:'comment',kind:'emit',event:'keyboard',values:[0]})
 await pause(300)
 assert.equal((await op({name:'MobileField',field:'comment',kind:'props'})).value,'键盘升降后保留这段评论草稿')
 await shot('editor-keyboard-closed')
 results.push({name:'comment-layout',passed:true,before,box,send,scope:'simulated keyboard height; not physical phone acceptance'})
 assert.deepEqual(exceptions,[])
}catch(error){results.push({passed:false,error:error.message});console.error(error.message);process.exitCode=1}
finally{clearTimeout(timer);await writeFile(resolve(output,'manifest.json'),JSON.stringify({results,exceptions},null,2));await client.disconnect()}
