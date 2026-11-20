import { spawnSync } from 'node:child_process'
// Isolated contract build. All service requests are intercepted in the browser test.
// These fixture credentials never go into production/demo builds or local configuration.
const env = { ...process.env, VITE_DATA_MODE: 'live', VITE_SUPABASE_KEY: 'sb_publishable_contract_fixture', VITE_PHONE_AUTH_ENABLED: 'true', VITE_AUTH_CAPTCHA_ENABLED: 'false', VITE_AMAP_KEY: '', H5_BUILD_DIR: 'dist/test/h5' }
const build = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['exec', 'uni', 'build', '-p', 'h5', '--mode', 'test', '--outDir', 'dist/test/h5'], { stdio: 'inherit', shell: process.platform === 'win32', env })
if (build.status !== 0) process.exit(build.status ?? 1)
const test = spawnSync(process.execPath, ['scripts/smoke-h5.mjs', '--map-contract'], { stdio: 'inherit', env })
process.exit(test.status ?? 1)
