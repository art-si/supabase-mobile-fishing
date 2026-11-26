import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { nativePicker } from './fixtures/native-media-picker'
import { userErrorText } from '../src/domain/user-errors'

function adapter(options: { native?: boolean; plugin?: boolean; mini?: boolean; failure?: unknown; blob?: Blob; responseOk?: boolean; capture?: () => Promise<unknown> } = {}) {
  let source = readFileSync(new URL('../src/platforms/comment-camera.ts', import.meta.url), 'utf8')
  source = source.replace(options.mini ? /\/\/ #ifndef MP-WEIXIN[\s\S]*?\/\/ #endif/g : /\/\/ #ifdef MP-WEIXIN[\s\S]*?\/\/ #endif/g, '')
  const exports: any = {}, requests: any[] = [], imports: string[] = [], released: string[] = [], blobs: Blob[] = []
  const picker = nativePicker()
  let page = { route: 'pages/post/detail' }
  const modules: Record<string, unknown> = {
    '@capacitor/core': { Capacitor: { isNativePlatform: () => options.native ?? false, isPluginAvailable: () => options.plugin ?? true } },
    '@mobile-core/media-choose': { chooseMediaFiles: picker.choose },
    '@capacitor/camera': {
      Camera: { getPhoto: async (input: unknown) => { requests.push(input); if (options.failure) throw options.failure; return options.capture ? options.capture() : { webPath: 'capacitor://localhost/_capacitor_file_/capture.jpeg', format: 'jpeg' } } },
      CameraSource: { Camera: 'CAMERA' }, CameraResultType: { Uri: 'uri' }, CameraDirection: { Rear: 'REAR' }
    }
  }
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: (id: string) => { imports.push(id); assert.ok(id in modules, id); return modules[id] }, Blob, Uint8Array, getCurrentPages: () => [page],
    fetch: async () => ({ ok: options.responseOk ?? true, blob: async () => options.blob ?? new Blob([new Uint8Array([255, 216, 255, 224, 0, 16])], { type: 'application/octet-stream' }) }),
    URL: { createObjectURL: (blob: Blob) => { blobs.push(blob); return 'blob:captured' }, revokeObjectURL: (url: string) => released.push(url) }
  })
  return {
    api: exports, requests, imports, released, picker, blobs, page: () => page,
    setPage(next: { route: string }) { page = next; picker.setPage(next) }
  }
}

test('plain H5 hides camera and defensively refuses capture without loading or invoking Camera', async () => {
  const state = adapter()
  assert.equal(state.api.canUseCamera(), false)
  await assert.rejects(state.api.chooseCommentCamera(), (error: any) => error.code === 'CAMERA_UNAVAILABLE')
  assert.equal(state.imports.includes('@capacitor/camera'), false)
  assert.equal(state.requests.length, 0)
})

test('native camera uses the real camera source and returns measured JPEG bytes with one release', async () => {
  const state = adapter({ native: true })
  assert.equal(state.api.canUseCamera(), true)
  const files = await state.api.chooseCommentCamera(), request = state.requests[0]
  assert.equal(request.source, 'CAMERA'); assert.equal(request.resultType, 'uri')
  assert.equal(request.saveToGallery, false); assert.equal(request.allowEditing, false)
  assert.equal(request.direction, 'REAR'); assert.equal(request.width, 2048)
  assert.equal(files.length, 1); assert.equal(files[0].kind, 'image'); assert.equal(files[0].size, 6)
  assert.equal(state.blobs[0].type, 'image/jpeg')
  files[0].release(); files[0].release(); assert.deepEqual(state.released, ['blob:captured'])
})

test('camera cancellation is quiet and denied permission has actionable localized recovery', async () => {
  for (const failure of [{ message: 'User cancelled photos app' }, { code: 'OS-PLUG-CAMR-0006' }]) {
    const state = adapter({ native: true, failure })
    assert.equal((await state.api.chooseCommentCamera()).length, 0)
    assert.equal(state.blobs.length, 0)
    assert.equal(state.api.isCommentCameraHandoff(), false)
  }
  const state = adapter({ native: true, failure: { message: 'User denied access to camera' } })
  await assert.rejects(state.api.chooseCommentCamera(), (error: any) => error.code === 'CAMERA_PERMISSION_DENIED' && /系统设置.*再点拍照重试/.test(userErrorText(error)))
  assert.equal(state.api.isCommentCameraHandoff(), false)
})

