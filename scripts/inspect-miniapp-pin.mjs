import {createRequire} from 'node:module'
const require=createRequire(`${process.cwd()}/artifacts/miniapp-tools/package.json`)
const timer=setTimeout(()=>process.exit(2),20000)
let client
try {
 client=await require('miniprogram-automator').connect({wsEndpoint:'ws://127.0.0.1:9440'})
 client.on('error',()=>{})
 console.log(JSON.stringify(await client.evaluate(async()=>{
  let vm
  const walk=v=>{if(!v)return;if(v.$options.__name==='NativeWaterMap')vm=v;(v.$children||[]).forEach(walk)}
  walk(getCurrentPages().at(-1)?.$vm)
  if(!vm)return {map:false}
  const data=vm.$scope.data,ctx=wx.createMapContext(data.b,vm.$scope)
  const point=vm.$props.selected
  const projected=point?await new Promise(resolve=>{
   setTimeout(()=>resolve({timeout:true}),2500)
   ctx.toScreenLocation({...point,success:resolve,fail:resolve})
  }):null
  return {visible:data.t,x:data.w,y:data.x,markers:data.i?.length,pending:vm.$props.operationPending,
   size:vm.$props.size,selected:point,projected}
 })))
}finally{await client?.disconnect();clearTimeout(timer)}
