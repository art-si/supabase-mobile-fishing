export type PhoneLoginPlatform = 'wechat' | 'android' | 'ios' | 'web' | 'other'

export interface PhoneLoginCapability {
  available: boolean
  code: string
  message: string
}

interface PhoneLoginEnvironment {
  backendReady: boolean
  enabled: boolean
  platform: PhoneLoginPlatform
}

const unavailable = (code: string, message = '本机号码登录暂时不可用，请使用短信登录') => ({
  available: false,
  code,
  message
})

function commonCapability(environment: PhoneLoginEnvironment) {
  if (!environment.enabled || !environment.backendReady)
    return unavailable('PHONE_AUTH_UNAVAILABLE')
  return null
}

export function wechatPhoneCapability(
  environment: PhoneLoginEnvironment & { subject: string }
): PhoneLoginCapability {
  const blocked = commonCapability(environment)
  if (blocked) return blocked
  if (environment.platform !== 'wechat') return unavailable('PHONE_AUTH_UNSUPPORTED_PLATFORM')
  if (environment.subject !== 'organization') return unavailable('WECHAT_PHONE_SUBJECT_UNSUPPORTED')
  return { available: true, code: 'READY', message: '' }
}

export function operatorEntryCapability(
  environment: PhoneLoginEnvironment & { pluginAvailable: boolean }
): PhoneLoginCapability {
  const blocked = commonCapability(environment)
  if (blocked) return blocked
  if (!['android', 'ios'].includes(environment.platform))
    return unavailable('PHONE_AUTH_UNSUPPORTED_PLATFORM')
  if (!environment.pluginAvailable) return unavailable('PHONE_AUTH_PLUGIN_MISSING')
  // Registration is only an entry gate, never evidence that the vendor SDK is ready.
  return unavailable('PHONE_AUTH_CHECK_REQUIRED', '同意协议后可检测本机号码登录是否可用')
}

export function operatorCapabilityFromCheck(value: unknown): PhoneLoginCapability {
  if (value && typeof value === 'object' && (value as { available?: unknown }).available === true)
    return { available: true, code: 'READY', message: '' }
  return unavailable('PHONE_AUTH_UNAVAILABLE')
}

export function isPhoneLoginCancelled(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: unknown; errMsg?: unknown; cancelled?: unknown }
  return (
    value.cancelled === true ||
    ['AUTH_CANCELLED', 'USER_CANCELLED', 'CANCELLED'].includes(String(value.code || '')) ||
    (typeof value.errMsg === 'string' &&
      /:fail\s+(cancel|auth deny|user deny)\b/i.test(value.errMsg))
  )
}

export function validPhoneProof(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 16384 && !/\s/.test(value)
}
