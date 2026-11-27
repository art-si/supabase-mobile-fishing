import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { posix, resolve } from 'node:path'

// Conservative project budgets for RAW build files, not WeChat's upload calculation.
// Native controls carry their own layout and event bindings. Keep a conservative
// raw-file guard; the actual DevTools preview is measured separately.
// Shared licensed water index is now available before any map page opens.
// Official 2026-11-24 preview measured main at 1,912,974 B (< 2 MiB).
export const PACKAGE_BUDGET = 1800 * 1024
export const TOTAL_BUDGET = 10 * 1024 * 1024

function safePath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    /[:?#\0]/.test(value) ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error(`Invalid package path: ${String(value)}`)
  return value
}

export function pageManifest(manifest) {
  const packages = manifest.subPackages ?? manifest.subpackages ?? []
  const roots = packages.map((entry) => safePath(entry.root))
  if (new Set(roots).size !== roots.length) throw new Error('Duplicate subpackage root')
  for (const root of roots)
    if (roots.some((other) => root !== other && root.startsWith(`${other}/`)))
      throw new Error('Nested subpackage roots are not supported')
  if (packages.some((entry) => entry.independent))
    throw new Error('Independent subpackages require a separate dependency audit')
  const main = (manifest.pages ?? []).map((page) => safePath(page.path ?? page))
  const routes = [
    ...main,
    ...packages.flatMap((entry) =>
      entry.pages.map((page) => `${entry.root}/${safePath(page.path ?? page)}`)
    )
  ]
  if (!main.length) throw new Error('Main package needs a launch page')
  if (new Set(routes).size !== routes.length) throw new Error('Duplicate page route')
  if (main.some((page) => roots.some((root) => page.startsWith(`${root}/`))))
    throw new Error('Main page is inside a subpackage')
  for (const item of manifest.tabBar?.list ?? [])
    if (!main.includes(item.pagePath)) throw new Error('Tab page must stay in the main package')
  return { roots, main, routes }
}

export function packageOwner(path, roots) {
  return roots.find((root) => path.startsWith(`${root}/`)) ?? '__APP__'
}

