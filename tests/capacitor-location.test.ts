import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
const core = resolve(
  process.env.MOBILE_PRO_ROOT || '../supabase-mobile-pro',
  'packages/mobile-core/src'
)
function module(name: string, deps: Record<string, any> = {}) {
  const exports: any = {}
  runInNewContext(
    ts.transpileModule(readFileSync(resolve(core, name), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    { exports, require: (id: string) => deps[id] }
  )
  return exports
}
const coordinates = module('coordinates.ts')
const { captureCapacitorGcj02 } = module('location.ts', { './coordinates': coordinates })
function plugin(location = 'granted', coarseLocation = location) {
  const calls: any[] = []
  return {
    calls,
    adapter: {
      async checkPermissions() {
        calls.push('check')
        return { location, coarseLocation }
      },
      async requestPermissions(options: any) {
        calls.push(['permission', options])
        return { location: 'granted', coarseLocation: 'granted' }
      },
      async getCurrentPosition(options: any) {
        calls.push(['position', options])
        return { coords: { longitude: 120, latitude: 31, accuracy: 25 } }
      }
    }
  }
}
test('native location is one foreground fix, uses shared WGS84 conversion exactly once and preserves accuracy', async () => {
  const p = plugin()
  const result = await captureCapacitorGcj02(p.adapter)
  const [longitude, latitude] = coordinates.wgs84ToGcj02(120, 31)
  assert.deepEqual({ ...result }, { longitude, latitude, accuracyM: 25 })
  assert.notEqual(result.longitude, 120)
  assert.equal(p.calls.length, 2)
  assert.deepEqual(
    { ...p.calls[1][1] },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0, enableLocationFallback: true }
  )
})
test('native permission prompt is contextual; denied permission neither re-prompts nor reads a position', async () => {
  const p = plugin('prompt')
  await captureCapacitorGcj02(p.adapter)
  assert.equal(p.calls[1][0], 'permission')
  for (const state of ['denied', 'unavailable']) {
    const denied = plugin(state)
    await assert.rejects(captureCapacitorGcj02(denied.adapter), /定位权限未开启/)
    assert.deepEqual(denied.calls, ['check'])
  }
  const rejected = plugin('prompt')
  rejected.adapter.requestPermissions = async () => ({
    location: 'denied',
    coarseLocation: 'denied'
  })
  await assert.rejects(captureCapacitorGcj02(rejected.adapter), /定位权限未开启/)
  assert.equal(
    rejected.calls.some((c) => Array.isArray(c) && c[0] === 'position'),
    false
  )
})
test('approximate-only native permission is useful for browsing, never silently upgraded to precise', async () => {
  const p = plugin('denied', 'granted')
  p.adapter.getCurrentPosition = async (options: any) => {
    p.calls.push(['position', options])
    return { coords: { longitude: 120, latitude: 31, accuracy: 2500 } }
  }
  const result = await captureCapacitorGcj02(p.adapter)
  assert.equal(result.accuracyM, 2500)
  assert.equal(p.calls[1][1].enableHighAccuracy, false)
  assert.equal(
    p.calls.some((c) => Array.isArray(c) && c[0] === 'permission'),
    false
  )
})
test('invalid native positions and provider failures cannot become a successful location', async () => {
  for (const coords of [
    { longitude: NaN, latitude: 31, accuracy: 2 },
    { longitude: 181, latitude: 31, accuracy: 2 },
    { longitude: 120, latitude: -91, accuracy: 2 },
    { longitude: 120, latitude: 31, accuracy: -2 }
  ]) {
    const p = plugin()
    p.adapter.getCurrentPosition = async () => ({ coords })
    await assert.rejects(captureCapacitorGcj02(p.adapter), /暂时无法获取位置/)
  }
  const p = plugin()
  p.adapter.getCurrentPosition = async () => {
    throw new Error('provider fixture failure')
  }
  await assert.rejects(captureCapacitorGcj02(p.adapter), /provider fixture failure/)
})
