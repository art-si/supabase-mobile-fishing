import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as geometry from '../src/domain/water-geometry'

function resolver(indexed: unknown) {
  let source = readFileSync(new URL('../src/services/nearby-water.ts', import.meta.url), 'utf8')
  source = source.replace(/\/\/ #ifdef H5[\s\S]*?\/\/ #endif/g, '')
  const exports: any = {}
  const modules: Record<string, unknown> = {
    '@/domain/water-geometry': geometry,
    './water-index': { lookupMappedWater: async () => indexed },
    './amap': { lookupMapShoreline: async () => { throw new Error('upstream unavailable') } }
  }
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (id: string) => { assert.ok(id in modules, id); return modules[id] } })
  return exports.resolveNearbyWater
}
test('water resolution preserves actionable quota and network errors instead of disguising them as an unknown failure', async () => {
  for (const code of ['MAP_QUOTA_EXCEEDED', 'NETWORK_ERROR', 'SESSION_CHANGED']) {
    const failure = Object.assign(new Error('safe service message'), { code, status: 429 })
    await assert.rejects(resolver(undefined)([114,30], 2000, async () => { throw failure }), error => error === failure)
  }
})
test('a verified named water survives an unavailable live provider', async () => {
  const water = { surface: { name: 'Known lake' }, point: [114,30], distance: 100, polygon: [[[114,30],[114.1,30],[114,30.1],[114,30]]] }
  const result = await resolver(water)([114,30], 2000, async () => { throw new Error('names unavailable') })
  assert.equal(result.name, 'Known lake')
  assert.equal(result.source, 'index')
})
