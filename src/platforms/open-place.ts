import { mapLinks, type MapProvider, type MapLinkPlace } from '@mobile-core/map-links'
export async function openPlaceMap(provider: MapProvider, place: MapLinkPlace, webOnly = false) {
  // #ifdef H5
  const ios =
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const mobile = ios || /Android/i.test(navigator.userAgent)
  const urls = mapLinks(provider, place, ios ? 'ios' : 'android')
  // An explicit tap is required. Never redirect later on a timer or claim the app is installed.
  if (mobile && !webOnly) {
    window.location.assign(urls.app)
    return 'attempted' as const
  }
  window.open(urls.web, '_blank', 'noopener,noreferrer')
  return 'web' as const
  // #endif
  // #ifndef H5
  const nativeUrls = mapLinks(provider, place)
  await new Promise<void>((resolve, reject) =>
    uni.setClipboardData({
      data: nativeUrls.web,
      showToast: false,
      success: () => resolve(),
      fail: reject
    })
  )
  return 'copied' as const
  // #endif
}
