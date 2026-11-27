import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
const env = parseEnv(readFileSync('.env.local', 'utf8'))
assert.ok(env.AMAP_SECURITY_JS_CODE, 'Server code required to verify it is absent from bundles')
const secrets = [{ name: 'AMAP_SECURITY_JS_CODE', value: env.AMAP_SECURITY_JS_CODE }]
const webKeyFile = '.env.amap-web-service.local'
if (existsSync(webKeyFile)) {
  const webKey = parseEnv(readFileSync(webKeyFile, 'utf8')).AMAP_WEB_SERVICE_KEY?.trim()
  if (webKey) secrets.push({ name: 'AMAP_WEB_SERVICE_KEY', value: webKey })
}
let checked = 0
function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) scan(path)
    else if (entry.isFile()) {
      const bytes = readFileSync(path)
      for (const secret of secrets)
        assert.ok(!bytes.includes(Buffer.from(secret.value)), `${secret.name} leaked into ${path}`)
      checked++
    }
  }
}
for (const path of ['dist/build/h5', 'dist/build/mp-weixin']) {
  assert.ok(existsSync(path), `Missing build: ${path}`)
  scan(path)
}
console.log(`PASS ${secrets.length} AMap server credentials absent from ${checked} built files; values not logged`)
