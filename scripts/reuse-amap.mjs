// Explicit, local-only migration of the owner's existing Pro map configuration.
// Never print credentials or copy unrelated (especially Auth/SMS) variables.
import { readFileSync, writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = resolve(root, '../supabase-mobile-pro/modules/supabase-mobile-tms-driver/.env.local')
const target = resolve(root, '.env.local')
const incoming = parseEnv(readFileSync(source, 'utf8'))
const values = {
  VITE_AMAP_KEY: incoming.VITE_AMAP_KEY,
  AMAP_SECURITY_JS_CODE: incoming.VITE_AMAP_SECURITY_JS_CODE
}
if (Object.values(values).some((value) => !/^[a-f0-9]{32}$/i.test(value || '')))
  throw new Error('Pro map configuration is missing or invalid; no files changed')
let content = readFileSync(target, 'utf8')
const current = parseEnv(content)
// Keep an explicitly configured production proxy. Relative proxy works in Vite dev/preview.
values.VITE_AMAP_SERVICE_HOST = current.VITE_AMAP_SERVICE_HOST || '/_AMapService'
for (const [name, value] of Object.entries(values)) {
  const line = `${name}=${value}`
  const pattern = new RegExp(`^${name}=.*$`, 'm')
  content = pattern.test(content)
    ? content.replace(pattern, () => line)
    : `${content.trimEnd()}\n${line}\n`
}
// Mechanical env migration. No source credentials are ever inserted into tracked code.
writeFileSync(target, content)
console.log(
  'Reused Pro JS Key + server-only security code. Auth/SMS config unchanged. Values withheld.'
)
console.log(`Web Service Key in source: ${Boolean(incoming.VITE_AMAP_WEB_SERVICE_KEY?.trim())}`)
