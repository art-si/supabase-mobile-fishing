import { config, backendReady } from '@/config'
import { authSessionFromResponse } from '@/domain/auth-errors'
import {
  isPhoneLoginCancelled,
  operatorCapabilityFromCheck,
  operatorEntryCapability,
  validPhoneProof,
  wechatPhoneCapability,
  type PhoneLoginCapability,
  type PhoneLoginPlatform
} from '@/domain/phone-login-capability'
import { request, ApiError } from './http'
import { saveSession, sessionScope, sessionNotice, assertSession } from './session'
// #ifdef H5
import { Capacitor, registerPlugin } from '@capacitor/core'
interface OperatorPhone {
  // A future native adapter must initialize/check its vendor SDK only inside this method.
  checkAvailability(): Promise<{ available: boolean }>
  authorize(): Promise<{ token: string; cancelled?: boolean }>
}
const operator = registerPlugin<OperatorPhone>('FishingPhoneAuth')
// #endif

export interface PhoneLoginOptions {
  consent?: boolean
  isActive?: () => boolean
}

function platform(): PhoneLoginPlatform {
  // #ifdef MP-WEIXIN
  return 'wechat'
  // #endif
  // #ifdef H5
  if (Capacitor.isNativePlatform()) {
    const name = Capacitor.getPlatform()
    return name === 'android' ? 'android' : name === 'ios' ? 'ios' : 'other'
  }
  return 'web'
  // #endif
  // #ifndef H5
  // #ifndef MP-WEIXIN
  return 'other'
  // #endif
  // #endif
}

function operatorEntry() {
  let pluginAvailable = false
  // #ifdef H5
  pluginAvailable = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('FishingPhoneAuth')
  // #endif
  return operatorEntryCapability({
    backendReady,
    enabled: config.operatorPhone,
    platform: platform(),
    pluginAvailable
  })
}

export function operatorEntryAvailable() {
  return operatorEntry().code === 'PHONE_AUTH_CHECK_REQUIRED'
}

export function wechatPhoneAvailable() {
  return wechatPhoneCapability({
    backendReady,
    enabled: config.wechatPhone,
    platform: platform(),
    subject: config.miniProgramSubject
  }).available
}

let operatorChecked = false
let checkGeneration = 0
let authorizing = false

// Kept for existing callers. A registered JS/native plugin alone never returns true.
export function operatorAvailable() {
  return operatorChecked && operatorEntryAvailable()
}

function assertFlow(scope: number, options: PhoneLoginOptions) {
  assertSession(scope)
  if (options.isActive && !options.isActive()) throw new ApiError('已取消登录', 0, 'AUTH_CANCELLED')
}

function assertConsent(options: PhoneLoginOptions) {
  if (options.consent !== true)
    throw new ApiError('请先阅读并同意用户协议和隐私政策', 0, 'CONSENT_REQUIRED')
}

function safeLoginError(error: unknown) {
  if (isPhoneLoginCancelled(error)) return new ApiError('已取消登录', 0, 'AUTH_CANCELLED')
  if (error instanceof ApiError) return error
  return new ApiError('本机号码登录暂时不可用，请使用短信登录', 0, 'PHONE_AUTH_UNAVAILABLE')
}

export async function checkOperatorAvailability(
  options: PhoneLoginOptions = {}
): Promise<PhoneLoginCapability> {
  const generation = ++checkGeneration
  operatorChecked = false
  const scope = sessionScope.value
  assertFlow(scope, options)
  assertConsent(options)
  const entry = operatorEntry()
  if (entry.code !== 'PHONE_AUTH_CHECK_REQUIRED') return entry
  // #ifdef H5
  try {
    const result = await operator.checkAvailability().finally(() => assertFlow(scope, options))
    const capability = operatorCapabilityFromCheck(result)
    if (generation === checkGeneration) operatorChecked = capability.available
    return capability
  } catch (error) {
    assertFlow(scope, options)
    if (isPhoneLoginCancelled(error)) throw safeLoginError(error)
    return operatorCapabilityFromCheck(null)
  }
  // #endif
  // #ifndef H5
  return operatorCapabilityFromCheck(null)
  // #endif
}

async function exchangeProof(data: unknown, scope: number, options: PhoneLoginOptions) {
  assertFlow(scope, options)
  const response = await request<unknown>('/functions/v1/phone-login', {
    method: 'POST',
    data
  }).finally(() => assertFlow(scope, options))
  const nextSession = authSessionFromResponse(response)
  if (!nextSession)
    throw new ApiError('登录服务暂时不可用，请稍后重试', 502, 'AUTH_RESPONSE_INVALID')
  assertFlow(scope, options)
  sessionNotice.value = ''
  await saveSession(nextSession)
}

async function loginFlow(options: PhoneLoginOptions, action: (scope: number) => Promise<void>) {
  assertConsent(options)
  if (authorizing) throw new ApiError('登录正在进行，请稍候', 0, 'AUTH_IN_PROGRESS')
  const scope = sessionScope.value
  assertFlow(scope, options)
  authorizing = true
  try {
    await action(scope)
  } catch (error) {
    assertFlow(scope, options)
    throw safeLoginError(error)
  } finally {
    authorizing = false
    operatorChecked = false
  }
}

export async function wechatPhoneLogin(phoneCode: string, options: PhoneLoginOptions = {}) {
  return loginFlow(options, async (scope) => {
    if (!wechatPhoneAvailable())
      throw new ApiError('微信手机号登录暂时不可用，请使用短信登录', 0, 'PHONE_AUTH_UNAVAILABLE')
    if (!validPhoneProof(phoneCode)) throw new ApiError('已取消登录', 0, 'AUTH_CANCELLED')
    const login = await new Promise<UniApp.LoginRes>((resolve, reject) =>
      uni.login({ provider: 'weixin', success: resolve, fail: reject })
    ).finally(() => assertFlow(scope, options))
    if (!validPhoneProof(login?.code))
      throw new ApiError('微信登录暂时不可用，请重试', 0, 'PHONE_AUTH_PROOF_INVALID')
    await exchangeProof(
      { provider: 'wechat', phone_code: phoneCode, login_code: login.code },
      scope,
      options
    )
  })
}

export async function operatorPhoneLogin(options: PhoneLoginOptions = {}) {
  return loginFlow(options, async (scope) => {
    const capability = await checkOperatorAvailability(options)
    assertFlow(scope, options)
    if (!capability.available) throw new ApiError(capability.message, 0, capability.code)
    // #ifdef H5
    const proof = await operator.authorize().finally(() => assertFlow(scope, options))
    if (isPhoneLoginCancelled(proof)) throw new ApiError('已取消登录', 0, 'AUTH_CANCELLED')
    if (!validPhoneProof(proof?.token))
      throw new ApiError('本机号码登录未完成，请重试或使用短信登录', 0, 'PHONE_AUTH_PROOF_INVALID')
    await exchangeProof({ provider: 'operator', token: proof.token }, scope, options)
    // #endif
  })
}
