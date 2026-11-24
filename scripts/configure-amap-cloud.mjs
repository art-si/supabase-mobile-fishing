// Explicit deployment step for exactly this fishing project and these three map secrets.
// Reads the already-reused local map config; does not inspect/change Auth or SMS providers.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const project = 'jupuypvmgjpnpntfetqv'
const local = resolve(root, '.env.local')
const env = parseEnv(readFileSync(local, 'utf8'))
if (env.VITE_SUPABASE_URL !== `https://${project}.supabase.co`)
  throw new Error('Refusing unconfirmed project')
if (
  ![env.VITE_AMAP_KEY, env.AMAP_SECURITY_JS_CODE].every((value) =>
    /^[a-f0-9]{32}$/i.test(value || '')
  )
)
  throw new Error('Run scripts/reuse-amap.mjs first')
const hosts = new Set(['localhost', '127.0.0.1'])
for (const entries of Object.values(networkInterfaces()))
  for (const entry of entries || [])
    if (
      entry.family === 'IPv4' &&
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address)
    )
      hosts.add(entry.address)
const pagesOrigin = 'https://art-si.github.io'
const origins = ['https://localhost', 'capacitor://localhost']
for (const host of hosts)
  for (const port of [5178, 5179, 5181, 5182]) origins.push(`http://${host}:${port}`)
const values = {
  AMAP_JS_KEY: env.VITE_AMAP_KEY,
  AMAP_SECURITY_JS_CODE: env.AMAP_SECURITY_JS_CODE,
  AMAP_JS_ALLOWED_ORIGINS: [
    ...new Set([
      ...(env.AMAP_JS_ALLOWED_ORIGINS
        ? env.AMAP_JS_ALLOWED_ORIGINS.split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        : origins),
      pagesOrigin
    ])
  ].join(',')
}
const temporary = resolve(root, `.env.amap-upload.${randomUUID()}.local`)
if (dirname(temporary) !== resolve(root)) throw new Error('Invalid temporary target')
let created = false
try {
  writeFileSync(
    temporary,
    Object.entries(values)
      .map(([name, value]) => `${name}=${value}`)
      .join('\n'),
    { flag: 'wx', mode: 0o600 }
  )
  created = true
  const result = spawnSync(
    'supabase',
    ['secrets', 'set', '--env-file', temporary, '--project-ref', project],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60000
    }
  )
  if (result.status !== 0) {
    const categories = [
      '401',
      '403',
      'EOF',
      'timeout',
      'connect',
      'not found',
      'permission'
    ].filter((code) =>
      `${result.stderr || ''} ${result.stdout || ''}`.toLowerCase().includes(code.toLowerCase())
    )
    throw new Error(
      `Map secret upload failed (${result.error?.code || result.status}; ${categories.join(',')}); credentials and CLI output withheld`
    )
  }
  console.log(
    'Uploaded only AMAP_JS_KEY, AMAP_SECURITY_JS_CODE, AMAP_JS_ALLOWED_ORIGINS to the confirmed fishing project.'
  )
  console.log(
    'Pages can use the confirmed amap-js HTTPS endpoint; custom proxies use /_AMapService. Secret values withheld.'
  )
} finally {
  if (created) {
    unlinkSync(temporary)
    console.log('Removed this run’s temporary secret upload file.')
  }
}
