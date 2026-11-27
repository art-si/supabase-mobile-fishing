export const confirmedAppId = 'wx9f631f76bb1543e0'
export const confirmedProjectUrl = 'https://jupuypvmgjpnpntfetqv.supabase.co'

// These are distinct attestations. A simulator, contract test, or successful build
// cannot establish any of them; this script never sets them on the user's behalf.
export const miniappReleaseGates = {
  FISHING_BACKEND_VERIFIED: '当前目标项目的真实业务、存储权限与清理已验收',
  FISHING_LEGAL_APPROVED: '运营者已核对隐私文本、保存期限与境外数据处理',
  FISHING_AUTH_BRIDGES_VERIFIED: '当前项目的真实短信收码、登录与账号恢复已验收',
  FISHING_DEVICE_TESTED: 'iOS、Android 手机微信的全部关键流程已验收',
  FISHING_PERSONAL_MINIAPP_VERIFIED: '个人主体的全部实际功能与可用能力已核对',
  FISHING_WECHAT_FILING_VERIFIED: '小程序备案及所需主体认证已完成',
  FISHING_WECHAT_CATEGORY_VERIFIED: '当前主体的类目覆盖发帖、评论及钓位分享等实际服务',
  FISHING_WECHAT_DOMAINS_VERIFIED: '正式合法域名已保存并在开启域名校验时验收',
  FISHING_WECHAT_PRIVACY_VERIFIED: '微信隐私保护指引与实际接口、收集用途一致',
  FISHING_WECHAT_LOCATION_VERIFIED: '当前 AppID 的 getFuzzyLocation 已开通并在真机验证'
}

export function isLiveConfig(code) {
  if (/\bisDemo\b|dyj\.demo\.|\bmode\s*:\s*["']demo["']/.test(code)) return false
  const literal = code.match(/\bsupabaseUrl\s*:\s*(["'])([^"']+)\1\s*(?=[,}])/)
  if (literal) return literal[2] === confirmedProjectUrl
  const normalized = code.match(/\bsupabaseUrl\s*:\s*\(\s*(["'])([^"']*)\1\s*\|\|\s*(["'])([^"']+)\3\s*\)\.replace\(\/\\\/\$\/\s*,\s*(["'])\5\)\s*(?=[,}])/)
  return !!normalized && normalized[4] === confirmedProjectUrl && (normalized[2] || normalized[4]).replace(/\/$/, '') === confirmedProjectUrl
}

export function miniappConfigIssues({ env, manifest, project, app, compiledConfig }) {
  const issues = []
  if (!isLiveConfig(compiledConfig))
    issues.push('正式微信产物必须使用 live 数据配置')
  if (
    (env.VITE_SUPABASE_URL || confirmedProjectUrl).replace(/\/$/, '') !== confirmedProjectUrl ||
    !compiledConfig.includes(confirmedProjectUrl)
  )
    issues.push('源码环境与正式微信产物必须指向已确认的 fishing 项目')
  const key = env.VITE_SUPABASE_KEY || ''
  if (
    !key.startsWith('sb_publishable_') ||
    /fixture|contract|test_only/i.test(key) ||
    !compiledConfig.includes(key)
  )
    issues.push('正式微信产物缺少当前环境的公开项目密钥，或混入测试配置')
  if (
    env.VITE_AMAP_SECURITY_JS_CODE ||
    env.VITE_AMAP_WEB_SERVICE_KEY ||
    env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    env.VITE_WECHAT_APP_SECRET
  )
    issues.push('服务端凭据不得使用 VITE_* 客户端变量')
  if (manifest['mp-weixin']?.appid !== confirmedAppId || project.appid !== confirmedAppId)
    issues.push('源码及微信产物的 AppID 必须与已确认账号一致')
  if (manifest['mp-weixin']?.setting?.urlCheck !== true || project.setting?.urlCheck !== true)
    issues.push('正式微信包必须开启合法域名校验')
  if (
    !app.requiredPrivateInfos?.includes('getFuzzyLocation') ||
    !app.permission?.['scope.userFuzzyLocation']?.desc
  )
    issues.push('正式微信包缺少大致位置接口及用途声明')
  if (env.VITE_PHONE_AUTH_ENABLED !== 'true') issues.push('个人主体短信登录开关未启用')
  // The personal mini-program uses the authenticated amap Edge Function. JS SDK
  // keys and /_AMapService belong to H5 and are intentionally not gates here.
  return issues
}
