import type { LocationCoordinates } from '@mobile-core/location'
// #ifdef H5
import { captureBrowserGcj02, captureCapacitorGcj02 } from '@mobile-core/location'
import { Capacitor } from '@capacitor/core'
// #endif
// #ifdef MP-WEIXIN
declare const wx: {
  getFuzzyLocation(options: {
    type: 'gcj02'
    success: (location: { longitude: number; latitude: number }) => void
    fail: (error: { errMsg: string }) => void
  }): void
}
// #endif

export type EntryPermission = PermissionState | 'unknown' | 'insecure' | 'unsupported' | 'unavailable'
export type EntryLocation = LocationCoordinates & { crs: 'GCJ-02'; coarse: boolean }

let observedPermission: PermissionStatus | undefined
let permissionListener: (() => void) | undefined

export function releaseEntryPermissionListener() {
  // #ifdef H5
  if (permissionListener) observedPermission?.removeEventListener?.('change', permissionListener)
  observedPermission = undefined
  permissionListener = undefined
  // #endif
}

export async function readEntryPermission(onChanged: (state: PermissionState) => void): Promise<EntryPermission> {
  // #ifdef H5
  if (Capacitor.isNativePlatform()) {
    try {
      const { Geolocation } = await import('@capacitor/geolocation')
      const result = await Geolocation.checkPermissions()
      if (result.location === 'granted' || result.coarseLocation === 'granted') return 'granted'
      return result.location === 'denied' ? 'denied' : 'prompt'
    } catch { return 'unavailable' }
  }
  if (!window.isSecureContext) return 'insecure'
  if (!navigator.geolocation) return 'unsupported'
  const permission = await navigator.permissions?.query({ name: 'geolocation' }).catch(() => undefined)
  releaseEntryPermissionListener()
  if (!permission) return 'unknown'
  observedPermission = permission
  permissionListener = () => onChanged(permission.state)
  permission.addEventListener?.('change', permissionListener)
  return permission.state
  // #endif
  // #ifdef MP-WEIXIN
  if (typeof wx === 'undefined' || typeof wx.getFuzzyLocation !== 'function') return 'unsupported'
  const setting = await uni.getSetting()
  const permissions = setting.authSetting as typeof setting.authSetting & {
    'scope.userFuzzyLocation'?: boolean
  }
  const value = permissions['scope.userFuzzyLocation']
  return value === true ? 'granted' : value === false ? 'denied' : 'prompt'
  // #endif
}

export async function captureEntryLocation(): Promise<EntryLocation> {
  // #ifdef H5
  if (Capacitor.isNativePlatform()) {
    const { Geolocation } = await import('@capacitor/geolocation')
    const result = await captureCapacitorGcj02(Geolocation)
    return { ...result, crs: 'GCJ-02', coarse: (result.accuracyM ?? 0) >= 1000 }
  }
  const result = await captureBrowserGcj02()
  return { ...result, crs: 'GCJ-02', coarse: (result.accuracyM ?? 0) >= 1000 }
  // #endif
  // #ifdef MP-WEIXIN
  if (typeof wx === 'undefined' || typeof wx.getFuzzyLocation !== 'function')
    throw new Error('LOCATION_UNSUPPORTED')
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('LOCATION_TIMEOUT')), 15_000)
    wx.getFuzzyLocation({
      type: 'gcj02',
      success({ longitude, latitude }) {
        clearTimeout(timeout)
        resolve({ longitude, latitude, crs: 'GCJ-02', coarse: true })
      },
      fail({ errMsg }) {
        clearTimeout(timeout)
        if (/requiredPrivateInfos|api scope is not declared|permission is not open/i.test(errMsg)) {
          reject(new Error('LOCATION_UNSUPPORTED'))
        } else if (/scope\.userFuzzyLocation|auth deny|denied|未授权|拒绝/i.test(errMsg)) {
          reject(new Error('LOCATION_DENIED'))
        } else reject(new Error('LOCATION_UNAVAILABLE'))
      }
    })
  })
  // #endif
}
