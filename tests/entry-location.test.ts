import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Exercise the actual mini-program adapter without calling WeChat or using GPS.
function nativeSource(source: string) {
  const enabled = [true]
  return source
    .split('\n')
    .filter((line) => {
      const directive = line.match(/^\s*\/\/ #(ifdef|ifndef|endif)(?:\s+(\S+))?/)
      if (!directive) return enabled.at(-1)
      if (directive[1] === 'endif') enabled.pop()
      else
        enabled.push(
          Boolean(enabled.at(-1)) &&
            (directive[1] === 'ifdef' ? directive[2] === 'MP-WEIXIN' : directive[2] !== 'MP-WEIXIN')
        )
      return false
    })
    .join('\n')
}

function harness(result: string | { longitude: number; latitude: number }, platform?: string) {
  const exports: Record<string, any> = {}
  const source = nativeSource(
    readFileSync(new URL('../src/platforms/entry-location.ts', import.meta.url), 'utf8')
  )
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  runInNewContext(compiled, {
    exports,
    setTimeout,
    clearTimeout,
    wx: {
      getDeviceInfo: () => ({ platform }),
      getFuzzyLocation(options: {
        success: (value: object) => void
        fail: (value: object) => void
      }) {
        if (typeof result === 'string') options.fail({ errMsg: result })
        else options.success(result)
      }
    }
  })
  return exports.captureEntryLocation as () => Promise<{
    longitude: number
    latitude: number
    crs: string
    coarse: boolean
  }>
}

test('WeChat account entitlement and undeclared APIs are not mistaken for a device location failure', async () => {
  for (const detail of [
    'getFuzzyLocation:fail no permission, appId=wx9f631f76bb1543e0',
    'getFuzzyLocation:fail permission is not open',
    'getFuzzyLocation:fail api scope is not declared',
    'getFuzzyLocation:fail requiredPrivateInfos is missing'
  ])
    await assert.rejects(harness(detail)(), { message: 'LOCATION_NOT_ENABLED' })
})

test('WeChat user denial retains the separate permission recovery path', async () => {
  for (const detail of [
    'getFuzzyLocation:fail auth deny',
    'getFuzzyLocation:fail scope.userFuzzyLocation denied'
  ])
    await assert.rejects(harness(detail)(), { message: 'LOCATION_DENIED' })
  await assert.rejects(harness('getFuzzyLocation:fail location service unavailable')(), {
    message: 'LOCATION_UNAVAILABLE'
  })
})

test('WeChat successful coordinates keep their platform coordinate system and coarse precision', async () => {
  const result = await harness({ longitude: 114.3, latitude: 30.5 })()
  assert.deepEqual({ ...result }, { longitude: 114.3, latitude: 30.5, crs: 'GCJ-02', coarse: true })
})

test('a simulator permission failure is reported separately without bypassing real-device location', async () => {
  const message = 'getFuzzyLocation:fail no permission, appId=wx9f631f76bb1543e0'
  await assert.rejects(harness(message, 'devtools')(), { message: 'LOCATION_DEVTOOLS_UNAVAILABLE' })
  await assert.rejects(harness(message, 'android')(), { message: 'LOCATION_NOT_ENABLED' })
  await assert.rejects(harness('getFuzzyLocation:fail requiredPrivateInfos is missing', 'devtools')(), { message: 'LOCATION_NOT_ENABLED' })
})
