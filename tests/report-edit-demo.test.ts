import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as seedModule from '../src/demo/seed'
import * as rules from '../src/domain/rules'
import * as composition from '../src/domain/composition'
import * as errors from '../src/domain/user-errors'
import * as water from '../src/domain/water-report'
import * as catches from '../src/domain/trip-catches'
import * as measurements from '../src/domain/catch-measurements'
import * as coordinates from '../src/_mobile-core/coordinates'
import { updateWaterReportPayload } from '../src/domain/report-edit'

test('demo report edits preserve identity and media order, reject stale/cross-owner edits and stay deleted', () => {
  const storage = new Map<string, any>(), exports: Record<string, any> = {}
  class ApiError extends Error { constructor(message:string,public status:number,public code:string){super(message)} }
  const dependencies: Record<string, unknown> = {
    './seed': seedModule, '@/domain/rules': rules, '@/domain/composition': composition,
    '@/services/http': {ApiError}, '@/domain/user-errors': errors, '@/domain/water-report': water,
    '@/domain/trip-catches': catches, '@/domain/catch-measurements': measurements,
    '@mobile-core/coordinates': coordinates
  }
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/demo/database.ts', import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {
    exports, require: (id:string) => { assert.ok(id in dependencies,id); return dependencies[id] },
    uni: { getStorageSync:(key:string)=>storage.get(key),setStorageSync:(key:string,value:unknown)=>storage.set(key,value) }
  })
  const owner = seedModule.me.id, other = seedModule.chen.id, assetA={id:rules.createId(),path:'image-a.png',kind:'image',width:40,height:40}, assetB={id:rules.createId(),path:'video-b.mp4',kind:'video',width:80,height:40,duration:3}
  exports.rememberDemoPhoto(owner,assetA); exports.rememberDemoPhoto(owner,assetB)
  const draft={...water.freshWaterReport(),province:'湖北省',city:'黄石市',district:'阳新县',location_label:'隔离测试水域',description:'仅作本机流程测试的记录',media:[assetA,assetB]} as water.WaterReportDraft
  assert.throws(()=>exports.execute('write','save_water_report',water.waterReportPayload(draft),owner),/经纬度/)
  Object.assign(draft,{longitude:115.22,latitude:29.84})
  const saved=exports.execute('write','save_water_report',water.waterReportPayload(draft),owner)
  const edit=updateWaterReportPayload({...draft,description:'编辑后的本机流程测试记录',media:[assetB,assetA]},saved.revision,rules.createId())
  assert.throws(()=>exports.execute('write','update_water_report',edit,other),/内容不存在/)
  assert.throws(()=>exports.execute('write','update_water_report',{...edit,latitude:null},owner))
  const result=exports.execute('write','update_water_report',edit,owner)
  assert.equal(result.id,saved.id);assert.equal(result.created_at,saved.created_at);assert.equal(result.revision,2)
  assert.equal(result.media.map((m:any)=>m.id).join(','),`${assetB.id},${assetA.id}`)
  assert.equal(exports.execute('write','update_water_report',edit,owner).revision,2)
  assert.throws(()=>exports.execute('write','update_water_report',{...edit,request_id:rules.createId()},owner),/已有新版本/)
  assert.throws(()=>exports.execute('write','update_water_report',{...edit,description:'请求被改变'},owner),/提交内容已变化/)
  const wrongAsset={...assetA,id:rules.createId()};exports.rememberDemoPhoto(other,wrongAsset)
  assert.throws(()=>exports.execute('write','update_water_report',{...edit,expected_revision:2,request_id:rules.createId(),media:[wrongAsset]},owner),/附件不可用/)
  const replaced=exports.execute('write','update_water_report',{...edit,expected_revision:2,request_id:rules.createId(),media:[assetB]},owner)
  assert.equal(replaced.revision,3); assert.equal(replaced.media.length,1)
  assert.equal(storage.get('dyj.demo.database.v1').draftPhotos.some((p:any)=>p.asset.id===assetA.id),false)
  assert.equal(exports.execute('write','delete_water_report',{id:saved.id},owner),true)
  assert.equal(exports.execute('write','delete_water_report',{id:saved.id},owner),true)
  assert.throws(()=>exports.execute('write','update_water_report',edit,owner),/内容不存在/)
  assert.throws(()=>exports.execute('write','save_water_report',water.waterReportPayload(draft),owner),/内容不存在/)
  assert.equal(exports.execute('read','water_reports',{},owner).items.length,0)
})
