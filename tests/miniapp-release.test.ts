import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isLiveConfig,
  miniappConfigIssues,
  confirmedAppId,
  confirmedProjectUrl
} from '../scripts/miniapp-release-config.mjs'

function input() {
  const key = 'sb_publishable_example_for_unit_validation'
  return {
    env: {
      VITE_SUPABASE_URL: confirmedProjectUrl,
      VITE_SUPABASE_KEY: key,
      VITE_PHONE_AUTH_ENABLED: 'true'
    } as Record<string, string>,
    manifest: { 'mp-weixin': { appid: confirmedAppId, setting: { urlCheck: true } } },
    project: { appid: confirmedAppId, setting: { urlCheck: true } },
    app: {
      requiredPrivateInfos: ['getFuzzyLocation'],
      permission: { 'scope.userFuzzyLocation': { desc: '查找附近水域' } }
    },
    compiledConfig: `({supabaseUrl:"${confirmedProjectUrl}",key:"${key}"})`
  }
}

test('personal mini-program preflight does not require the H5 JS map proxy', () => {
  const value = input()
  assert.deepEqual(miniappConfigIssues(value), [])
  value.env.VITE_AMAP_SERVICE_HOST = '/_AMapService'
  assert.deepEqual(miniappConfigIssues(value), [])
})

test('the actual compiled normalized URL must still target only the confirmed project', () => {
  const bundle = (configured: string, fallback = confirmedProjectUrl) =>
    `({supabaseUrl:("${configured}"||"${fallback}").replace(/\\/$/,""),phoneAuth:true})`
  assert.ok(isLiveConfig(bundle(confirmedProjectUrl)))
  assert.ok(isLiveConfig(bundle(confirmedProjectUrl + '/')))
  assert.ok(!isLiveConfig(bundle('https://another.example')))
  assert.ok(!isLiveConfig(bundle(confirmedProjectUrl, 'https://another.example')))
  assert.ok(!isLiveConfig(bundle(confirmedProjectUrl).replace(',phoneAuth', '+other,phoneAuth')))
  assert.ok(!isLiveConfig(bundle(confirmedProjectUrl) + ';const isDemo=true'))
})

test('mini-program preflight rejects stale or demo bundles even if source env is correct', () => {
  const value = input()
  value.compiledConfig = value.compiledConfig.replace('supabaseUrl:', 'isDemo:true,supabaseUrl:')
  assert.ok(miniappConfigIssues(value).some((issue: string) => issue.includes('live')))
  const stale = input()
  stale.compiledConfig = stale.compiledConfig.replace(confirmedProjectUrl, 'https://other.example')
  assert.ok(miniappConfigIssues(stale).some((issue: string) => issue.includes('fishing')))
})

test('mini-program preflight rejects identity drift, test keys and disabled domain checking', () => {
  const identity = input()
  identity.project.appid = 'wx0000000000000000'
  assert.ok(miniappConfigIssues(identity).some((issue: string) => issue.includes('AppID')))
  const key = input()
  key.env.VITE_SUPABASE_KEY = 'sb_publishable_contract_fixture'
  assert.ok(miniappConfigIssues(key).some((issue: string) => issue.includes('测试配置')))
  const domain = input()
  domain.project.setting.urlCheck = false
  assert.ok(miniappConfigIssues(domain).some((issue: string) => issue.includes('域名')))
})

test('mini-program preflight requires location declarations and rejects client secrets', () => {
  const location = input()
  location.app.requiredPrivateInfos = []
  assert.ok(miniappConfigIssues(location).some((issue: string) => issue.includes('大致位置')))
  const secrets = input()
  secrets.env.VITE_WECHAT_APP_SECRET = 'sensitive-sentinel'
  assert.ok(miniappConfigIssues(secrets).some((issue: string) => issue.includes('服务端凭据')))
})
