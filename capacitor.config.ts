import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.diaoyouji.fishing',
  appName: '钓友集',
  webDir: process.env.FISHING_DEMO_BUILD === '1' ? 'dist/demo/h5' : 'dist/build/h5',
  backgroundColor: '#f5f7f5',
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false },
  ios: { contentInset: 'automatic' },
  plugins: { SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'cover' } }
}
export default config