export function readBuildFiles(directory) {
  const files = new Map()
  function walk(relative = '') {
    for (const entry of readdirSync(resolve(directory, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) throw new Error(`Build must not contain a symlink: ${name}`)
      if (entry.isDirectory()) walk(name)
      else if (entry.isFile()) files.set(name, readFileSync(resolve(directory, name)))
    }
  }
  walk()
  return files
}

export function auditMiniapp(files, sourceManifest, options = {}) {
  const issues = []
  const rawApp = files.get('app.json')
  if (!rawApp) throw new Error('Missing app.json; build the mini program first')
  const built = pageManifest(JSON.parse(rawApp.toString()))
  const source = pageManifest(sourceManifest)
  for (const path of ['app.js', 'app.wxss'])
    if (!files.has(path)) issues.push(`Missing app artifact: ${path}`)
  if (JSON.stringify([...built.routes].sort()) !== JSON.stringify([...source.routes].sort()))
    issues.push('Built page routes differ from src/pages.json')
  if (built.main[0] !== source.main[0]) issues.push('Launch page changed')
  if (JSON.stringify([...built.roots].sort()) !== JSON.stringify([...source.roots].sort()))
    issues.push('Built subpackage roots differ from src/pages.json')
  if (JSON.stringify([...built.main].sort()) !== JSON.stringify([...source.main].sort()))
    issues.push('Built main pages differ from src/pages.json')

  const packageSizes = new Map(['__APP__', ...built.roots].map((root) => [root, 0]))
  const digest = createHash('sha256')
  let references = 0
  let compilerPageAnchors = 0
  function checkReference(from, specifier, extensions = [''], compilerAnchor = false) {
    // No remote/plugin modules are currently used. Explicitly fail rather than silently approve.
    if (/^[a-z]+:/i.test(specifier) || specifier.includes('{{')) {
      issues.push(`Unsupported dependency: ${from} -> ${specifier}`)
      return
    }
    const target = posix.normalize(
      specifier.startsWith('/') ? specifier.slice(1) : posix.join(posix.dirname(from), specifier)
    )
    const found = extensions.map((ext) => `${target}${ext}`).find((path) => files.has(path))
    if (!found) {
      issues.push(`Missing dependency: ${from} -> ${specifier}`)
      return
    }
    references++
    if (compilerAnchor && built.routes.includes(found.replace(/\.js$/, ''))) {
      compilerPageAnchors++
      return
    }
    const sourceOwner = packageOwner(from, built.roots)
    const targetOwner = packageOwner(found, built.roots)
    if (targetOwner !== '__APP__' && sourceOwner !== targetOwner)
      issues.push(`Illegal cross-package dependency: ${from} -> ${found}`)
  }
  for (const [path, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    if (/(?:^|\/)water-index\//i.test(path) || /\.osm\.pbf$/i.test(path))
      issues.push(`Shoreline data must be served remotely: ${path}`)
    const owner = packageOwner(path, built.roots)
    packageSizes.set(owner, packageSizes.get(owner) + bytes.length)
    digest.update(path).update('\0').update(bytes).update('\0')
    if (path.endsWith('.js')) {
      const code = bytes.toString()
      // uni-mp-vite/pagesJson injects `if (!Math) { import(page) }` to emit page
      // entries. Production minifies it to this unreachable anchor, optionally
      // projecting the exported namespace of a page. Only
      // declared page entries in this guard are exempt from runtime ownership;
      // still check their existence. An ordinary app.js require is NOT exempt.
      const anchors =
        path === 'app.js'
          ? [
              ...code.matchAll(
                /(?:^|;)Math\|\|\((?:Promise\.resolve\(\)\.then\(\(\)=>require\("[^"]+"\)\)(?:\.then\(([a-zA-Z_$][\w$]*)=>\1\.[\w$]+_exports\))?,?)+\);/g
              )
            ]
          : []
      for (const match of code.matchAll(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g)) {
        const isAnchor = anchors.some(
          (anchor) => match.index >= anchor.index && match.index < anchor.index + anchor[0].length
        )
        checkReference(path, match[2], ['', '.js', '/index.js'], isAnchor)
      }
    } else if (path.endsWith('.wxss')) {
      for (const match of bytes.toString().matchAll(/@import\s+(['"])([^'"]+)\1/g))
        checkReference(path, match[2])
    } else if (path.endsWith('.wxml')) {
      for (const match of bytes
        .toString()
        .matchAll(/<(?:import|include|wxs)\b[^>]*\bsrc=(['"])([^'"]+)\1/g))
        checkReference(path, match[2])
    } else if (path.endsWith('.json')) {
      const config = JSON.parse(bytes.toString())
      for (const target of Object.values(config.usingComponents ?? {}))
        for (const ext of ['.js', '.json', '.wxml']) checkReference(path, `${target}${ext}`)
    }
  }
  for (const route of built.routes)
    for (const ext of ['.js', '.json', '.wxml'])
      if (!files.has(`${route}${ext}`)) issues.push(`Missing page artifact: ${route}${ext}`)
  const totalBytes = [...packageSizes.values()].reduce((sum, size) => sum + size, 0)
  const packageBudget = options.packageBudget ?? PACKAGE_BUDGET
  for (const [root, size] of packageSizes)
    if (size > packageBudget) issues.push(`${root} exceeds the local raw-file budget`)
  if (totalBytes > (options.totalBudget ?? TOTAL_BUDGET))
    issues.push('Total exceeds the local raw-file budget')
  const css = files.get('app.wxss')?.toString() ?? ''
  const fontFaces = [...css.matchAll(/@font-face\s*\{[^}]*\}/g)].map((match) => ({
    family: match[0].match(/font-family\s*:\s*([^;]+)/)?.[1] ?? 'unknown',
    bytes: Buffer.byteLength(match[0])
  }))
  return {
    measurement: 'raw-build-files-not-wechat-upload-size',
    passed: issues.length === 0,
    files: files.size,
    routes: built.routes.length,
    mainPages: built.main,
    packageBudget,
    totalBytes,
    packages: Object.fromEntries(packageSizes),
    references,
    compilerPageAnchors,
    sha256: digest.digest('hex'),
    fontFaces,
    largestFiles: [...files]
      .map(([path, bytes]) => ({ path, bytes: bytes.length }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 12),
    issues
  }
}
