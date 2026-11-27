import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { userErrorText } from '../src/domain/user-errors'

function adapter(options: { native?: boolean; plugin?: boolean; mini?: boolean; failure?: unknown; blob?: Blob; responseOk?: boolean; capture?: () => Promise<unknown>; miniCapture?: () => Promise<unknown> } = {}) {
  let source = readFileSync(new URL('../src/platforms/comment-camera.ts', import.meta.url), 'utf8')
  source = source.replace(options.mini ? /\/\/ #ifndef MP-WEIXIN[\s\S]*?\/\/ #endif/g : /\/\/ #ifdef MP-WEIXIN[\s\S]*?\/\/ #endif/g, '')
  const exports: any = {}, requests: any[] = [], imports: string[] = [], released: string[] = [], miniCalls: any[] = [], blobs: Blob[] = []
  const hideListeners = new Set<() => void>(), showListeners = new Set<() => void>()
  let page = { route: 'pages/post/detail' }
  const modules: Record<string, unknown> = {
    '@capacitor/core': { Capacitor: { isNativePlatform: () => options.native ?? false, isPluginAvailable: () => options.plugin ?? true } },
    '@mobile-core/media-choose': { chooseMediaFiles: async (...args: any[]) => { miniCalls.push(args); return options.miniCapture ? options.miniCapture() : [{ path: 'wxfile://captured.jpg', kind: 'image', size: 456 }] } },
    '@capacitor/camera': {
      Camera: { getPhoto: async (input: unknown) => { requests.push(input); if (options.failure) throw options.failure; return options.capture ? options.capture() : { webPath: 'capacitor://localhost/_capacitor_file_/capture.jpeg', format: 'jpeg' } } },
      CameraSource: { Camera: 'CAMERA' }, CameraResultType: { Uri: 'uri' }, CameraDirection: { Rear: 'REAR' }
    }
  }
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: (id: string) => { imports.push(id); assert.ok(id in modules, id); return modules[id] }, Blob, Uint8Array, getCurrentPages: () => [page],
    uni: { onAppHide: (fn: () => void) => hideListeners.add(fn), offAppHide: (fn: () => void) => hideListeners.delete(fn), onAppShow: (fn: () => void) => showListeners.add(fn), offAppShow: (fn: () => void) => showListeners.delete(fn) },
    fetch: async () => ({ ok: options.responseOk ?? true, blob: async () => options.blob ?? new Blob([new Uint8Array([255, 216, 255, 224, 0, 16])], { type: 'application/octet-stream' }) }),
    URL: { createObjectURL: (blob: Blob) => { blobs.push(blob); return 'blob:captured' }, revokeObjectURL: (url: string) => released.push(url) }
  })
  return { api: exports, requests, imports, released, miniCalls, blobs, setPage: (next: { route: string }) => { page = next }, page: () => page, hide: () => hideListeners.forEach(fn => fn()), show: () => showListeners.forEach(fn => fn()), listeners: () => hideListeners.size + showListeners.size }
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
  assert.equal((await state.api.chooseCommentCamera())[0].path, 'wxfile://captured.jpg')
  const [count, kinds, source] = state.miniCalls[0]
  assert.equal(count, 1); assert.deepEqual(Array.from(kinds), ['image']); assert.equal(source, 'camera')
  assert.equal(state.imports.includes('@capacitor/camera'), false)
  assert.equal(state.api.isCommentCameraHandoff(), false)
})

test('mini album uses the same page handoff and retains requested count and media kinds', async () => {
  let finish!: (files: unknown) => void
  const state = adapter({ mini: true, miniCapture: () => new Promise(resolve => { finish = resolve }) })
  const result = state.api.chooseCommentMedia(4, ['image', 'video'], 'album')
  const [count, kinds, source] = state.miniCalls[0]
  assert.equal(count, 4); assert.deepEqual(Array.from(kinds), ['image', 'video']); assert.equal(source, 'album')
  assert.equal(state.api.preserveCommentCameraPage(), true)
  state.hide(); state.show()
  assert.equal(state.api.resumeCommentCameraPage(), true)
  finish([{ path: 'wxfile://album.jpg', kind: 'image', size: 100 }])
  assert.equal((await result)[0].path, 'wxfile://album.jpg')
  assert.equal(state.listeners(), 0); assert.equal(state.api.isCommentCameraHandoff(), false)
})

