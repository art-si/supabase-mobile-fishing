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
  discussionName: string
  line: string
  float: string
  floatSoft: string
  danger: string
}
const lightSignals = { float: '#914C2D', floatSoft: '#FAEFE7', danger: '#B42331', discussionName: '#526582' }
const darkSignals = { float: '#E7AE8D', floatSoft: '#3A2D25', danger: '#FFADB5', discussionName: '#ACC4ED' }
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
    // Keep persisted IDs so existing theme selections survive the palette refresh.
    id: 'ocean',
    name: '日出橙',
    description: '明亮，温暖',
    light: {
      lake: '#C14B13',
      lakeRgb: '193, 75, 19',
      lakeSoft: '#FFF6EF',
      onLake: '#FFFFFF',
      mist: '#FFF8F2',
      paper: '#FFFFFF',
      inset: '#F9EEE5',
      ink: '#392519',
      reed: '#795B48',
      line: '#EEDCCF',
      ...lightSignals,
      discussionName: '#A64718'
    },
    dark: {
      lake: '#FFAB70',
      lakeRgb: '255, 171, 112',
      lakeSoft: '#4A2D1E',
      onLake: '#371A0B',
      mist: '#1D1713',
      paper: '#2A211B',
      inset: '#38291F',
      ink: '#FFF0E6',
      reed: '#D0B8A7',
      line: '#574134',
      ...darkSignals,
      discussionName: '#FFBC8D'
    }
  },
  {
    id: 'stone',
    name: '莓果红',
    description: '鲜明，轻快',
    light: {
      lake: '#C62959',
      lakeRgb: '198, 41, 89',
      lakeSoft: '#FDEAF0',
      onLake: '#FFFFFF',
      mist: '#FFF6F8',
      paper: '#FFFFFF',
      inset: '#F8EBEF',
      ink: '#3C1D2A',
      reed: '#795361',
      line: '#EED8E0',
      ...lightSignals,
      discussionName: '#AD2C55'
    },
    dark: {
      lake: '#FF97B5',
      lakeRgb: '255, 151, 181',
      lakeSoft: '#4D2635',
      onLake: '#3A1222',
      mist: '#20151B',
      paper: '#2D2027',
      inset: '#3D2933',
      ink: '#FFEBF2',
      reed: '#D7B4C3',
      line: '#5C3D4C',
      ...darkSignals,
      discussionName: '#FFB2CE'
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
