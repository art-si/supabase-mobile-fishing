import type { CapacitorConfig } from '@capacitor/cli'
import { baseNativePlugins } from 'supabase-mobile-pro/scripts/native-plugins.mjs'

const config: CapacitorConfig = {
  appId: 'com.diaoyouji.fishing',
  appName: '钓友集',
  webDir: process.env.FISHING_DEMO_BUILD === '1' ? 'dist/demo/h5' : 'dist/build/h5',
  includePlugins: [
    '@aparajita/capacitor-secure-storage',
    ...baseNativePlugins,
    '@capacitor/camera',
    '@capacitor/geolocation'
  ],
  backgroundColor: '#f5f7f5',
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false },
  ios: { contentInset: 'automatic' },
  plugins: { SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'cover' } }
}
export default config
