import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

function service() {
  const exports:any={},scope={value:1},calls:any[]=[]
  let now=0,fail=false
  const modules:Record<string,unknown>={
    './session':{sessionScope:scope,sessionRequest:async (_:string,options:any)=>{
      calls.push(options.data)
      if(fail)throw Error('MAP_QUOTA_EXCEEDED')
      return {province:'江苏省',city:'苏州市',items:[],water:null}
    }},
    './http':{ApiError:Error},'@/domain/user-errors':{serviceErrorMessage:(s:string)=>s}
  }
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/services/amap.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,require:(id:string)=>{assert.ok(id in modules,id);return modules[id]},Date:{now:()=>now},Map,Set,JSON,Error
  })
  return {api:exports,calls,scope,expire:()=>{now+=600001},fail:(value:boolean)=>{fail=value}}
}
test('repeated and concurrent region lookups share one authenticated map request',async()=>{
  const state=service()
  await Promise.all([state.api.lookupMapRegion(120,31),state.api.lookupMapRegion(120,31)])
  await state.api.lookupMapRegion(120,31)
  assert.equal(state.calls.length,1)
  await state.api.lookupMapRegion(121,31)
  assert.equal(state.calls.length,2)
  state.expire();await state.api.lookupMapRegion(120,31)
  assert.equal(state.calls.length,3)
})
test('map fact reuse ends when the signed-in session changes',async()=>{
  const state=service()
  await state.api.lookupMapRegion(120,31)
  state.scope.value++
  await state.api.lookupMapRegion(120,31)
  assert.equal(state.calls.length,2)
})
test('quota failures can be retried and private previews are never cached',async()=>{
  const state=service();state.fail(true)
  await assert.rejects(state.api.lookupMapRegion(120,31),/MAP_QUOTA_EXCEEDED/)
  state.fail(false);await state.api.lookupMapRegion(120,31)
  assert.equal(state.calls.length,2)
  for(let i=0;i<2;i++)await assert.rejects(state.api.getStaticPreview({longitude:120,latitude:31,precision:'exact'},14))
  assert.equal(state.calls.filter(x=>x.action==='preview').length,2)
})
