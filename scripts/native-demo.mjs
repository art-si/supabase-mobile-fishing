import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
const require = createRequire(import.meta.url)
const cli = join(dirname(require.resolve('@capacitor/cli/package.json')), 'bin/capacitor')
const result = spawnSync(process.execPath, [cli, 'sync'], {
  stdio: 'inherit',
  env: { ...process.env, FISHING_DEMO_BUILD: '1' }
})
process.exit(result.status ?? 1)
