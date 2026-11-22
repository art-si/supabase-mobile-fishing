// #ifdef H5
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
// #endif

export async function openExternalPage(url: string): Promise<'opened' | 'copied'> {
  // #ifdef H5
  if (Capacitor.isNativePlatform()) await Browser.open({ url })
  else window.open(url, '_blank', 'noopener,noreferrer')
  return 'opened'
  // #endif
  // #ifndef H5
  await new Promise<void>((resolve, reject) => uni.setClipboardData({
    data: url, showToast: false, success: () => resolve(), fail: reject
  }))
  return 'copied'
  // #endif
}
