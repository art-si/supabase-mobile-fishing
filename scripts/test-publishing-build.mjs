import { spawnSync } from 'node:child_process'
const run = (args, env = process.env) =>
  spawnSync(process.execPath, args, { stdio: 'inherit', env })
if (run(['scripts/mobile-pro.mjs']).status !== 0) process.exit(1)
const fixture = {
  ...process.env,
  VITE_DATA_MODE: 'live',
  VITE_SUPABASE_URL: 'https://tlfmfokyhahlpzmpliad.supabase.co',
  VITE_SUPABASE_KEY: 'sb_publishable_contract_fixture',
  VITE_PHONE_AUTH_ENABLED: 'true',
  VITE_AUTH_CAPTCHA_ENABLED: 'false',
  VITE_AMAP_KEY: 'public-fixture',
  VITE_AMAP_SERVICE_HOST: '/_AMapService',
  H5_BUILD_DIR: 'dist/test/publishing'
}
const build = spawnSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'uni', 'build', '-p', 'h5', '--mode', 'test', '--outDir', 'dist/test/publishing'],
  { shell: process.platform === 'win32', stdio: 'inherit', env: fixture }
)
if (build.status !== 0) process.exit(build.status ?? 1)
process.exit(run(['scripts/test-publishing.mjs', '--built']).status ?? 1)
