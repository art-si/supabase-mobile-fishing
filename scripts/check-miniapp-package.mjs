import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applicationRoot } from './mobile-pro.mjs'
import { auditMiniapp, readBuildFiles } from './miniapp-package.mjs'

const args = process.argv.slice(2)
const reportOnly = args.includes('--report-only')
const baseline = args.includes('--baseline')
const directory = resolve(applicationRoot, 'dist/build/mp-weixin')
const source = JSON.parse(readFileSync(resolve(applicationRoot, 'src/pages.json'), 'utf8'))
const result = auditMiniapp(readBuildFiles(directory), source)
const artifacts = resolve(applicationRoot, 'artifacts/miniapp-package')
mkdirSync(artifacts, { recursive: true })
writeFileSync(
  resolve(artifacts, baseline ? 'baseline.json' : 'result.json'),
  JSON.stringify({ ...result, checkedAt: new Date().toISOString() }, null, 2) + '\n'
)
console.log(JSON.stringify(result, null, 2))
console.log(
  'Local raw-file audit only. WeChat DevTools package analysis and real-device validation are still required.'
)
if (!result.passed && !reportOnly) process.exitCode = 1
