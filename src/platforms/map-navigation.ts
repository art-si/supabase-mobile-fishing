import { canNavigate, createId } from '@/domain/rules'
import { validSelection } from '@/domain/map'
import type { SelectedPlace } from '@/domain/map'
import type { Spot } from '@/domain/models'
// #ifdef H5
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
// #endif
export type { SelectedPlace } from '@/domain/map'
export function pickMap(context?: 'water') {
  const requestId = createId()
  const query = `pick=1&requestId=${requestId}${context ? '&context=water' : ''}`
  // #ifdef MP-WEIXIN
  uni.navigateTo({ url: `/pages/map/search?${query}` })
  // #endif
  // #ifdef H5
  uni.navigateTo({ url: `/pages/map/index?${query}` })
  // #endif
  return requestId
}
export function consumeSelection(requestId: string): SelectedPlace | null {
  if (!requestId) return null
  const key = `dyj.map.selection.${requestId}`
  const place = uni.getStorageSync(key) as SelectedPlace
  uni.removeStorageSync(key)
  return validSelection(place) ? place : null
}
export async function navigateToSpot(spot: Spot) {
  if (!canNavigate(spot)) throw new Error('作者未开放精确钓点，不能据此导航')
  const url = `https://uri.amap.com/navigation?to=${spot.longitude},${spot.latitude},${encodeURIComponent(spot.name)}&mode=car&coordinate=gaode&callnative=1&src=diaoyouji`
  // #ifdef H5
  if (Capacitor.isNativePlatform()) await Browser.open({ url })
  else window.location.assign(url)
  // #endif
  // #ifdef MP-WEIXIN
  uni.showModal({
    title: '精确位置已开放',
    content: '复制钓点位置后，可到高德地图查看路线。',
    confirmText: '复制位置',
    success: (r) => {
      if (r.confirm)
        uni.setClipboardData({
          data: `${spot.name}（高德坐标）：${spot.longitude}, ${spot.latitude}`
        })
    }
  })
  // #endif
}