test('camera rejects unavailable plugins, unreadable images and oversized or unsupported bytes', async () => {
  const unavailable = adapter({ native: true, plugin: false })
  await assert.rejects(unavailable.api.chooseCommentCamera(), (error: any) => error.code === 'CAMERA_UNAVAILABLE')
  assert.equal(unavailable.requests.length, 0)
  for (const [options, code] of [
    [{ responseOk: false }, 'CAMERA_READ_FAILED'],
    [{ blob: new Blob([]) }, 'CAMERA_READ_FAILED'],
    [{ blob: new Blob(['not an image']) }, 'IMAGE_UNSUPPORTED'],
    [{ blob: new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]) }, 'IMAGE_INPUT_TOO_LARGE']
  ] as const) {
    const state = adapter({ native: true, ...options })
    await assert.rejects(state.api.chooseCommentCamera(), (error: any) => error.code === code)
    assert.equal(state.blobs.length, 0)
  }
})

test('mini program camera delegates one image to the existing real chooseMedia adapter', async () => {
  const state = adapter({ mini: true })
  assert.equal(state.api.canUseCamera(), true)
  const pending = state.api.chooseCommentCamera()
  const [call] = state.picker.calls
  assert.equal(call.count, 1)
  assert.deepEqual(Array.from(call.mediaType), ['image'])
  assert.deepEqual(Array.from(call.sourceType), ['camera'])
  call.success({ tempFiles: [{ tempFilePath: 'wxfile://captured.jpg', fileType: 'image', size: 456 }] })
  assert.equal((await pending)[0].path, 'wxfile://captured.jpg')
  assert.equal(state.imports.includes('@capacitor/camera'), false)
  assert.equal(state.api.isCommentCameraHandoff(), false)
})

test('native handoff exists only while capture is pending on its original page and clears after return', async () => {
  let finish!: (photo: unknown) => void
  const pending = new Promise(resolve => { finish = resolve })
  const state = adapter({ native: true, capture: () => pending })
  assert.equal(state.api.isCommentCameraHandoff(), false)
  const result = state.api.chooseCommentCamera()
  assert.equal(state.api.isCommentCameraHandoff(), true)
  finish({ webPath: 'capacitor://localhost/_capacitor_file_/capture.jpeg' })
  const files = await result
  assert.equal(files.length, 1)
  assert.equal(state.api.isCommentCameraHandoff(), false)
  files[0].release(); assert.equal(state.released.length, 1)
})

test('native capture never transfers its image to another page instance or route', async () => {
  for (const changeInstance of [true, false]) {
    let finish!: (photo: unknown) => void
    const pending = new Promise(resolve => { finish = resolve })
    const state = adapter({ native: true, capture: () => pending })
    const result = state.api.chooseCommentCamera()
    if (changeInstance) state.setPage({ route: 'pages/post/detail' })
    else state.page().route = 'pages/profile/index'
    assert.equal(state.api.isCommentCameraHandoff(), false)
    finish({ webPath: 'capacitor://localhost/_capacitor_file_/capture.jpeg' })
    assert.equal((await result).length, 0)
    assert.equal(state.blobs.length, 0)
    assert.equal(state.api.isCommentCameraHandoff(), false)
  }
})

test('mini camera shares the pending page with the album and consumes its return only once', async () => {
  const state = adapter({ mini: true })
  const { picker } = state
  const result = state.api.chooseCommentCamera()
  await assert.rejects(picker.choose(1, ['image'], 'album'), (error: any) => error.code === 'MEDIA_SELECTION_IN_PROGRESS')
  assert.equal(picker.calls.length, 1)
  picker.hide()
  assert.equal(picker.session.preserveMediaPickerPage(), true)
  picker.calls[0].success({ tempFiles: [{ tempFilePath: 'wxfile://captured.jpg', fileType: 'image', size: 456 }] })
  assert.equal((await result).length, 1)
  assert.equal(picker.session.resumeMediaPickerPage(), true)
  assert.equal(picker.session.resumeMediaPickerPage(), false)
  assert.equal(picker.listeners(), 0)
})

test('a replacement page can select while the previous page waits; late results stay on their owner', async () => {
  const state = adapter({ mini: true })
  const { picker } = state
  const first = state.api.chooseCommentCamera()
  picker.hide()
  state.setPage({ route: 'pages/post/detail' })
  assert.equal(picker.session.preserveMediaPickerPage(), false)
  const current = state.api.chooseCommentCamera()
  picker.calls[0].success({ tempFiles: [{ tempFilePath: 'wxfile://old.jpg', fileType: 'image', size: 123 }] })
  assert.equal((await first).length, 0)
  picker.calls[1].fail({ errMsg: 'chooseMedia:fail authorize denied' })
  await assert.rejects(current, (error: any) => error.code === 'MEDIA_PERMISSION_DENIED' && /微信设置/.test(userErrorText(error)))
  assert.equal(picker.session.preserveMediaPickerPage(), false)
  assert.equal(picker.listeners(), 0)
})
