import test from 'node:test'
import assert from 'node:assert/strict'
import { regionId,regionNames,regionLabel } from '../src/domain/regions'
test('one region value resolves counties, municipalities and direct province-administered cities',()=>{
 assert.deepEqual(regionNames('420222'),{province:'湖北省',city:'黄石市',district:'阳新县'})
 assert.equal(regionId({province:'北京市',city:'北京市',district:'朝阳区'}),'110105')
 assert.equal(regionLabel(regionNames('110105')),'北京市 · 朝阳区')
 assert.equal(regionId({province:'湖北省',city:'',district:'仙桃市'}),'429004')
 assert.equal(regionLabel(regionNames('429004')),'湖北省 · 仙桃市')
})
test('public province-only filters remain distinct from private city or county choices',()=>{
 assert.deepEqual(regionNames('province-420000'),{province:'湖北省',city:'',district:''})
 assert.equal(regionId({province:'湖北省',city:'',district:''}),'province-420000')
 assert.deepEqual(regionNames('420200'),{province:'湖北省',city:'黄石市',district:''})
 assert.equal(regionId({province:'湖北省',city:'黄石市',district:''}),'420200')
})
