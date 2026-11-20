import { createSSRApp } from 'vue'
import App from './App.vue'
import { installMobilePlugins } from '@mobile-core/app'
export function createApp() {
  const app = createSSRApp(App)
  installMobilePlugins(app)
  app.config.globalProperties.uni = uni
  return { app }
}
