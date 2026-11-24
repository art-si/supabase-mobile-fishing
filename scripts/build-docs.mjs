import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { loadEnv } from 'vite'
import { applicationRoot } from './mobile-pro.mjs'

const root = realpathSync(applicationRoot)
const output = resolve(root, 'dist/pages/h5')
const docs = resolve(root, 'docs')
const manifestName = '.pages-assets.json'
const env = loadEnv('pages', root, '')
const projectUrl = 'https://jupuypvmgjpnpntfetqv.supabase.co'
if ((env.VITE_SUPABASE_URL || '').replace(/\/$/, '') !== projectUrl)
  throw new Error('Pages 构建只允许已确认的 Supabase 项目。')
if (env.VITE_DATA_MODE !== 'live') throw new Error('Pages 构建必须使用 live 模式。')
if (!env.VITE_SUPABASE_KEY?.trim())
  throw new Error('请在 .env.local 或 .env.pages.local 配置公开 VITE_SUPABASE_KEY。')

let mapReady = false
try {
  const proxy = new URL(env.VITE_AMAP_SERVICE_HOST)
  mapReady =
    Boolean(env.VITE_AMAP_KEY?.trim()) &&
    proxy.protocol === 'https:' &&
    proxy.pathname === '/_AMapService' &&
    !proxy.search &&
    !proxy.hash &&
    !proxy.username &&
    !proxy.password &&
    !proxy.hostname.endsWith('.github.io') &&
    !['localhost', '127.0.0.1', '[::1]'].includes(proxy.hostname)
} catch {
  /* A missing production proxy must remain visible in the build report. */
}
if (!mapReady)
  console.warn(
    '注意：尚未配置高德 HTTPS 代理，静态站点可访问，交互地图尚不可用。见 docs/github-pages.md。'
  )

// Compile into a disposable directory first. Uni/Vite may empty outDir, so never
// point it at docs, which also contains hand-written project documentation.
if (!output.startsWith(`${root}${sep}dist${sep}`)) throw new Error('Invalid build directory')
generatedPath(output, 'index.html')
const result = spawnSync(
  process.execPath,
  [
    resolve(root, 'node_modules/supabase-mobile-pro/scripts/mobile-cli.mjs'),
    'uni',
    'build',
    '-p',
    'h5',
    '--mode',
    'pages',
    '--outDir',
    output
  ],
  { cwd: root, stdio: 'inherit', windowsHide: true }
)
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status || 1)

function filesIn(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      if (entry.isSymbolicLink()) throw new Error('Pages 产物不能包含符号链接。')
      const name = `${prefix}${entry.name}`
      return entry.isDirectory() ? filesIn(join(directory, entry.name), `${name}/`) : [name]
    })
    .sort()
}

function generatedPath(base, name) {
  if (
    typeof name !== 'string' ||
    name.includes('\\') ||
    name.split('/').some((x) => !x || x === '.' || x === '..') ||
    !(
      /^(assets|static|pages)\//.test(name) ||
      ['index.html', '.nojekyll', manifestName].includes(name)
    )
  )
    throw new Error('Pages 产物清单包含非生成文件；停止以保留 docs 文档。')
  const target = resolve(base, name)
  if (!target.startsWith(`${base}${sep}`)) throw new Error('Invalid Pages target')
  for (let current = target; current !== root; current = dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw new Error('Pages 目标不能经过符号链接。')
  }
  return target
}

const files = filesIn(output)
for (const required of ['index.html', '.nojekyll'])
  if (!files.includes(required)) throw new Error(`构建缺少 ${required}`)
const html = readFileSync(join(output, 'index.html'), 'utf8')
if (/(?:src|href)=["']\/(?!\/)/.test(html))
  throw new Error('入口仍有根路径资源，无法在 GitHub Pages 仓库子路径访问。')

// Compare known server credentials without printing their values or matching text.
const secrets = Object.entries(env).filter(
  ([name, value]) =>
    /(?:SECRET|SERVICE_ROLE|PASSWORD|ACCESS_TOKEN|PRIVATE_KEY|SECURITY_JS_CODE|WEB_SERVICE_KEY)/.test(
      name
    ) && value.length >= 8
)
const privateMapFile = join(root, '.env.amap-web-service.local')
if (existsSync(privateMapFile)) {
  const { parseEnv } = await import('node:util')
  for (const [name, value] of Object.entries(parseEnv(readFileSync(privateMapFile, 'utf8'))))
    if (value.length >= 8) secrets.push([name, value])
}
for (const name of files) {
  const bytes = readFileSync(generatedPath(output, name))
  for (const [secretName, value] of secrets)
    if (bytes.includes(Buffer.from(value)))
      throw new Error(`${secretName} 出现在产物中；未更新 docs。`)
}

mkdirSync(docs, { recursive: true })
const manifestPath = generatedPath(docs, manifestName)
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : []
if (!Array.isArray(previous)) throw new Error('Invalid Pages asset manifest')
// Validate every destination before the first write or removal.
for (const name of new Set([...previous, ...files])) {
  const target = generatedPath(docs, name)
  if (existsSync(target) && !lstatSync(target).isFile()) throw new Error('Pages 目标不是普通文件。')
  if (files.includes(name) && existsSync(target) && !previous.includes(name))
    throw new Error(`docs/${name} 不是此前生成的文件；停止以避免覆盖。`)
}
for (const name of files) {
  const target = generatedPath(docs, name)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(join(output, name), target)
}
for (const name of previous.filter((name) => !files.includes(name))) {
  const target = generatedPath(docs, name)
  if (existsSync(target)) unlinkSync(target)
}
writeFileSync(manifestPath, `${JSON.stringify(files, null, 2)}\n`)
console.log(`已生成 docs：${files.length} 个静态文件；保留现有文档，清理上次生成的旧资源。`)
console.log('站点：https://art-si.github.io/supabase-mobile-fishing/；预览：pnpm preview:docs')
console.log(
  `配置：真实 Supabase；高德 HTTPS 代理${mapReady ? '已填写（上线前仍需验证来源白名单）' : '待配置'}。`
)
