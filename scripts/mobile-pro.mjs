import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const applicationRoot = fileURLToPath(new URL('../', import.meta.url))
export async function loadMobilePro() {
  const candidates = process.env.MOBILE_PRO_ROOT
    ? [resolve(process.env.MOBILE_PRO_ROOT)]
    : [resolve(applicationRoot, '../supabase-mobile-pro'), resolve(applicationRoot, '../..')]
  const root = candidates.find((path) => existsSync(resolve(path, 'scripts/mobile-runtime.mjs')))
  if (!root)
    throw new Error(
      '请检出相邻的 supabase-mobile-pro，或设置 MOBILE_PRO_ROOT。不要手动编辑 src/_mobile-core。'
    )
  return import(pathToFileURL(resolve(root, 'scripts/mobile-runtime.mjs')).href)
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { prepareMobileCore } = await loadMobilePro()
  prepareMobileCore(applicationRoot)
}
