// Target-parser validation only: invokes WeChat DevTools' official wcc executable.
// It does not build the app, connect to DevTools, or publish anything.
// Example (repeat --file for more targets):
// node scripts/check-miniapp-wxml.mjs --compiler <wcc.exe> --root dist/build/mp-weixin \
//   --file pages/map/components/NativeWaterMap.wxml
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
function values(name) {
  return args.flatMap((value, index) => {
    if (value !== name) return []
    const next = args[index + 1]
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${name}`)
    return [next]
  })
}
if (args.includes('--help')) {
  console.log('Usage: node scripts/check-miniapp-wxml.mjs --compiler <wcc.exe> [--root <built-miniapp>] --file <relative.wxml>... [--regression-source <source.wxs>] [--artifacts <directory>]')
  process.exit(0)
}
const supported = new Set(['--compiler', '--root', '--file', '--regression-source', '--artifacts'])
for (let index = 0; index < args.length; index += 2) assert.ok(supported.has(args[index]), `Unknown option: ${args[index]}`)
const compilerArgument = values('--compiler')[0] || process.env.WECHAT_WXML_COMPILER
assert.ok(compilerArgument, 'Provide --compiler or WECHAT_WXML_COMPILER with the official WeChat DevTools wcc.exe path.')
const compiler = resolve(compilerArgument), root = resolve(values('--root')[0] || 'dist/build/mp-weixin')
assert.ok(existsSync(compiler) && statSync(compiler).isFile(), 'The configured WXML compiler must be an existing executable.')
const targets = values('--file')
assert.ok(targets.length, 'Provide at least one --file relative to --root; this check never silently skips targets.')
const artifacts = resolve(values('--artifacts')[0] || 'artifacts/miniapp-acceptance/wxml')
mkdirSync(artifacts, { recursive: true })

const help = spawnSync(compiler, ['--help'], { windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 })
const compilerHelp = `${help.stdout || ''}${help.stderr || ''}`.trim()
assert.ok(!help.error && compilerHelp.includes('Wechat WXML Compiler'), 'The executable did not identify itself as the WeChat WXML compiler.')

function inside(directory, file) {
  const path = relative(directory, file)
  assert.ok(path && !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`), `Dependency escapes the selected root: ${file}`)
  return path.replaceAll('\\', '/')
}
function dependencies(directory, entry) {
  const files = new Set()
  function visit(file) {
    const name = inside(directory, file)
    if (files.has(name)) return
    assert.ok(existsSync(file) && statSync(file).isFile(), `Missing template/script dependency: ${name}`)
    assert.ok(/\.(wxml|wxs)$/.test(name), `Unsupported dependency type: ${name}`)
    files.add(name)
    const source = readFileSync(file, 'utf8')
    const references = name.endsWith('.wxml')
      ? [...source.matchAll(/<(?:wxs|import|include)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/g)].map(match => match[1])
      : [...source.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)].map(match => match[1])
    for (const reference of references) {
      assert.ok(!reference.includes('{{') && !/^[a-z]+:/i.test(reference), `Only static local dependencies may be compiled: ${reference}`)
      visit(reference.startsWith('/') ? resolve(directory, `.${reference}`) : resolve(dirname(file), reference))
    }
  }
  visit(resolve(directory, entry))
  return [...files]
}
function compile(directory, entry, output) {
  // wcc does not load a referenced .wxs from disk by itself. Supply the full
  // dependency closure as FILES, without going through a shell or a batch file.
  const files = dependencies(directory, entry)
  const arguments_ = ['-o', output, ...files.map(file => `./${file}`)]
  writeFileSync(output, '') // A previous run's output must never satisfy this run.
  const result = spawnSync(compiler, arguments_, { cwd: directory, windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 })
  return {
    root: directory, entry, files, arguments: arguments_, exitCode: result.status,
    error: result.error?.message || '', diagnostics: `${result.stdout || ''}${result.stderr || ''}`.trim(),
    passed: !result.error && result.status === 0 && existsSync(output) && statSync(output).size > 0,
  }
}

const compiled = targets.map((entry, index) => {
  assert.ok(entry.endsWith('.wxml'), '--file must name a WXML template.')
  return compile(root, entry, resolve(artifacts, `target-${index + 1}-compiled.js`))
})
let regression
const regressionSource = values('--regression-source')[0]
if (regressionSource) {
  const sourcePath = resolve(regressionSource), source = readFileSync(sourcePath, 'utf8')
  const literal = /(?<![\w.])0\.5\b/
  const match = literal.exec(source)
  assert.ok(match, 'The real WXS source no longer contains the 0.5 regression anchor; update this regression deliberately.')
  const positiveRoot = resolve(artifacts, 'leading-decimal', 'positive'), negativeRoot = resolve(artifacts, 'leading-decimal', 'negative')
  const template = '<wxs module="waterGesture" src="./gesture.wxs"/><view gesture="{{camera}}" change:gesture="{{waterGesture.sync}}" bindtouchstart="{{waterGesture.start}}" bindtouchmove="{{waterGesture.move}}" bindtouchend="{{waterGesture.end}}" bindtouchcancel="{{waterGesture.cancel}}"><view class="amap-water-gesture__layer"/></view>\n'
  for (const directory of [positiveRoot, negativeRoot]) { mkdirSync(directory, { recursive: true }); writeFileSync(resolve(directory, 'index.wxml'), template) }
  writeFileSync(resolve(positiveRoot, 'gesture.wxs'), source)
  const negativeSource = source.slice(0, match.index) + '.5' + source.slice(match.index + match[0].length)
  writeFileSync(resolve(negativeRoot, 'gesture.wxs'), negativeSource)
  const positive = compile(positiveRoot, 'index.wxml', resolve(artifacts, 'leading-decimal-positive.js'))
  const negative = compile(negativeRoot, 'index.wxml', resolve(artifacts, 'leading-decimal-negative.js'))
  regression = {
    source: sourcePath, sourceSha256: createHash('sha256').update(source).digest('hex'),
    mutation: 'Only change the real source numeric literal 0.5 to .5.',
    positive, negative,
    passed: positive.passed && !negative.error && negative.exitCode !== 0 && /Unexpected token\s+[`'"]?\./.test(negative.diagnostics),
  }
}
const report = {
  checkedAt: new Date().toISOString(), compiler, compilerVersion: compilerHelp.split(/\r?\n/)[0],
  compiled, regression,
  passed: compiled.every(result => result.passed) && (!regression || regression.passed),
  boundary: 'Official wcc target-parser compilation of existing WXML/WXS only; no app build, SDK session, or phone gesture/FPS acceptance.',
}
writeFileSync(resolve(artifacts, 'wxml-result.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ passed: report.passed, targets: compiled.map(({ entry, passed, exitCode }) => ({ entry, passed, exitCode })), regression: regression && { passed: regression.passed, positiveExitCode: regression.positive.exitCode, negativeExitCode: regression.negative.exitCode, negativeDiagnostic: regression.negative.diagnostics } }, null, 2))
if (!report.passed) {
  for (const result of [...compiled, ...(regression ? [regression.positive] : [])]) if (!result.passed) console.error(result.error || result.diagnostics)
  if (regression && !regression.passed) console.error('The native leading-decimal regression did not behave as expected.')
  process.exitCode = 1
}
