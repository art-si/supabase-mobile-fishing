import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(import.meta.resolve('supabase-mobile-pro/scripts/mobile-cli.mjs'))
const result = spawnSync(process.execPath, [cli, 'cap', 'sync'], {
  stdio: 'inherit',
  env: { ...process.env, FISHING_DEMO_BUILD: '1' }
})
process.exit(result.status ?? 1)
