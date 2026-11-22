import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { errorText, normalizePhone, optionalNumber, validCoordinates } from '../src/domain/rules'
import * as userErrors from '../src/domain/user-errors'
import * as weatherDomain from '../src/domain/weather'
import * as waterPlaces from '../supabase/functions/_shared/water-places'
import { authErrorMessage } from '../src/domain/auth-errors'

test('global error copy rejects arbitrary vendor, configuration and storage diagnostics', () => {
  for (const error of [
    new Error('Supabase project is unavailable: service_role=fixture-secret'),
    new TypeError('Cannot read properties of undefined (reading apiKey)'),
    new Error('SQL 执行失败：数据库连接 https://private.invalid/?token=fixture'),
    new Error('请配置高德 JS Key 和 HTTPS 安全代理'),
    new Error('地图未能加载，请检查网络后重试 secret=fixture'),
    { message: 'AMap INVALID_USER_KEY', code: 'UNRECOGNIZED' },
    { message: 'storage full' },
    '已取消登录',
    null,
    undefined
  ]) {
    assert.equal(errorText(error), userErrors.unknownErrorMessage)
  }
  assert.equal(userErrors.serviceErrorMessage('__proto__'), undefined)
  assert.equal(userErrors.serviceErrorMessage('constructor'), undefined)
})

test('local validation and business recovery messages survive the safe boundary', () => {
  for (const validate of [() => normalizePhone('123'), () => optionalNumber('-1', 10000)]) {
    assert.throws(validate, (error: unknown) => {
      assert.notEqual(errorText(error), userErrors.unknownErrorMessage)
      return true
    })
  }
  for (const message of [
    '请填写昵称',
    '请输入 6 位短信验证码',
    '有照片尚未上传，请重试或移除后保存',
    '请先登录，原账号草稿会保留',
    '这条记录已有新版本，你的修改已保留',
    '本机体验不提供审核权限',
    '体验模式没有线上账号，不执行账号注销。可以退出体验。'
  ])
    assert.equal(errorText(new Error(message)), message)
  assert.equal(
    errorText(new Error('请填写 0–10000 secret 之间的数字')),
    userErrors.unknownErrorMessage
  )
  for (const code of [
    'EDIT_CONFLICT',
    'EDIT_REQUEST_REUSED',
    'SESSION_CHANGED',
    'NOT_AUTHENTICATED'
  ]) {
    const error = Object.assign(new Error('private upstream detail'), { code, status: 409 })
    assert.equal(errorText(error), userErrors.serviceErrorMessage(code))
    assert.equal(error.code, code)
    assert.equal(error.status, 409)
    assert.equal(error.message, 'private upstream detail')
  }
})

test('every auth response copy remains user-readable without upstream text', () => {
  for (const code of [
    'otp_expired',
    'invalid_credentials',
    'validation_failed',
    'over_sms_send_rate_limit',
    'over_request_rate_limit',
    'rate_limit_exceeded',
    'captcha_failed',
    'phone_provider_disabled',
    'otp_disabled',
    'signup_disabled',
    'sms_send_failed',
    'user_banned',
    'unknown'
  ]) {
    for (const status of [400, 401, 429, 503]) {
      const message = authErrorMessage(code, status)
      assert.equal(errorText(Object.assign(new Error(message), { code, status })), message)
    }
  }
  assert.equal(
    errorText({ status: 401, message: 'JWT expired fixture' }),
    '登录状态已失效，请重新登录'
  )
  assert.equal(
    errorText({ status: 429, message: 'quota exceeded fixture' }),
    '操作过于频繁，请稍后再试'
  )
})

// Run the real map modules with in-memory boundaries; no SDK, HTTP request or real data.
function moduleHarness(file: string, dependencies: Record<string, unknown>, globals = {}) {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
  const exports: Record<string, any> = {}
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    {
      exports,
      Error,
      URL,
      setTimeout,
      clearTimeout,
      require(name: string) {
        assert.ok(name in dependencies, name)
        return dependencies[name]
      },
      ...globals
    }
  )
  return exports
}

