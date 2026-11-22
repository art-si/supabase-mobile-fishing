export const homeTabs = ['feed', 'spots', 'mine'] as const
type HomeTab = (typeof homeTabs)[number]

export const reportsRoute = '/pages/water-report/index?tabbed=1'
let requestedHomeTab: HomeTab | undefined

export function returnToHomeTab(value: string) {
  const tab = homeTabs.find((item) => item === value)
  if (!tab) return
  const url = `/pages/home/index?tab=${tab}`
  const previous = getCurrentPages().at(-2)
  if (previous?.route !== 'pages/home/index') {
    uni.redirectTo({ url })
    return
  }
  requestedHomeTab = tab
  uni.navigateBack({
    animationDuration: 0,
    fail: () => {
      requestedHomeTab = undefined
      uni.redirectTo({ url })
    }
  })
}

export function takeHomeTab() {
  const target = requestedHomeTab
  requestedHomeTab = undefined
  return target
}
