import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { resolveMobileProRoot } from '../scripts/mobile-pro.mjs'

function nativePicker() {
  const file = resolve(resolveMobileProRoot(), 'packages/mobile-core/src/media-choose.ts')
  // Match the actual non-H5 branch; this is an API contract, not a native device test.
  const source = readFileSync(file, 'utf8').replace(/\/\/ #ifdef H5[\s\S]*?\/\/ #endif/g, '')
  const exports: any = {}, calls: any[] = []
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, uni: { chooseMedia: (options: any) => calls.push(options) } })
  return { choose: exports.chooseMediaFiles, calls }
}
test('native camera asks for exactly one image from the camera and retains genuine file metadata', async () => {
  const picker = nativePicker(), result = picker.choose(6, ['image', 'video'], 'camera'), call = picker.calls[0]
  assert.equal(call.count, 1)
  assert.deepEqual(Array.from(call.mediaType), ['image'])
  assert.deepEqual(Array.from(call.sourceType), ['camera'])
  call.success({ tempFiles: [{ tempFilePath: 'wxfile://captured.jpg', fileType: 'image', size: 1234 }] })
  const chosen = await result
  assert.equal(chosen.length, 1); assert.equal(chosen[0].path, 'wxfile://captured.jpg'); assert.equal(chosen[0].kind, 'image'); assert.equal(chosen[0].size, 1234)
})
test('native album keeps mixed image/video selection and real thumbnail path', async () => {
  const picker = nativePicker(), result = picker.choose(4, ['image', 'video'], 'album'), call = picker.calls[0]
  assert.equal(call.count, 4); assert.deepEqual(Array.from(call.sourceType), ['album']); assert.deepEqual(Array.from(call.mediaType), ['image', 'video'])
  call.success({ tempFiles: [{ tempFilePath: 'wxfile://clip.mp4', fileType: 'video', size: 3000, duration: 5, thumbTempFilePath: 'wxfile://real-frame.jpg' }] })
  const chosen = await result
  assert.equal(chosen[0].poster, 'wxfile://real-frame.jpg'); assert.equal(chosen[0].duration, 5); assert.equal(chosen[0].kind, 'video')
})
test('omitting source retains the existing combined chooser contract', async () => {
  const picker = nativePicker(), result = picker.choose(3), call = picker.calls[0]
  assert.deepEqual(Array.from(call.sourceType), ['album', 'camera']); assert.equal(call.count, 3)
  call.success({ tempFiles: [] }); assert.equal((await result).length, 0)
})
test('native chooser cancellation resolves empty without a visible error', async () => {
  const picker = nativePicker(), result = picker.choose(1, ['image'], 'camera')
  picker.calls[0].fail({ errMsg: 'chooseMedia:fail cancel' })
  assert.equal((await result).length, 0)
})
test('native permission/provider failure is distinguishable from user cancellation', async () => {
  const picker = nativePicker(), result = picker.choose(2, ['image', 'video'], 'album')
  picker.calls[0].fail({ errMsg: 'chooseMedia:fail authorize denied' })
  await assert.rejects(result, (error: any) => error.code === 'MEDIA_SELECTION_FAILED')
})
test('no chooser opens without capacity or when a video-only consumer asks to take a photo', async () => {
  const picker = nativePicker()
  assert.equal((await picker.choose(0, ['image'], 'camera')).length, 0)
  assert.equal((await picker.choose(5, ['video'], 'camera')).length, 0)
  assert.equal(picker.calls.length, 0)
})