test('album callback before PageShow preserves the return once and discards a replacement page result', async () => {
  for (const leave of [false, true]) {
    let finish!: (files: unknown) => void, released = 0
    const state = adapter({ mini: true, miniCapture: () => new Promise(resolve => { finish = resolve }) })
    const result = state.api.chooseCommentMedia(1, ['image'], 'album')
    state.api.preserveCommentCameraPage()
    if (leave) state.setPage({ route: 'pages/spot/detail' })
    finish([{ path: 'wxfile://album.jpg', kind: 'image', size: 100, release: () => { released++ } }])
    assert.equal((await result).length, leave ? 0 : 1)
    assert.equal(released, leave ? 1 : 0)
    assert.equal(state.api.resumeCommentCameraPage(), !leave)
    assert.equal(state.api.resumeCommentCameraPage(), false)
  }
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

test('mini camera preserves PageHide before AppHide and stays owned until the result returns', async () => {
  let finish!: (files: unknown) => void
  const pending = new Promise(resolve => { finish = resolve })
  const state = adapter({ mini: true, miniCapture: () => pending })
  const result = state.api.chooseCommentCamera()
  assert.equal(state.api.isCommentCameraHandoff(), true)
  assert.equal(state.api.preserveCommentCameraPage(), true, 'PageHide can arrive before AppHide')
  assert.equal(state.listeners(), 1)
  state.hide(); assert.equal(state.api.isCommentCameraHandoff(), true)
  state.show(); assert.equal(state.api.isCommentCameraHandoff(), true, 'AppShow must not discard a pending image')
  assert.equal(state.api.resumeCommentCameraPage(), true)
  finish([{ path: 'wxfile://captured.jpg', kind: 'image', size: 456 }])
  assert.equal((await result).length, 1)
  assert.equal(state.api.isCommentCameraHandoff(), false); assert.equal(state.listeners(), 0)
  assert.equal(state.api.resumeCommentCameraPage(), false)
})

test('a camera callback before PageShow preserves the return refresh exactly once', async () => {
  let finish!: (files: unknown) => void
  const state = adapter({ mini: true, miniCapture: () => new Promise(resolve => { finish = resolve }) })
  const result = state.api.chooseCommentCamera()
  assert.equal(state.api.preserveCommentCameraPage(), true)
  finish([{ path: 'wxfile://captured.jpg', kind: 'image', size: 456 }])
  assert.equal((await result).length, 1)
  assert.equal(state.api.isCommentCameraHandoff(), false)
  assert.equal(state.api.resumeCommentCameraPage(), true)
  assert.equal(state.api.resumeCommentCameraPage(), false)
})

test('a returned camera never suppresses refresh on a replacement page', async () => {
  let finish!: (files: unknown) => void
  const state = adapter({ mini: true, miniCapture: () => new Promise(resolve => { finish = resolve }) })
  const result = state.api.chooseCommentCamera()
  state.api.preserveCommentCameraPage()
  finish([{ path: 'wxfile://captured.jpg', kind: 'image', size: 456 }]); await result
  state.setPage({ route: 'pages/post/detail' })
  assert.equal(state.api.resumeCommentCameraPage(), false)
})

test('mini camera discards another page result and always clears background listeners on rejection', async () => {
  let finish!: (files: unknown) => void, released = 0
  const pending = new Promise(resolve => { finish = resolve })
  const state = adapter({ mini: true, miniCapture: () => pending })
  const result = state.api.chooseCommentCamera()
  state.hide(); state.setPage({ route: 'pages/post/detail' })
  assert.equal(state.api.isCommentCameraHandoff(), false)
  finish([{ path: 'wxfile://captured.jpg', kind: 'image', size: 456, release: () => { released++ } }])
  assert.equal((await result).length, 0); assert.equal(released, 1); assert.equal(state.listeners(), 0)
  const denied = adapter({ mini: true, miniCapture: async () => { throw new Error('MEDIA_SELECTION_FAILED') } })
  await assert.rejects(denied.api.chooseCommentCamera(), /MEDIA_SELECTION_FAILED/)
  assert.equal(denied.api.isCommentCameraHandoff(), false); assert.equal(denied.listeners(), 0)
})
