import { spawnSync } from 'node:child_process'
const env = {
  ...process.env,
  VITE_SUPABASE_KEY: 'sb_publishable_contract_fixture',
  VITE_PHONE_AUTH_ENABLED: 'true',
  VITE_AUTH_CAPTCHA_ENABLED: 'false',
  VITE_AMAP_KEY: '',
  H5_BUILD_DIR: 'dist/test/water-report'
}
const build = spawnSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'mobile-pro', 'uni', 'build', '-p', 'h5', '--mode', 'test', '--outDir', env.H5_BUILD_DIR],
  { stdio: 'inherit', shell: process.platform === 'win32', env }
)
if (build.status !== 0) process.exit(build.status ?? 1)
const check = spawnSync(process.execPath, ['scripts/smoke-h5.mjs', '--water-report-contract'], {
  stdio: 'inherit',
  env
})
process.exit(check.status ?? 1)
