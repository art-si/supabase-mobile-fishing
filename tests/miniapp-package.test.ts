import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { compileString } from 'sass'
import { createHash } from 'node:crypto'
import { auditMiniapp, packageOwner, pageManifest } from '../scripts/miniapp-package.mjs'
import { resolveMobileProRoot } from '../scripts/mobile-pro.mjs'

const root = resolve(import.meta.dirname, '..')
const source = JSON.parse(readFileSync(resolve(root, 'src/pages.json'), 'utf8'))
const retainedRoutes = [
  'home/index',
  'login/index',
  'account/security',
  'account/connections',
  'account/password',
  'account/phone',
  'post/detail',
  'post/compose',
  'spot/detail',
  'spot/create',
  'spot/discover',
  'map/index',
  'map/search',
  'map/marks',
  'map/bridge',
  'notifications/index',
  'people/detail',
  'mine/library',
  'mine/profile',
  'settings/index',
  'settings/legal',
  'moderation/index',
  'moderation/detail',
  'content-report/index',
  'content-report/detail',
  'water-report/index',
  'water-report/history'
].map((path) => `pages/${path}`)

test('subpackage registration preserves existing URLs and registers every page once', () => {
  const manifest = pageManifest(source)
  for (const route of retainedRoutes) assert.ok(manifest.routes.includes(route), route)
  const src = resolve(root, 'src')
  const routeFiles = new Set(manifest.routes.map(route => resolve(src, route + '.vue')))
  // A registered screen can import a component which imports another component in pages/.
  const reachableFiles = new Set(routeFiles)
  for (const file of reachableFiles) {
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(/\bfrom\s+['"](\.{1,2}\/[^'"]+\.vue)['"]/g)) {
      reachableFiles.add(resolve(dirname(file), specifier))
    }
  }
  const pages = readdirSync(resolve(src, 'pages'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.vue'))
    .map((entry) => resolve(entry.parentPath, entry.name))
    .filter((file) => routeFiles.has(file) || !reachableFiles.has(file))
  assert.deepEqual([...routeFiles].sort(), pages.sort())
  assert.equal(manifest.main[0], 'pages/home/index')
  for (const route of ['pages/login/index', 'pages/settings/legal'])
    assert.ok(manifest.main.includes(route), 'login and agreements need no subpackage download')
})

test('package manifest rejects duplicates, traversal, overlapping roots and subpackage tabs', () => {
  for (const manifest of [
    { pages: ['home', 'home'] },
    { pages: ['../home'] },
    { pages: ['C:/home'] },
    { pages: ['home?query=1'] },
    {
      pages: ['home'],
      subPackages: [
        { root: 'a', pages: [] },
        { root: 'a', pages: [] }
      ]
    },
    {
      pages: ['home'],
      subPackages: [
        { root: 'a', pages: [] },
        { root: 'a/b', pages: [] }
      ]
    },
    { pages: ['a/index'], subPackages: [{ root: 'a', pages: [] }] },
    { pages: ['home'], tabBar: { list: [{ pagePath: 'a/index' }] } },
    { pages: ['home'], subPackages: [{ root: 'a', pages: ['index'], independent: true }] }
  ])
    assert.throws(() => pageManifest(manifest))
  assert.equal(packageOwner('pages/map/index.js', ['pages/map']), 'pages/map')
  assert.equal(packageOwner('pages/map-other/index.js', ['pages/map']), '__APP__')
})

const fixtureManifest = {
  pages: ['pages/home/index'],
  subPackages: [
    { root: 'pages/map', pages: ['index'] },
    { root: 'pages/chat', pages: ['index'] }
  ]
}
function fixture() {
  const files = new Map<string, Buffer>([
    ['app.json', Buffer.from(JSON.stringify(fixtureManifest))]
  ])
  files.set('app.js', Buffer.from(''))
  files.set('app.wxss', Buffer.from(''))
  for (const route of pageManifest(fixtureManifest).routes)
    for (const ext of ['.js', '.wxml', '.wxss', '.json'])
      files.set(route + ext, Buffer.from(ext === '.json' ? '{}' : ''))
  files.set('common/vendor.js', Buffer.from('module.exports = {}'))
  files.set('common/shared.wxss', Buffer.from('.shared{}'))
  files.set('common/label.wxml', Buffer.from('<template name="label"/>'))
  files.set('components/Button.json', Buffer.from('{}'))
  files.set('components/Button.js', Buffer.from('Component({})'))
  files.set('components/Button.wxml', Buffer.from('<button/>'))
  files.set('pages/map/index.js', Buffer.from('require("../../common/vendor.js")'))
  files.set('pages/map/index.wxss', Buffer.from('@import "../../common/shared.wxss";'))
  files.set('pages/map/index.wxml', Buffer.from('<import src="../../common/label.wxml"/>'))
  files.set(
    'pages/map/index.json',
    Buffer.from('{"usingComponents":{"button":"/components/Button"}}')
  )
  return files
}

test('package audit counts raw bytes and resolves main dependencies from a subpackage', () => {
  const files = fixture()
  const result = auditMiniapp(files, fixtureManifest)
  assert.equal(result.passed, true, result.issues.join('\n'))
  assert.equal(result.measurement, 'raw-build-files-not-wechat-upload-size')
  assert.equal(
    result.totalBytes,
    [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0)
  )
  assert.equal(result.references, 6)
  assert.equal(Object.keys(result.packages).length, 3)
  assert.match(result.sha256, /^[a-f0-9]{64}$/)
  assert.equal(auditMiniapp(files, fixtureManifest, { packageBudget: 1 }).passed, false)
  assert.equal(auditMiniapp(files, fixtureManifest, { totalBudget: 1 }).passed, false)
})

test('package audit rejects shoreline assets even when the package is under budget', () => {
  const files = fixture()
  files.set('static/web/water-index/manifest.json', Buffer.from('{}'))
  files.set('static/china-latest.osm.pbf', Buffer.from('test'))
  const result = auditMiniapp(files, fixtureManifest)
  assert.equal(result.passed, false)
  assert.equal(result.issues.filter((issue: string) => issue.startsWith('Shoreline data')).length, 2)
})

test('package audit rejects main-to-subpackage and sibling-subpackage dependencies', () => {
  for (const [path, content] of [
    ['pages/home/index.js', 'require("../map/index.js")'],
    ['pages/chat/index.wxss', '@import "../map/index.wxss";'],
    ['pages/chat/index.wxml', '<include src="../map/index.wxml"/>'],
    ['pages/chat/index.json', '{"usingComponents":{"map":"../map/index"}}']
  ]) {
    const files = fixture()
    files.set(path, Buffer.from(content))
    const result = auditMiniapp(files, fixtureManifest)
    assert.equal(result.passed, false)
    assert.ok(result.issues.some((issue: string) => issue.startsWith('Illegal cross-package')))
  }
})

test('only Uni compiler unreachable page anchors are exempt from runtime ownership', () => {
  const files = fixture()
  files.set(
    'app.js',
    Buffer.from('Math||(Promise.resolve().then(()=>require("./pages/map/index.js")));')
  )
  const anchored = auditMiniapp(files, fixtureManifest)
  assert.equal(anchored.passed, true)
  assert.equal(anchored.compilerPageAnchors, 1)
  files.set(
    'app.js',
    Buffer.from('Math||(Promise.resolve().then(()=>require("./pages/map/index.js")).then(e=>e.cGFnZXMvbWFwL2luZGV4LnZ1ZQ_exports));')
  )
  assert.equal(auditMiniapp(files, fixtureManifest).passed, true)
  files.set(
    'app.js',
    Buffer.from(
      'Math||(Promise.resolve().then(()=>require("./pages/map/index.js")));require("./pages/map/index.js");'
    )
  )
  assert.equal(auditMiniapp(files, fixtureManifest).passed, false, 'live requires must still fail')
  files.set(
    'app.js',
    Buffer.from('notMath||(Promise.resolve().then(()=>require("./pages/map/index.js")));')
  )
  assert.equal(
    auditMiniapp(files, fixtureManifest).passed,
    false,
    'only the compiler Math guard is recognized'
  )
  files.set('pages/map/secret.js', Buffer.from('module.exports = {}'))
  files.set(
    'app.js',
    Buffer.from('Math||(Promise.resolve().then(()=>require("./pages/map/secret.js")));')
  )
  assert.equal(
    auditMiniapp(files, fixtureManifest).passed,
    false,
    'non-page anchor must still fail'
  )
})

test('package audit rejects missing components, artifacts, unsupported refs and stale routes', () => {
  const files = fixture()
  files.delete('components/Button.wxml')
  files.delete('app.js')
  files.delete('pages/chat/index.js')
  files.set('pages/chat/index.wxml', Buffer.from('<include src="{{templatePath}}"/>'))
  const result = auditMiniapp(files, { ...fixtureManifest, pages: ['pages/new/index'] })
  for (const prefix of [
    'Missing dependency',
    'Missing page artifact',
    'Missing app artifact',
    'Unsupported dependency',
    'Built page routes',
    'Launch page changed'
  ])
    assert.ok(
      result.issues.some((issue: string) => issue.startsWith(prefix)),
      prefix
    )
})

function css(argument = '') {
  return compileString(`@use 'global.scss' as mobile; @include mobile.apply('tms'${argument});`, {
    loadPaths: [
      resolve(resolveMobileProRoot(), 'packages/mobile-core/src/styles'),
      resolve(root, 'node_modules')
    ],
    logger: { warn() {}, debug() {} },
    style: 'compressed'
  }).css
}

test('Pro default font remains unchanged and system-font opt-out keeps all control styles and icons', () => {
  const bundled = css()
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  assert.equal(hash(css(', $embed-body-font: true')), hash(bundled))
  const system = css(', $embed-body-font: false')
  const bodyFace = /@font-face\{font-family:["']?TMS Sans SC["']?;[^}]*\}/
  assert.ok(bodyFace.test(bundled), 'default retains body font')
  assert.ok(!bodyFace.test(system), 'opt-out omits body font')
  assert.ok(
    /@font-face\{font-family:["']?Mobile Pro Icons["']?;/.test(system),
    'icons remain bundled'
  )
  assert.ok(/--tms-font-family:\s*-apple-system/.test(system), 'platform font is first')
  assert.ok(Buffer.byteLength(bundled) - Buffer.byteLength(system) > 1_000_000)
  const omitFont = (value: string) =>
    value.replace(bodyFace, '').replace(/--tms-font-family:[^;]+;/, '--tms-font-family:FONT;')
  assert.equal(
    hash(omitFont(bundled)),
    hash(omitFont(system)),
    'all non-font styles stay identical'
  )
})
