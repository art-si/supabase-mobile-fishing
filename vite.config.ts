import { defineConfig, loadEnv, type ModuleNode } from 'vite'
import uniPlugin from '@dcloudio/vite-plugin-uni'
import { applicationRoot, loadMobilePro } from './scripts/mobile-pro.mjs'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { FISHING_SKINS, SKIN_STORAGE_KEY } from './src/domain/appearance'
import { amapProxy } from './scripts/amap-proxy'

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, applicationRoot, 'VITE_')
  const key = env.VITE_SUPABASE_KEY?.trim()
  if (key && !key.startsWith('sb_publishable_')) {
    let role: string | undefined
    try {
      role = JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64url').toString()).role
    } catch {
      /* redacted */
    }
    if (role !== 'anon')
      throw new Error('客户端只能使用 publishable / anon key，不能使用服务器密钥。')
  }
  const { createMobileViteConfig } = await loadMobilePro()
  const mobileConfig = createMobileViteConfig(applicationRoot, uniPlugin)
  const serverEnv = loadEnv(mode, applicationRoot, 'AMAP_')
  mobileConfig.plugins.push(
    amapProxy(env.VITE_AMAP_KEY || '', serverEnv.AMAP_SECURITY_JS_CODE || '')
  )
  if (process.env.UNI_PLATFORM === 'h5') {
    // Pinia survives Vue HMR, but replacing these modules creates new session refs.
    // Reload together so the signed-in UI and request credentials share one instance.
    mobileConfig.plugins.push({
      name: 'fishing-auth-session-reload',
      apply: 'serve',
      handleHotUpdate({ file, server, modules, timestamp }) {
        const ownsSession = (file: string) =>
          /\/src\/(services\/(session|native-credentials)|stores\/auth|config)\.ts$/.test(
            file.replaceAll('\\', '/')
          )
        const pending = [...modules],
          visited = new Set<ModuleNode>()
        let reload = ownsSession(file)
        while (!reload && pending.length) {
          const module = pending.pop()!
          if (visited.has(module)) continue
          visited.add(module)
          reload = ownsSession(module.file || '')
          pending.push(...module.importers)
        }
        if (reload) {
          const invalidated = new Set<ModuleNode>()
          for (const module of modules)
            server.moduleGraph.invalidateModule(module, invalidated, timestamp, true)
          server.ws.send({ type: 'full-reload' })
          return []
        }
      }
    })
    // App-owned boot artwork replaces the marker before Pro's default boot hook runs.
    mobileConfig.plugins.push({
      name: 'fishing-brand-boot',
      transformIndexHtml: {
        order: 'pre',
        handler(html: string) {
          const marker = '<!-- mobile-boot -->'
          if (!html.includes(marker)) return
          const read = (file: string) => readFileSync(resolve(applicationRoot, file), 'utf8')
          const paint = (palette: (typeof FISHING_SKINS)[number]['light']) =>
            `--lake:${palette.lake};--mist:${palette.mist};--ink:${palette.ink};--reed:${palette.reed};--on-lake:${palette.onLake};`
          const skins = FISHING_SKINS.map(
            (skin) => `.fishing-boot[data-skin="${skin.id}"]{${paint(skin.light)}}`
          ).join('')
          const darkSkins = FISHING_SKINS.map(
            (skin) => `.fishing-boot[data-skin="${skin.id}"]{${paint(skin.dark)}}`
          ).join('')
          const fish = read('assets/brand/fish-symbol.svg')
            .replace('style="color:#0f6b5b"', 'class="fish-mark__vector" aria-hidden="true"')
            .replace('id="fish-tail"', 'id="fish-tail" class="fish-mark__tail"')
          const boot = read('src/brand/h5-boot.html').replace(
            '<!-- fishing-fish-symbol -->',
            () => fish
          )
          return {
            html: html.replace(marker, () => boot),
            tags: [
              {
                tag: 'style',
                children:
                  read('src/styles/fish-identity.css') +
                  read('src/brand/h5-boot.css') +
                  skins +
                  `@media(prefers-color-scheme:dark){${darkSkins}}`,
                injectTo: 'head' as const
              },
              {
                tag: 'script',
                children: `try{var saved=JSON.parse(localStorage.getItem(${JSON.stringify(SKIN_STORAGE_KEY)})||'null');var skin=typeof saved==='string'?saved:saved&&saved.data;if(${JSON.stringify(FISHING_SKINS.map((skin) => skin.id))}.includes(skin))document.querySelector('.fishing-boot').setAttribute('data-skin',skin)}catch{}`,
                injectTo: 'body' as const
              }
            ]
          }
        }
      }
    })
  }
  return {
    ...mobileConfig,
    // Pin/prebundle both runtime packages: Uni's dev optimizer externalizes the nested import.
    ...(process.env.UNI_PLATFORM === 'h5'
      ? {
          optimizeDeps: { include: ['@supabase/realtime-js', '@supabase/phoenix'] }
        }
      : {})
  }
})
