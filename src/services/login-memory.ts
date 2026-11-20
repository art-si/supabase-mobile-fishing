import { createRememberedLogin, type PasswordStore } from '@mobile-core/remembered-login'
import {
  createBrowserPasswordStore,
  type BrowserPasswordEnvironment
} from '@mobile-core/browser-passwords'
import { nativeCredentialsAvailable, nativeLoginPassword } from './native-credentials'
import { normalizeLoginIdentifier } from '@/domain/account-security'

const key = 'dyj.login.preference.v1'
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
export function displayLoginIdentifier(value: string) {
  return value.startsWith('+86') ? value.slice(3) : value
}
