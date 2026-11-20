// Fishing-specific palettes. Shared controls consume the same semantic aliases.
export const SKIN_STORAGE_KEY = 'dyj.appearance.skin.v1'
export type FishingSkinId = 'lake' | 'ocean' | 'stone'
export interface FishingPalette {
  lake: string
  lakeRgb: string
  lakeSoft: string
  onLake: string
  mist: string
  paper: string
  inset: string
  ink: string
  reed: string
  line: string
  float: string
  floatSoft: string
  danger: string
}
const lightSignals = { float: '#914C2D', floatSoft: '#FAEFE7', danger: '#B42331' }
const darkSignals = { float: '#E7AE8D', floatSoft: '#3A2D25', danger: '#FFADB5' }
export const FISHING_SKINS: ReadonlyArray<{
  id: FishingSkinId
  name: string
  description: string
  light: FishingPalette
  dark: FishingPalette
}> = [
  {
    id: 'lake',
    name: '湖畔青',
    description: '自然，清爽',
    light: {
      lake: '#0F6B5B',
      lakeRgb: '15, 107, 91',
      lakeSoft: '#E8F1EC',
      onLake: '#FFFFFF',
      mist: '#F5F7F5',
      paper: '#FFFFFF',
      inset: '#EDF2EE',
      ink: '#182D27',
      reed: '#53665F',
      line: '#DDE5E0',
      ...lightSignals
    },
    dark: {
      lake: '#79CEB8',
      lakeRgb: '121, 206, 184',
      lakeSoft: '#233C32',
      onLake: '#10221B',
      mist: '#111C19',
      paper: '#1A2822',
      inset: '#24362D',
      ink: '#EAF2EE',
      reed: '#A4B6AE',
      line: '#34483F',
      ...darkSignals
    }
  },
  {
    id: 'ocean',
    name: '深海蓝',
    description: '通透，沉静',
    light: {
      lake: '#185F8D',
      lakeRgb: '24, 95, 141',
      lakeSoft: '#E6EFF7',
      onLake: '#FFFFFF',
      mist: '#F4F7FA',
      paper: '#FFFFFF',
      inset: '#ECF1F6',
      ink: '#203244',
      reed: '#53697B',
      line: '#DDE5ED',
      ...lightSignals
    },
    dark: {
      lake: '#8FC5ED',
      lakeRgb: '143, 197, 237',
      lakeSoft: '#243E55',
      onLake: '#13283A',
      mist: '#131C25',
      paper: '#1B2835',
      inset: '#263747',
      ink: '#E9F0F7',
      reed: '#ACBDCC',
      line: '#344658',
      ...darkSignals
    }
  },
  {
    id: 'stone',
    name: '岩石灰',
    description: '简洁，耐看',
    light: {
      lake: '#49515B',
      lakeRgb: '73, 81, 91',
      lakeSoft: '#EAECEF',
      onLake: '#FFFFFF',
      mist: '#F6F6F7',
      paper: '#FFFFFF',
      inset: '#F0F1F2',
      ink: '#24292F',
      reed: '#60666F',
      line: '#E0E3E7',
      ...lightSignals
    },
    dark: {
      lake: '#C7CDD5',
      lakeRgb: '199, 205, 213',
      lakeSoft: '#353B44',
      onLake: '#24292F',
      mist: '#191C20',
      paper: '#23272D',
      inset: '#2F343C',
      ink: '#ECEFF2',
      reed: '#B4BCC6',
      line: '#414852',
      ...darkSignals
    }
  }
]
export function validSkin(value: unknown): FishingSkinId {
  return FISHING_SKINS.find((skin) => skin.id === value)?.id ?? 'lake'
}
export function fishingPalette(id: FishingSkinId, dark: boolean): FishingPalette {
  const skin = FISHING_SKINS.find((skin) => skin.id === id) ?? FISHING_SKINS[0]!
  return dark ? skin.dark : skin.light
}
export function fishingThemeVars(palette: FishingPalette) {
  // Wot carries themeVars into its root portals on both H5 and WeChat.
  return Object.fromEntries(
    Object.entries(palette).map(([key, value]) => [
      `fish${key[0]!.toUpperCase()}${key.slice(1)}`,
      value
    ])
  ) as Record<string, string>
}
