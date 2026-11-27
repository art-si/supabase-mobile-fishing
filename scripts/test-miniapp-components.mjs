import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { assertLocalConfig, requireLocalWechat } from './ui-contract-target.mjs'
import { readBuildFiles } from './miniapp-package.mjs'
const build=resolve(process.env.MINIAPP_UI_BUILD_DIR || 'dist/ui-local/mp-weixin')
const configuration=[...readBuildFiles(build).values()].map(x=>x.toString()).find(x=>x.includes('supabaseUrl:')&&x.includes('phoneAuth:'))
assertLocalConfig(configuration || '')
const require=createRequire(resolve('artifacts/miniapp-tools/package.json'))
const client=await require('miniprogram-automator').connect({wsEndpoint:process.env.MINIAPP_ENDPOINT || 'ws://127.0.0.1:9423'})
const output=resolve(process.env.UI_OUTPUT_DIR || 'artifacts/weixin-ui-parity/native-components')
await mkdir(output,{recursive:true})
const results=[],exceptions=[]
client.on('exception',e=>exceptions.push(String(e.message||e.text)))
const pause=ms=>new Promise(done=>setTimeout(done,ms))
const watchdog=setTimeout(()=>{console.error('UI component capture timed out');process.exit(2)},150000)
async function op(args) {
  return client.evaluate(({kind,name,field,event,values,collection,labelKey,label,eventKey,selector})=>{
    const seen=new Set()
    const all=[]
    function visit(vm){if(!vm||seen.has(vm))return;seen.add(vm);all.push(vm);for(const child of vm.$children||[])visit(child)}
    visit(getCurrentPages().at(-1)?.$vm)
    const vm=all.find(x=>x.$options?.__name===name&&(!field||x.$props?.field===field))
    if(kind==='names')return all.map(x=>({name:x.$options?.__name,field:x.$props?.field,label:x.$props?.label}))
    if(!vm)throw Error(`Missing component ${name}/${field||''}`)
    if(kind==='props')return {plain:vm.$props.plain,adjustPosition:vm.$props.adjustPosition,label:vm.$props.label}
    if(kind==='emit'){vm.$emit(event,...(values||[]));return true}
    if(kind==='data')return vm.$scope.data
    if(kind==='tap'){
      const scope=vm.$scope
      const data=collection?scope.data[collection]?.find(row=>row[labelKey]===label):scope.data
      const key=data?.[eventKey]
      if(typeof scope[key]!=='function')throw Error(`Missing native tap ${name}: ${String(key)}`)
      scope[key]({type:'tap',timeStamp:Date.now(),detail:{},target:{dataset:{}},currentTarget:{dataset:{}}})
      return {component:name,label:label||eventKey}
    }
    if(kind==='rects')return new Promise(done=>{
      const timer=setTimeout(()=>done(null),1500)
      const query=wx.createSelectorQuery().in(vm.$scope)
      query.selectAll(selector).boundingClientRect()
      query.exec(items=>{clearTimeout(timer);done(items?.[0]||[])})
    })
    return false
  },args)
}
async function go(url){
  await client.callWxMethod('reLaunch',{url})
  for(let i=0;i<40;i++){
    await pause(300)
    if(await client.evaluate(path=>getCurrentPages().at(-1)?.route===path&&!!getCurrentPages().at(-1)?.$vm,url.split('?')[0].slice(1)))break
  }
  await pause(700)
}
async function shot(name){await pause(450);await client.screenshot({path:resolve(output,name+'.png')});results.push({name,screenshot:name+'.png',review:'pending'});console.log('SAVED '+name)}
try{
  await client.callWxMethod('reLaunch',{url:'/pages/login/index'})
  for(let attempt=0;attempt<50;attempt++){
    if(await client.evaluate(()=>!!getCurrentPages().at(-1)?.$vm?.$pinia?._s.get('fishing-auth')))break
    await pause(300)
  }
  await requireLocalWechat(client, configuration)
  await go('/pages/mine/profile')
  await shot('profile')
  await op({kind:'emit',name:'MobilePickerTrigger',event:'click',values:[],field:undefined})
  // The first picker on the profile is the city picker.
  await shot('city-provinces')
  const provinces=await op({kind:'rects',name:'MobileCityPicker',field:'profile-city',selector:'.mobile-city-picker__province'})
  if(provinces?.length)assert.ok(provinces.every(r=>r.height>=47))
  await op({kind:'tap',name:'MobileCityPicker',field:'profile-city',collection:'E',labelKey:'a',label:'江苏省',eventKey:'c'})
  await shot('city-list')
  await op({kind:'tap',name:'MobileCityPicker',field:'profile-city',collection:'R',labelKey:'a',label:'南京市',eventKey:'k'})
  // Find the method trigger by its accessible label rather than relying on its order.
  await client.evaluate(()=>{
    const find=vm=>vm?.$options?.__name==='MobilePickerTrigger'&&vm.$props.label==='选择喜欢的钓法'?vm:vm?.$children?.map(find).find(Boolean)
    const trigger=find(getCurrentPages().at(-1).$vm);if(!trigger)throw Error('Missing method trigger');trigger.$emit('click');return true
  })
  await shot('method-choices')
  await op({kind:'tap',name:'MobileMultiChoice',field:'method',collection:'i',labelKey:'a',label:'路亚',eventKey:'f'})
  await shot('method-selected')
  await op({kind:'tap',name:'MobileMultiChoice',field:'method',eventKey:'v'})
  await go('/pages/water-report/index')
  await client.evaluate(()=>{
    const find=vm=>vm?.$options?.__name==='MobilePickerTrigger'&&vm.$props.label==='选择事发日期'?vm:vm?.$children?.map(find).find(Boolean)
    find(getCurrentPages().at(-1).$vm)?.$emit('click');return true
  })
  await shot('calendar')
  await op({kind:'emit',name:'MobileCalendarDate',event:'update:visible',values:[false]})
  await op({kind:'emit',name:'MobileTimePicker',event:'update:visible',values:[true]})
  await shot('time')
  await op({kind:'emit',name:'MobileTimePicker',event:'update:visible',values:[false]})
  await go('/pages/post/compose')
  await client.evaluate(()=>{
    const find=vm=>vm?.$options?.__name==='MobilePickerTrigger'&&vm.$props.label==='分享范围'?vm:vm?.$children?.map(find).find(Boolean)
    find(getCurrentPages().at(-1).$vm)?.$emit('click');return true
  })
  await shot('share-scope')
  await go('/pages/post/detail?id=a1111111-1111-4111-8111-111111111111')
  await op({kind:'emit',name:'MobileCommentComposer',event:'emoji',values:[]})
  await shot('emoji')
  await go('/pages/home/index?tab=spots')
  await op({kind:'emit',name:'SpotCard',event:'comments',values:[]})
  await shot('spot-comments')
  await op({kind:'emit',name:'DiscussionComment',event:'reply',values:[]})
  const fieldInfo=await client.evaluate(()=>{
    const find=vm=>vm?.$options?.__name==='MobileField'&&String(vm.$props.field).startsWith('spot-comment-')?vm:vm?.$children?.map(find).find(Boolean)
    const field=find(getCurrentPages().at(-1).$vm);if(!field)throw Error('Missing comment field');return {field:field.$props.field,plain:field.$props.plain,adjustPosition:field.$props.adjustPosition}
  })
  assert.equal(fieldInfo.plain,true);assert.equal(fieldInfo.adjustPosition,false)
  await op({kind:'emit',name:'MobileField',field:fieldInfo.field,event:'keyboard',values:[300]})
  await shot('spot-reply-keyboard')
  const rects=await op({kind:'rects',name:'MobileField',field:fieldInfo.field,selector:'.mobile-field__control'})
  const capsule=await client.evaluate(()=>wx.getMenuButtonBoundingClientRect())
  if(rects?.length)assert.ok(rects[0].top>=capsule.bottom+4,'reply input must remain below the WeChat capsule')
  await op({kind:'emit',name:'MobileField',field:fieldInfo.field,event:'keyboard',values:[0]})
  await shot('spot-reply-keyboard-closed')
  results.push({name:'keyboard-contract',passed:true,fieldInfo,rects,capsuleBottom:capsule.bottom,scope:'simulated keyboard-height event, not physical Android keyboard acceptance'})
  assert.deepEqual(exceptions,[])
}catch(error){results.push({name:'failure',error:String(error.message||error)});console.error(error.message);process.exitCode=1}
finally{
  await writeFile(resolve(output,'manifest.json'),JSON.stringify({scope:'local Supabase QA account; no hosted production writes',results,exceptions},null,2))
  clearTimeout(watchdog);await client.disconnect()
}
