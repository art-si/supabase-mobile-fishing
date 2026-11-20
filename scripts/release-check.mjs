import { loadEnv } from 'vite'
import { readFileSync } from 'node:fs'
import { auditMiniapp, readBuildFiles } from './miniapp-package.mjs'
const env = loadEnv('production', process.cwd(), 'VITE_')
const manifest = JSON.parse(readFileSync('src/manifest.json', 'utf8'))
const failures = []
try {
  const packageAudit = auditMiniapp(
    readBuildFiles('dist/build/mp-weixin'),
    JSON.parse(readFileSync('src/pages.json', 'utf8'))
  )
  if (!packageAudit.passed)
    failures.push(...packageAudit.issues.map((issue) => `微信本地包体检查：${issue}`))
} catch {
  failures.push('微信本地包体检查未完成，请先运行 pnpm build:mp-weixin')
}
const projectUrl = (env.VITE_SUPABASE_URL || 'https://tlfmfokyhahlpzmpliad.supabase.co').replace(
  /\/$/,
  ''
)
if (projectUrl !== 'https://tlfmfokyhahlpzmpliad.supabase.co')
  failures.push('Supabase URL 不是已确认的目标项目')
if (env.VITE_DATA_MODE === 'demo') failures.push('生产构建不能使用 demo 数据')
for (const name of ['VITE_SUPABASE_KEY', 'VITE_AMAP_KEY', 'VITE_AMAP_SERVICE_HOST'])
  if (!env[name]) failures.push(`${name} 未配置`)
if (env.VITE_AMAP_SERVICE_HOST) {
  try {
    const proxy = new URL(env.VITE_AMAP_SERVICE_HOST)
    if (
      proxy.protocol !== 'https:' ||
      !proxy.pathname.endsWith('/_AMapService') ||
      proxy.search ||
      proxy.hash ||
      proxy.username ||
      proxy.password
    )
      throw new Error()
  } catch {
    failures.push('发行包需要绝对 HTTPS 高德代理；本机 /_AMapService 只用于开发／预览')
  }
}
if (env.VITE_AMAP_SECURITY_JS_CODE || env.VITE_AMAP_WEB_SERVICE_KEY)
  failures.push('高德安全码和 Web 服务 Key 不得配置为 VITE_* 客户端变量')
if (!manifest['mp-weixin'].appid) failures.push('微信 AppID 未配置')
if (env.VITE_PHONE_AUTH_ENABLED !== 'true') failures.push('短信登录尚未启用并验证')
// These human attestations cannot be inferred from a successful bundle build.
for (const name of [
  'FISHING_BACKEND_VERIFIED',
  'FISHING_LEGAL_APPROVED',
  'FISHING_DEVICE_TESTED',
  'FISHING_AUTH_BRIDGES_VERIFIED',
  'FISHING_PERSONAL_MINIAPP_VERIFIED'
])
  if (process.env[name] !== '1') failures.push(`${name} 验收尚未确认`)
if (failures.length) {
  console.error('尚不能发布：\n' + failures.map((x) => `- ${x}`).join('\n'))
  process.exitCode = 1
} else console.log('发行前配置门槛通过。仍需平台签名、审核和实际发布操作。')
