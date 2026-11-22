import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { resolveMobileProRoot } from '../scripts/mobile-pro.mjs'

const file = resolve(resolveMobileProRoot(), 'packages/mobile-core/src/upload-progress.ts')
const exports: any = {}
runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports })
const { createUploadCancellation } = exports
test('linked cancellation works without native AbortController and aborts each listener once', () => {
  const parent = createUploadCancellation(), child = createUploadCancellation(parent.signal)
  let calls = 0
  child.signal.addEventListener('abort', () => calls++, { once: true })
  parent.abort(); parent.abort(); child.abort()
  assert.equal(child.signal.aborted, true); assert.equal(calls, 1)
})
test('disposing a link detaches the parent and an already-aborted parent is inherited', () => {
  const parent = createUploadCancellation(), child = createUploadCancellation(parent.signal)
  child.dispose(); parent.abort(); assert.equal(child.signal.aborted, false)
  const late = createUploadCancellation(parent.signal); assert.equal(late.signal.aborted, true)
})
test('removed or throwing subscribers cannot prevent the remaining abort cleanup', () => {
  const child = createUploadCancellation(); let calls = 0
  const removed = () => calls++
  child.signal.addEventListener('abort', removed); child.signal.removeEventListener('abort', removed)
  child.signal.addEventListener('abort', () => { throw new Error('subscriber fixture') })
  child.signal.addEventListener('abort', () => calls++)
  child.abort(); assert.equal(calls, 1)
})
