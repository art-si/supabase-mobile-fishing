import {
  createRememberedLogin,
  type LoginSecret,
  type PasswordStore
} from '@mobile-core/remembered-login'
import {
  createBrowserPasswordStore,
  type BrowserPasswordEnvironment
} from '@mobile-core/browser-passwords'
import { nativeCredentialsAvailable, nativeLoginPassword } from './native-credentials'
import { normalizeLoginIdentifier } from '@/domain/account-security'
import { sessionNotice } from './session'

const key = 'dyj.login.preference.v1'
const methodKey = 'dyj.login.password-first.v1'
let environment: BrowserPasswordEnvironment | undefined
// #ifdef H5
environment = {
  secure: window.isSecureContext,
  PasswordCredential: (window as unknown as BrowserPasswordEnvironment).PasswordCredential,
  credentials: navigator.credentials as unknown as BrowserPasswordEnvironment['credentials']
}
// #endif
const browserPasswords = createBrowserPasswordStore(environment)
const passwords: PasswordStore = {
  available: () => nativeCredentialsAvailable() || browserPasswords.available(),
  async read() {
    if (!nativeCredentialsAvailable()) return browserPasswords.read()
    const value = await nativeLoginPassword.read()
    if (!value || value.length > 4096) return null
    return JSON.parse(value)
  },
  async write(value) {
    if (!nativeCredentialsAvailable()) return browserPasswords.write(value)
    await nativeLoginPassword.write(JSON.stringify(value))
    return true
  },
  async remove() {
    if (nativeCredentialsAvailable()) await nativeLoginPassword.remove()
    else await browserPasswords.remove()
  }
}
export const rememberedLogin = createRememberedLogin({
  preferences: {
    read: () => uni.getStorageSync(key),
    write: (value) => uni.setStorageSync(key, value),
    remove: () => uni.removeStorageSync(key)
  },
  passwords,
  normalizeIdentifier: normalizeLoginIdentifier
})
export const rememberLoginLabel = () =>
  rememberedLogin.canSavePassword() ? '记住密码' : '记住账号'
// This records the login method only. Opting out still removes the saved identity and secret.
export function prefersPasswordLogin() {
  try {
    return uni.getStorageSync(methodKey) === true
  } catch {
    return false
  }
}
export function preferPasswordLogin() {
  uni.setStorageSync(methodKey, true)
}
export async function saveLoginMemory(
  login: LoginSecret & { owner: string },
  remember: boolean,
  isCurrent: () => boolean
) {
  if (!isCurrent()) return
  try {
    preferPasswordLogin()
    if (remember) {
      const saved = await rememberedLogin.save(login, isCurrent)
      if (isCurrent() && saved.saved && !saved.passwordSaved && rememberedLogin.canSavePassword())
        sessionNotice.value = '已记住账号；密码可通过系统密码管理器保存和填充。'
    } else await rememberedLogin.forget()
  } catch {
    if (isCurrent()) sessionNotice.value = '本次已登录，设备未能记住登录信息。'
  }
}
export function displayLoginIdentifier(value: string) {
  return value.startsWith('+86') ? value.slice(3) : value
}
