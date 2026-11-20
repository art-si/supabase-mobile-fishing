import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { auditMiniapp, readBuildFiles } from './miniapp-package.mjs'

const directory = process.argv[2] || 'dist/review/media-spot-final/mp-weixin'
const files = readBuildFiles(directory)
const result = auditMiniapp(files, JSON.parse(readFileSync('src/pages.json', 'utf8')))
const decoderFiles = [...files].filter(([path, bytes]) =>
  /\.wasm$|heif-worker/.test(path) ||
  (path.endsWith('.js') && /HeifDecoder|libheif-bundle|mediabunny/.test(bytes.toString()))
).map(([path]) => path)
const report = { ...result, browserDecodersExcluded: decoderFiles.length === 0, decoderFiles }
writeFileSync('artifacts/final-miniapp-audit-20261120.json', JSON.stringify(report, null, 2))
assert.ok(result.passed, result.issues.join('\n'))
assert.deepEqual(decoderFiles, [], 'Browser-only media decoders must not enter the miniapp')
console.log(JSON.stringify({ passed: true, mainBytes: result.packages.__APP__, totalBytes: result.totalBytes, browserDecodersExcluded: true }))
