import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import ts from 'typescript'
import { resolveMobileProRoot } from '../scripts/mobile-pro.mjs'

function nativeSource(source: string) {
  const enabled = [true]
  return source.split('\n').filter(line => {
    const directive = line.match(/^\s*\/\/ #(ifdef|ifndef|endif)(?:\s+(\S+))?/)
    if (!directive) return enabled.at(-1)
    if (directive[1] === 'endif') enabled.pop()
    else enabled.push(Boolean(enabled.at(-1)) && (directive[1] === 'ifdef' ? directive[2] === 'MP-WEIXIN' : directive[2] !== 'MP-WEIXIN'))
    return false
  }).join('\n')
}
function runtime() {
  const modules = new Map<string, any>(), native: any[] = [], uploads: any[] = [], hideListeners = new Set<() => void>()
  let page: any = { route: 'pages/post/compose' }
  const uni = { chooseMedia: (options: any) => native.push(options), onAppHide: (fn: () => void) => hideListeners.add(fn), offAppHide: (fn: () => void) => hideListeners.delete(fn) }
  const root = resolve(resolveMobileProRoot(), 'packages/mobile-core/src')
  function load(name: string): any {
    if (modules.has(name)) return modules.get(name)
    const exports: any = {}; modules.set(name, exports)
    const source = nativeSource(readFileSync(resolve(root, `${name}.ts`), 'utf8'))
    runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      exports, uni, getCurrentPages: () => [page], setTimeout, clearTimeout,
      require: (id: string) => id === 'vue' ? Vue : load(id.replace(/^\.\.\//, '').replace(/^\.\//, '')),
    })
    return exports
  }
  const session = load('media-picker-session')
  const { descriptor } = parse(nativeSource(readFileSync(resolve(root, 'components/MobileMediaUploader.vue'), 'utf8')))
  const script = compileScript(descriptor, { id: 'native-picker-contract' }), componentModule: any = {}
  const unrelated: Record<string, any> = {
    '../action-keyboard': {},
    '../video-poster': { captureVideoPoster: async () => '', clearVideoPosterScope() {}, rememberVideoPoster() {}, createVideoPosterDelivery: () => (apply: () => void) => Promise.resolve(apply()) },
  }
  runInNewContext(ts.transpileModule(script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: componentModule, uni, setTimeout, clearTimeout,
    require: (id: string) => id === 'vue' ? Vue : id.endsWith('.vue') ? {} : id in unrelated ? unrelated[id] : load(id.replace(/^\.\.\//, '')),
  })
  const component = componentModule.default; component.render = () => null
  const photos = Vue.ref<any[]>([]), active = Vue.ref(true), scope = Vue.ref(1), disabled = Vue.ref(false), uploader = Vue.ref<any>()
  const renderer = Vue.createRenderer({
    patchProp() {}, insert() {}, remove() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null,
  })
  const app = renderer.createApp({ render: () => Vue.h(component, {
    ref: uploader, modelValue: photos.value, 'onUpdate:modelValue': (value: any[]) => { photos.value = value },
    scope: scope.value, active: active.value, disabled: disabled.value, accept: ['image', 'video'], limit: 9,
    uploadImage: async (path: string) => { uploads.push(path); return { id: `uploaded-${uploads.length}`, path, kind: 'image', width: 80, height: 80 } },
    uploadVideo: async (path: string) => { uploads.push(path); return { id: `uploaded-${uploads.length}`, path, kind: 'video', duration: 2 } },
    errorText: (error: any) => error.code || String(error),
  }) })
  app.mount({})
  const tick = async () => { for (let i = 0; i < 8; i++) { await Vue.nextTick(); await Promise.resolve() } }
  return { session, native, uploads, photos, active, scope, disabled, uploader, tick,
    hide(protectedHandoff: boolean) { if (!protectedHandoff || !session.preserveMediaPickerPage()) active.value = false; hideListeners.forEach(fn => fn()) },
    show(protectedHandoff: boolean) { active.value = true; if (protectedHandoff) session.resumeMediaPickerPage() },
    navigate() { page = { route: 'pages/settings/index' }; active.value = false },
    complete(index = 0, kind = 'image') { native[index].success({ tempFiles: [{ tempFilePath: `wxfile://selected-${index}.${kind === 'video' ? 'mp4' : 'jpg'}`, fileType: kind, size: 1234, duration: kind === 'video' ? 2 : undefined }] }) },
    dispose: () => app.unmount(),
  }
}

test('reproduces old compose lifecycle: native picker hide/show invalidates the real uploader and discards its result', async () => {
  const h = runtime()
  try {
    const choosing = h.uploader.value.choose(); h.hide(false); await h.tick(); h.show(false); await h.tick(); h.complete(); await choosing; await h.tick()
    assert.equal(h.photos.value.length, 0); assert.equal(h.uploads.length, 0)
  } finally { h.dispose() }
})
test('shared page handoff accepts camera/album and video after either callback/show ordering, once only', async () => {
  for (const callbackFirst of [true, false]) for (const kind of ['image', 'video']) {
    const h = runtime()
    try {
      const choosing = h.uploader.value.choose(kind === 'video' ? 'album' : 'camera')
      h.hide(true); await h.tick(); assert.equal(h.active.value, true)
      if (!callbackFirst) { h.show(true); await h.tick() }
      h.complete(0, kind); await choosing; await h.tick()
      if (callbackFirst) { h.show(true); await h.tick() }
      assert.equal(h.photos.value.length, 1); assert.equal(h.photos.value[0].kind, kind); assert.equal(h.uploads.length, 1)
      assert.equal(h.photos.value[0].asset.kind, kind); assert.equal(h.uploader.value.choosing, false)
      assert.equal(h.session.resumeMediaPickerPage(), false)
    } finally { h.dispose() }
  }
})
test('real departure or account scope change still rejects a late native selection and never uploads it', async () => {
  for (const boundary of ['route', 'account']) {
    const h = runtime()
    try {
      const choosing = h.uploader.value.choose('album'); h.hide(true); await h.tick()
      if (boundary === 'route') h.navigate()
      else { h.scope.value++; h.disabled.value = true }
      await h.tick(); h.complete(); await choosing; await h.tick()
      assert.equal(h.photos.value.length, 0); assert.equal(h.uploads.length, 0)
    } finally { h.dispose() }
  }
})
test('native cancel releases the handoff and permits the next selection; denial retains its distinct recovery code', async () => {
  const h = runtime()
  try {
    const first = h.uploader.value.choose('album'); h.hide(true); h.native[0].fail({ errMsg: 'chooseMedia:fail cancel' }); await first; h.show(true); await h.tick()
    assert.equal(h.photos.value.length, 0); assert.equal(h.uploader.value.choosing, false)
    const second = h.uploader.value.choose('album'); h.native[1].fail({ errMsg: 'chooseMedia:fail api scope is not declared in the privacy agreement', errCode: 112 })
    await second; await h.tick(); assert.equal(h.uploader.value.choosing, false); assert.equal(h.native.length, 2)
    assert.equal(h.uploader.value.$.setupState.selectionNotice, 'MEDIA_PRIVACY_UNDECLARED')
    assert.equal(h.session.preserveMediaPickerPage(), false)
  } finally { h.dispose() }
})
