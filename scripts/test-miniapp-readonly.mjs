// Actual WeChat simulator transport + hosted read-only APIs. No login fixture,
// SMS, media upload, business write, or claim of physical-device validation.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadEnv } from 'vite'
import { confirmedAppId, confirmedProjectUrl } from './miniapp-release-config.mjs'

const root = resolve(import.meta.dirname, '..')
const env = loadEnv('production', root, 'VITE_')
assert.equal(env.VITE_SUPABASE_URL, confirmedProjectUrl)
assert.ok(env.VITE_SUPABASE_KEY?.startsWith('sb_publishable_'))
const config = JSON.parse(await readFile(resolve(root, 'dist/build/mp-weixin/project.config.json'), 'utf8'))
assert.equal(config.appid, confirmedAppId)
assert.equal(config.setting.urlCheck, true)
const require = createRequire(resolve(root, 'artifacts/miniapp-tools/package.json'))
const automator = require('miniprogram-automator')
const client = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9422' })
const results = []
const output = resolve(root, 'artifacts/weixin-resume-20261123')
await mkdir(output, { recursive: true })
try {
  assert.equal(await client.evaluate(() => wx.getAccountInfoSync().miniProgram.appId), confirmedAppId)
  for (const probe of [
    { name: 'public feed', path: '/rest/v1/rpc/fishing_read', body: { action: 'feed', payload: {} }, statuses: [200] },
    { name: 'public spots', path: '/rest/v1/rpc/fishing_read', body: { action: 'spots', payload: {} }, statuses: [200] },
    { name: 'private materials deny anonymous users', path: '/rest/v1/rpc/fishing_read', body: { action: 'water_reports', payload: {} }, statuses: [400, 401, 403] },
    { name: 'map function requires authentication', path: '/functions/v1/amap', body: {}, statuses: [401] }
  ]) {
    const result = await client.evaluate(({ url, key, body }) => new Promise(resolve => {
      wx.request({ url, method: 'POST', data: body, timeout: 20000,
        header: { apikey: key, 'Content-Type': 'application/json' },
        success: response => resolve({ status: response.statusCode, hasItems: Array.isArray(response.data?.items) }),
        fail: error => resolve({ status: 0, error: String(error.errMsg || 'request failed') }) })
    }), { url: confirmedProjectUrl + probe.path, key: env.VITE_SUPABASE_KEY, body: probe.body })
    const passed = probe.statuses.includes(result.status) && (probe.statuses[0] !== 200 || result.hasItems)
    results.push({ name: probe.name, passed, ...result })
    console.log(`${passed ? 'PASS' : 'FAIL'} ${probe.name}: HTTP ${result.status}${result.error ? ' ' + result.error : ''}`)
  }
} finally {
  await writeFile(resolve(output, 'miniapp-transport.json'), JSON.stringify({
    checkedAt: new Date().toISOString(), appId: confirmedAppId, environment: 'WeChat DevTools simulator',
    scope: 'real hosted APIs via wx.request; no business writes or physical GPS', results
  }, null, 2) + '\n')
  await client.disconnect()
}
if (results.length !== 4 || results.some(result => !result.passed)) process.exitCode = 1
