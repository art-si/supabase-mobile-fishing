import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as mapLinkModule from '../src/_mobile-core/map-links'

// Compile the actual platform entry, following the conditional-compilation harness
// used by phone-login.test.ts. No browser, native SDK or clipboard is accessed.
function nativeSource(source: string) {
  const enabled = [true]
  return source.split('\n').filter((line) => {
    const directive = line.match(/^\s*\/\/ #(ifdef|ifndef|endif)(?:\s+(\S+))?/)
    if (!directive) return enabled.at(-1)
    if (directive[1] === 'endif') enabled.pop()
    else enabled.push(Boolean(enabled.at(-1)) && (directive[1] === 'ifdef' ? directive[2] === 'MP-WEIXIN' : directive[2] !== 'MP-WEIXIN'))
    return false
  }).join('\n')
}

interface ClipboardRequest {
  data: string
  showToast: boolean
  success: () => void
  fail: (error: unknown) => void
}

function harness() {
  const requests: ClipboardRequest[] = []
  const exports: Record<string, any> = {}
  const source = nativeSource(readFileSync(new URL('../src/platforms/open-place.ts', import.meta.url), 'utf8'))
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  runInNewContext(compiled, {
    exports,
    require(name: string) {
      assert.equal(name, '@mobile-core/map-links')
      return mapLinkModule
    },
    uni: { setClipboardData: (request: ClipboardRequest) => requests.push(request) }
  })
  return { requests, open: exports.openPlaceMap as (provider: mapLinkModule.MapProvider, place: mapLinkModule.MapLinkPlace) => Promise<'copied'> }
}

test('non-H5 map copy waits for clipboard success and copies real provider web URLs', async () => {
  for (const provider of ['amap', 'baidu'] as const) {
    const { requests, open } = harness()
    const place = { label: '湖畔 & 桥头 #1', longitude: 114.18, latitude: 30.48, approximate: false }
    let settled = false
    const result = open(provider, place)
    void result.then(() => { settled = true }, () => { settled = true })
    assert.equal(requests.length, 1)
    assert.equal(requests[0].data, mapLinkModule.mapLinks(provider, place).web)
    assert.equal(requests[0].showToast, false)
    const copied = new URL(requests[0].data)
    assert.equal(copied.protocol, 'https:')
    assert.equal(copied.pathname, '/marker')
    assert.equal(copied.searchParams.get(provider === 'amap' ? 'position' : 'location'), provider === 'amap' ? '114.18,30.48' : '30.48,114.18')
    assert.equal(copied.searchParams.get(provider === 'amap' ? 'name' : 'title'), place.label)
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(settled, false, 'must not show a copied result before the platform callback')
    requests[0].success()
    assert.equal(await result, 'copied')
  }
})

test('non-H5 clipboard denial rejects instead of claiming copied, including approximate places', async () => {
  const { requests, open } = harness()
  const place = { label: '水域附近', longitude: 114.18, latitude: 30.48, approximate: true }
  const result = open('amap', place)
  const error = { errMsg: 'setClipboardData:fail permission denied' }
  const rejected = assert.rejects(result, (reason) => reason === error)
  const copied = new URL(requests[0].data)
  assert.equal(copied.pathname, '/search')
  assert.equal(copied.searchParams.get('keyword'), place.label)
  assert.equal(copied.searchParams.has('position'), false)
  requests[0].fail(error)
  await rejected
})