function browserMap(
  options: {
    isDemo?: boolean
    key?: string
    proxy?: string
    window?: object
    document?: object
  } = {}
) {
  return moduleHarness(
    'platforms/amap.ts',
    {
      '@/config': {
        isDemo: !!options.isDemo,
        config: {
          amapKey: options.key ?? 'public-fixture',
          amapServiceHost: options.proxy ?? 'https://map.invalid/_AMapService'
        }
      },
      '@/domain/user-errors': userErrors,
      '@/domain/weather': weatherDomain,
      '../../supabase/functions/_shared/water-places': waterPlaces,
      '@/domain/rules': { validCoordinates },
      '@capacitor/core': { Capacitor: { isNativePlatform: () => false } },
      '@mobile-core/location': {}
    },
    {
      window: {
        location: { href: 'https://app.invalid/', origin: 'https://app.invalid' },
        ...options.window
      },
      document: options.document
    }
  )
}

test('browser map configuration failures offer a fallback, not developer instructions', async () => {
  for (const options of [
    { key: '' },
    { proxy: '' },
    { proxy: 'http://private.invalid/_AMapService' },
    { proxy: 'https://map.invalid/functions/v1/amap-js/_AMapService' },
    { proxy: 'https://map.invalid/wrong' }
  ]) {
    const map = browserMap(options)
    await assert.rejects(map.loadAmap(), (error: unknown) => {
      assert.equal(errorText(error), userErrors.serviceErrorMessage('MAP_NOT_CONFIGURED'))
      assert.doesNotMatch(errorText(error), /Key|HTTPS|配置|代理|Supabase/i)
      return true
    })
  }
  await assert.rejects(browserMap({ isDemo: true }).loadAmap(), (error: unknown) => {
    assert.match(errorText(error), /体验模式不提供真实地点搜索和地图预览/)
    return true
  })
})

test('browser map load and location failures remain actionable and never become success', async () => {
  let removed = false
  const map = browserMap({
    document: {
      createElement: () => ({
        remove() {
          removed = true
        }
      }),
      head: { append: (script: { onerror: () => void }) => script.onerror() }
    }
  })
  await assert.rejects(map.loadAmap(), (error: unknown) => {
    assert.equal(errorText(error), userErrors.serviceErrorMessage('MAP_LOAD_FAILED'))
    return true
  })
  assert.equal(removed, true)
  const insecureMap = browserMap({ window: { AMap: {}, isSecureContext: false } })
  await assert.rejects(insecureMap.locate(), (error: unknown) => {
    assert.equal(errorText(error), '局域网 HTTP 无法获取当前位置。请使用 HTTPS，或搜索地点。')
    return true
  })
  const sdkMap = browserMap({
    window: {
      AMap: {
        PlaceSearch: class {
          constructor() {
            throw new Error('AMap SDK private Key=fixture')
          }
        }
      }
    }
  })
  await assert.rejects(sdkMap.searchPlaces('河'), (error: unknown) => {
    assert.equal(errorText(error), userErrors.unknownErrorMessage)
    return true
  })
})

test('static map demo never reaches the real service and invalid images reject safely', async () => {
  let requests = 0
  class ApiError extends Error {
    constructor(
      message: string,
      public status: number,
      public code: string
    ) {
      super(message)
    }
  }
  const dependencies = {
    './http': { ApiError },
    './session': {
      sessionRequest: async () => {
        requests++
        return { image: 'private diagnostic' }
      }
    },
    '@/domain/user-errors': userErrors
  }
  const demo = moduleHarness('services/amap.ts', { ...dependencies, '@/config': { isDemo: true } })
  await assert.rejects(demo.searchMapPlaces('河', ''), { code: 'MAP_DEMO_UNAVAILABLE' })
  assert.equal(requests, 0)
  const live = moduleHarness('services/amap.ts', { ...dependencies, '@/config': { isDemo: false } })
  await assert.rejects(live.getStaticPreview({ kind: 'spot', id: 'fixture' }, 12), (error: any) => {
    assert.equal(error.code, 'MAP_RESPONSE_INVALID')
    assert.equal(errorText(error), '地图预览未能加载，请重试')
    return true
  })
  assert.equal(requests, 1)
})
