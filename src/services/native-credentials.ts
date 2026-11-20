import { createCredentialStore } from '@mobile-core/credential-store'
// #ifdef H5
import { Capacitor } from '@capacitor/core'
import { SecureStorage, KeychainAccess } from '@aparajita/capacitor-secure-storage'
// #endif

export function nativeCredentialsAvailable() {
  // #ifdef H5
  return Capacitor.isNativePlatform()
  // #endif
  // #ifndef H5
  return false
  // #endif
}

let prepared: Promise<void> | undefined
async function prepare() {
  // #ifdef H5
  if (!nativeCredentialsAvailable()) throw new Error('Native credential storage required')
  prepared ??= (async () => {
    await SecureStorage.setKeyPrefix('com.diaoyouji.fishing.auth.')
    await SecureStorage.setSynchronize(false)
    await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly)
    // Keychain survives iOS uninstall. A new installation starts signed out.
    if (uni.getStorageSync('dyj.auth.install.v1') !== true) {
      await SecureStorage.remove('session')
      await SecureStorage.remove('password-login')
      uni.setStorageSync('dyj.auth.install.v1', true)
    }
    uni.removeStorageSync('dyj.auth.v1')
  })().catch((error) => {
    prepared = undefined
    throw error
  })
  await prepared
  // #endif
}

export const nativeCredentials = createCredentialStore({
  async read() {
    await prepare()
    // #ifdef H5
    return SecureStorage.getItem('session')
    // #endif
    // #ifndef H5
    return null
    // #endif
  },
  async write(value) {
    await prepare()
    // #ifdef H5
    await SecureStorage.setItem('session', value)
    // #endif
  },
  async remove() {
    await prepare()
    // #ifdef H5
    await SecureStorage.remove('session')
    // #endif
  }
})

export const nativeLoginPassword = createCredentialStore({
  async read() {
    await prepare()
    // #ifdef H5
    return SecureStorage.getItem('password-login')
    // #endif
    // #ifndef H5
    return null
    // #endif
  },
  async write(value) {
    await prepare()
    // #ifdef H5
    await SecureStorage.setItem('password-login', value)
    // #endif
  },
  async remove() {
    await prepare()
    // #ifdef H5
    await SecureStorage.remove('password-login')
    // #endif
  }
})
