import { loadEnv } from 'vite'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditMiniapp, readBuildFiles } from './miniapp-package.mjs'
import {
  confirmedAppId,
  confirmedProjectUrl,
  miniappConfigIssues,
  miniappReleaseGates
} from './miniapp-release-config.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const env = loadEnv('production', root, 'VITE_')
const failures = []
let packageAudit
try {
  const files = readBuildFiles(resolve(root, 'dist/build/mp-weixin'))
  const manifest = JSON.parse(readFileSync(resolve(root, 'src/manifest.json'), 'utf8'))
  packageAudit = auditMiniapp(
    files,
    JSON.parse(readFileSync(resolve(root, 'src/pages.json'), 'utf8'))
  )
  failures.push(...packageAudit.issues)
  failures.push(
    ...miniappConfigIssues({
      env,
      manifest,
      project: JSON.parse(files.get('project.config.json').toString()),
      app: JSON.parse(files.get('app.json').toString()),
      compiledConfig:
        [...files]
          .filter(([path]) => path.endsWith('.js'))
          .map(([, bytes]) => bytes.toString())
          .find((code) => /\bsupabaseUrl\s*:/.test(code) && /\bphoneAuth\s*:/.test(code)) || ''
    })
  )
  const privateProject = files.get('project.private.config.json')
  if (privateProject && JSON.parse(privateProject.toString()).setting?.urlCheck === false)
    failures.push('本地微信项目设置关闭了合法域名校验')
  const localEnv = loadEnv('production', root, '')
  const secrets = [
    'AMAP_SECURITY_JS_CODE',
    'AMAP_WEB_SERVICE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'WECHAT_APP_SECRET'
  ]
    .map((name) => localEnv[name])
    .filter((value) => value && value.length >= 16)
  for (const [path, bytes] of files) {
    if (!/\.(?:js|json|wxml|wxss)$/.test(path)) continue
    const text = bytes.toString()
    if (secrets.some((secret) => text.includes(secret)) || /sb_secret_[A-Za-z\d_-]{12,}/.test(text))
      failures.push(`微信产物包含服务端凭据：${path}`)
    for (const match of text.matchAll(/eyJ[A-Za-z\d_-]+\.[A-Za-z\d_-]+\.[A-Za-z\d_-]+/g)) {
      try {
        if (
          JSON.parse(Buffer.from(match[0].split('.')[1], 'base64url').toString()).role ===
          'service_role'
        )
          failures.push(`微信产物包含特权 JWT：${path}`)
      } catch {
        /* Ordinary text is not a JWT. */
      }
    }
    if (path.endsWith('.wxml') && /<web-view(?:\s|>)/.test(text))
      failures.push(`个人主体微信包包含 web-view：${path}`)
  }
} catch {
  failures.push('正式微信产物不完整，请先运行 pnpm build:mp-weixin')
}
const pending = Object.entries(miniappReleaseGates).filter(([name]) => process.env[name] !== '1')
const domain = new URL(confirmedProjectUrl).host
const report = {
  checkedAt: new Date().toISOString(),
  target: 'mp-weixin',
  appId: confirmedAppId,
  project: 'jupuypvmgjpnpntfetqv',
  localChecksPassed: failures.length === 0,
  readyToSubmit: failures.length === 0 && pending.length === 0,
  failures: [...new Set(failures)],
  pending: pending.map(([name, description]) => ({ name, description })),
  package: packageAudit
    ? {
        sha256: packageAudit.sha256,
        pages: packageAudit.routes,
        files: packageAudit.files,
        rawMainBytes: packageAudit.packages.__APP__,
        rawTotalBytes: packageAudit.totalBytes
      }
    : null,
  domainPreparation: {
    request: [`https://${domain}`],
    uploadFile: [`https://${domain}`],
    downloadFile: [`https://${domain}`],
    socket: [`wss://${domain}`]
  },
  limits:
    '本地原始文件检查不是微信上传包分析；域名列表是填写候选，未证明微信后台允许或已保存。人工标志必须有对应证据。'
}
const output = resolve(root, 'artifacts/release-20261123')
mkdirSync(output, { recursive: true })
writeFileSync(resolve(output, 'weixin-preflight.json'), JSON.stringify(report, null, 2) + '\n')
console.log(
  `微信本地配置检查：${report.localChecksPassed ? '通过' : '失败'}；正式提审条件：${report.readyToSubmit ? '已核对' : '尚未齐备'}`
)
for (const failure of report.failures) console.log(`FAIL ${failure}`)
for (const [, description] of pending) console.log(`PENDING ${description}`)
console.log('报告：artifacts/release-20261123/weixin-preflight.json（不含密钥、令牌或用户内容）')
if (!report.readyToSubmit) process.exitCode = 1
