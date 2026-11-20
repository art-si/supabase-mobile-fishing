import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { readBuildFiles } from './miniapp-package.mjs'

const argument = (name) => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}
const root = resolve(argument('--root') || 'dist/build/mp-weixin')
const compiler = argument('--compiler') || process.env.WECHAT_WXSS_COMPILER
if (!compiler) {
  throw new Error('Provide --compiler with the WeChat DevTools wcsc executable path.')
}
const styles = [...readBuildFiles(root).keys()].filter((file) => file.endsWith('.wxss'))
if (!styles.length) throw new Error('No built WXSS files found.')
const artifacts = resolve('artifacts/miniapp-acceptance')
mkdirSync(artifacts, { recursive: true })
const result = spawnSync(
  compiler,
  ['-lc', '-pc', String(styles.length), '-o', resolve(artifacts, 'wxss-compiled.txt'), ...styles],
  { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024 }
)
const report = {
  checkedAt: new Date().toISOString(),
  root,
  compiler: resolve(compiler),
  styles: styles.length,
  passed: !result.error && result.status === 0,
  exitCode: result.status,
  error: result.error?.message || '',
  diagnostics: `${result.stdout || ''}${result.stderr || ''}`.trim()
}
writeFileSync(resolve(artifacts, 'wxss-result.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ passed: report.passed, styles: report.styles, exitCode: report.exitCode }))
if (!report.passed) {
  console.error(report.error || report.diagnostics.slice(0, 12000))
  process.exitCode = 1
}
