import { spawnSync } from 'node:child_process'
const result = spawnSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  [
    'dlx',
    'deno@2.9.6',
    'check',
    '--config',
    'supabase/functions/deno.json',
    'supabase/functions/media-upload/index.ts',
    'supabase/functions/media-cleanup/index.ts',
    'supabase/functions/account-delete/index.ts',
    'supabase/functions/account-login/index.ts',
    'supabase/functions/amap/index.ts',
    'supabase/functions/spot-discovery/index.ts',
    'supabase/functions/spot-source-import/index.ts',
    'supabase/functions/spot-source-sync/index.ts',
    'supabase/functions/social-accounts/index.ts',
    'supabase/functions/send-sms-hook/index.ts'
  ],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DENO_NO_PACKAGE_JSON: '1' }
  }
)
if (result.status !== 0) process.exit(result.status ?? 1)
const tests = spawnSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  [
    'dlx',
    'deno@2.9.6',
    'test',
    '--allow-read=tests/fixtures/flower-cc0.mp4',
    '--config',
    'supabase/functions/deno.json',
    'tests/edge_test.ts',
    'tests/account_login_edge_test.ts',
    'tests/photo_edge_test.ts',
    'tests/media_upload_edge_test.ts',
    'tests/media_cleanup_edge_test.ts',
    'tests/amap_edge_test.ts',
    'tests/sms_hook_edge_test.ts'
  ],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DENO_NO_PACKAGE_JSON: '1' }
  }
)
process.exit(tests.status ?? 1)
