import { defineStore } from 'pinia'
import {
  FISHING_SKINS,
  SKIN_STORAGE_KEY,
  fishingPalette,
  fishingThemeVars,
  validSkin,
  type FishingSkinId
} from '@/domain/appearance'

function savedSkin() {
  try {
    return validSkin(uni.getStorageSync(SKIN_STORAGE_KEY))
  } catch {
    return 'lake' as const
  }
}
function systemDark() {
  // #ifdef H5
  return window.matchMedia('(prefers-color-scheme: dark)').matches
  // #endif
  // #ifndef H5
  return uni.getAppBaseInfo().theme === 'dark'
  // #endif
}
export const useAppearanceStore = defineStore('fishing-appearance', {
  state: () => ({ skin: savedSkin(), dark: systemDark(), saveFailed: false }),
  getters: {
    palette: (state) => fishingPalette(state.skin, state.dark),
    name: (state) => FISHING_SKINS.find((skin) => skin.id === state.skin)!.name,
    variables: (state) => fishingThemeVars(fishingPalette(state.skin, state.dark))
  },
  actions: {
    select(skin: FishingSkinId) {
      this.skin = validSkin(skin)
      try {
        uni.setStorageSync(SKIN_STORAGE_KEY, this.skin)
        this.saveFailed = false
      } catch {
        this.saveFailed = true
      }
    },
    refreshSystem() {
      this.dark = systemDark()
    }
  }
})
let listening = false
export function watchSystemAppearance() {
  if (listening) return
  listening = true
  const theme = useAppearanceStore()
  // #ifdef H5
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', () => theme.refreshSystem())
  const paintCanvas = () => {
    const palette = theme.palette
    document.documentElement.style.setProperty('--fishing-canvas', palette.mist)
    document.documentElement.style.setProperty('--fishing-foreground', palette.ink)
    document.documentElement.style.colorScheme = theme.dark ? 'dark' : 'light'
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette.mist)
  }
  theme.$subscribe(paintCanvas, { detached: true, flush: 'sync' })
  paintCanvas()
  // #endif
  // #ifndef H5
  uni.onThemeChange(() => theme.refreshSystem())
  // #endif
}
