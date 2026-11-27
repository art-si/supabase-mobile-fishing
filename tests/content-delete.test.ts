import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { resolve } from 'node:path'
import ts from 'typescript'
import * as vue from 'vue'
import { resolveMobileProRoot } from '../scripts/mobile-pro.mjs'

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
function action(options: { type?: 'post' | 'spot' | 'trip'; owner?: string; userId?: string; showButton?: boolean; write?: () => Promise<void> } = {}) {
  const props = vue.reactive({ id: 'post-a', type: options.type ?? 'post', owner: options.owner ?? 'owner', disabled: false, title: '待删除鱼情', showButton: options.showButton })
  const auth = vue.reactive({ userId: options.userId ?? 'owner', context: 1 })
  const api: any = {}, writes: any[] = [], notifications: any[] = [], emits: any[] = [], toasts: any[] = []
  const hooks: Record<string, () => void> = {}
  let unmounted = () => {}
  const mutation = { busy: vue.ref(false), error: vue.ref(''), async run(task: () => Promise<void>) {
    if (this.busy.value) return
    this.busy.value = true; this.error.value = ''
    try { await task() } catch { this.error.value = '服务暂时不可用，请稍后重试' } finally { this.busy.value = false }
  } }
  const modules: Record<string, unknown> = {
    vue: { ...vue, onUnmounted: (fn: () => void) => { unmounted = fn } },
    '@dcloudio/uni-app': { onHide: (fn: () => void) => { hooks.hide = fn }, onShow: (fn: () => void) => { hooks.show = fn } },
    '@mobile-core/action-keyboard': {}, '@mobile-core/components/MobileIcon.vue': {}, '@mobile-core/components/MobileConfirmDialog.vue': {},
    '@/stores/auth': { useAuthStore: () => auth }, '@/composables/useMutation': { useMutation: () => mutation },
    '@/services/repository': { write: async (name: string, payload: unknown) => { writes.push({ name, payload }); await options.write?.() } },
    '@/services/content-deletion': { notifyContentDeleted: (value: unknown) => notifications.push(value) }
  }
  const scope = vue.effectScope()
  const source = readFileSync(new URL('../src/components/ContentDeleteAction.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1] + '\nexports.api={open,remove,close,confirm,owned,mutation};'
  scope.run(() => runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: api, require: (id: string) => { assert.ok(id in modules, id); return modules[id] },
    defineOptions: () => {}, defineProps: () => props, withDefaults: (value: any, defaults: any) => { for (const key of Object.keys(defaults)) if (value[key] === undefined) value[key] = defaults[key]; return value }, defineEmits: () => (name: string, value: unknown) => emits.push({ name, value }), defineExpose: () => {},
    uni: { showToast: (value: unknown) => toasts.push(value) }
  }))
  return { api: api.api, props, auth, writes, notifications, emits, toasts, hide: () => hooks.hide(), show: () => hooks.show(), dispose: () => { unmounted(); scope.stop() } }
}

test('opening and cancelling a delete never writes; only an explicit confirmation writes the owner target', async () => {
  const state = action()
  try {
    state.api.open(); assert.equal(state.api.confirm.value, true); assert.equal(state.writes.length, 0)
    state.api.close(); await state.api.remove(); assert.equal(state.writes.length, 0)
    state.api.open(); await state.api.remove()
    assert.equal(state.writes.length, 1)
    assert.equal(state.writes[0].name, 'delete_content')
    assert.deepEqual({ ...state.writes[0].payload }, { type: 'post', id: 'post-a' })
    assert.equal(state.notifications.length, 1)
    assert.equal(state.emits[0].name, 'deleted')
    assert.equal(state.api.confirm.value, false)
  } finally { state.dispose() }
})

test('a list without a visible button can still open its confirmation without native hidden attributes', async () => {
  const state = action({ showButton: false })
  try { state.api.open(); assert.equal(state.api.confirm.value, true); assert.equal(state.writes.length, 0) } finally { state.dispose() }
  const source = readFileSync(new URL('../src/components/ContentDeleteAction.vue', import.meta.url), 'utf8')
  assert.match(source, /v-if="showButton !== false"/)
  assert.match(source, /showButton: true/, 'Vue optional Boolean props require an explicit true default')
  assert.doesNotMatch(source, /hidden\??\s*:|v-if="!hidden"/)
})

test('other people, guests, disabled cards and changed targets cannot confirm a deletion', async () => {
  for (const options of [{ owner: 'someone-else' }, { owner: '', userId: '' }]) {
    const state = action(options)
    try { state.api.open(); await state.api.remove(); assert.equal(state.api.confirm.value, false); assert.equal(state.writes.length, 0) } finally { state.dispose() }
  }
  const state = action()
  try {
    state.props.disabled = true; state.api.open(); await state.api.remove(); assert.equal(state.writes.length, 0)
    state.props.disabled = false; state.api.open(); state.props.id = 'post-b'; await state.api.remove(); assert.equal(state.writes.length, 0)
    state.api.open(); state.auth.context++; state.auth.userId = 'new-owner'; await state.api.remove(); assert.equal(state.writes.length, 0)
  } finally { state.dispose() }
})

test('spots and private journals retain their distinct deletion type even when identifiers match', async () => {
  for (const type of ['spot', 'trip'] as const) {
    const state = action({ type })
    try {
      state.api.open(); await state.api.remove()
      assert.equal(state.writes[0].payload.type, type)
      assert.equal(state.notifications[0].type, type)
      assert.equal(state.notifications[0].id, 'post-a')
    } finally { state.dispose() }
  }
})

test('a backend denial preserves the content and confirmation with a retryable error', async () => {
  const state = action({ write: async () => { throw new Error('NOT_FOUND') } })
  try {
    state.api.open(); await state.api.remove()
    assert.equal(state.api.confirm.value, true)
    assert.equal(state.api.mutation.error.value, '服务暂时不可用，请稍后重试')
    assert.equal(state.notifications.length, 0); assert.equal(state.emits.length, 0); assert.equal(state.toasts.length, 0)
  } finally { state.dispose() }
})

test('pending confirmation is cancelled on hide and an in-flight write cannot double-submit or act in another account', async () => {
  const pending = deferred(), state = action({ write: () => pending.promise })
  try {
    state.api.open(); state.hide(); await state.api.remove(); assert.equal(state.writes.length, 0)
    state.show(); state.api.open()
    const first = state.api.remove(), duplicate = state.api.remove()
    assert.equal(state.writes.length, 1)
    state.auth.context++; state.auth.userId = 'another-owner'
    pending.resolve(); await Promise.all([first, duplicate])
    assert.equal(state.notifications.length, 0); assert.equal(state.emits.length, 0); assert.equal(state.toasts.length, 0)
  } finally { state.dispose() }
})

test('an acknowledged deletion after page hide still invalidates same-account lists without navigation or toast', async () => {
  const pending = deferred(), state = action({ write: () => pending.promise })
  try {
    state.api.open(); const deleting = state.api.remove(); state.hide(); pending.resolve(); await deleting
    assert.equal(state.notifications.length, 1)
    assert.equal(state.emits.length, 0); assert.equal(state.toasts.length, 0)
  } finally { state.dispose() }
})

test('content deletion notifications stay in their originating account and subscribers clean up with their scope', () => {
  const api: any = {}, sessionScope = vue.ref(1), calls: unknown[] = []
  let invalidated = 0
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/services/content-deletion.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: api, require: (id: string) => id === 'vue' ? vue : id === './repository' ? { invalidatePendingReads: () => invalidated++ } : { sessionScope }
  })
  const scope = vue.effectScope()
  scope.run(() => api.onContentDeleted((value: unknown) => calls.push(value)))
  api.notifyContentDeleted({ type: 'post', id: 'post-a', scope: 1 }); assert.equal(calls.length, 1)
  sessionScope.value = 2
  api.notifyContentDeleted({ type: 'post', id: 'post-b', scope: 1 }); assert.equal(calls.length, 1)
  assert.equal(invalidated, 1)
  api.notifyContentDeleted({ type: 'post', id: 'post-c', scope: 2 }); assert.equal(calls.length, 2)
  scope.stop(); api.notifyContentDeleted({ type: 'post', id: 'post-d', scope: 2 }); assert.equal(calls.length, 2)
})

test('a long press blocks the following content click while preserving visible-action and dialog interaction', () => {
  const api: any = {}, listeners = new Map<string, (event: any) => void>(), global = new Map<string, (event: any) => void>(), removed: string[] = []
  let now = 0, enabled = true, opened = 0
  const target = vue.ref({ addEventListener: (name: string, callback: any) => listeners.set(name, callback), removeEventListener: (name: string) => removed.push(name) })
  const scope = vue.effectScope()
  const provided = new Map<symbol, () => boolean>()
  runInNewContext(ts.transpileModule(readFileSync(resolve(resolveMobileProRoot(), 'packages/mobile-core/src/long-press-action.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: api, require: () => ({ ...vue, inject: (key: symbol, fallback: () => boolean) => provided.get(key) || fallback, provide: (key: symbol, value: () => boolean) => provided.set(key, value) }), Date: class extends Date { static now() { return now } },
    document: { addEventListener: (name: string, fn: any) => global.set(name, fn), removeEventListener: (name: string) => global.delete(name) }
  })
  const gesture = scope.run(() => api.useLongPressAction(() => opened++, () => enabled, target))
  assert.equal(gesture.allowClick(), true)
  gesture.hold(); now = 5000; assert.equal(gesture.allowClick(), false)
  assert.equal(api.useLongPressActionGuard()(), false, 'descendant native taps read the same guard without a prop/update bridge')
  gesture.release(); assert.equal(opened, 1); assert.equal(gesture.allowClick(), false)
  let blocked = 0
  const event = { target: { closest: () => null }, preventDefault: () => blocked++, stopImmediatePropagation: () => blocked++ }
  global.get('click')!(event)
  assert.equal(blocked, 2, 'the release click retargeted outside the card to a new modal must be swallowed')
  assert.equal(global.size, 0)
  blocked = 0
  listeners.get('click')!(event); assert.equal(blocked, 2)
  listeners.get('click')!({ ...event, target: { closest: () => ({}) } }); assert.equal(blocked, 2)
  now += 501; assert.equal(gesture.allowClick(), true)
  assert.equal(api.useLongPressActionGuard()(), true)
  gesture.hold(); gesture.release()
  global.get('pointerdown')!(event)
  assert.equal(gesture.allowClick(), true, 'a new deliberate dialog interaction is allowed immediately')
  assert.equal(global.size, 0)
  opened = 1
  enabled = false; gesture.hold(); assert.equal(opened, 1)
  scope.stop(); assert.deepEqual(removed.sort(), ['click', 'contextmenu'])
})

test('mini-program gallery image/video and retry actions consult the ancestor guard before opening anything', () => {
  const api: any = {}, events: string[] = [], scope = vue.effectScope()
  let allowed = false, imageOpens = 0
  const media = [{ id: 'image', kind: 'image', url: 'wxfile://isolated/image.png' }, { id: 'video', kind: 'video', url: 'wxfile://isolated/video.mp4', poster: 'wxfile://isolated/poster.png' }]
  let source = readFileSync(resolve(resolveMobileProRoot(), 'packages/mobile-core/src/components/MobileMediaGallery.vue'), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]
  source = source.replace(/\/\/ #ifdef H5[\s\S]*?\/\/ #endif/g, '').replace(/\/\/ #ifndef MP-WEIXIN[\s\S]*?\/\/ #endif/g, '')
  const modules: Record<string, unknown> = {
    vue: { ...vue, onBeforeUnmount: () => {} }, '@dcloudio/uni-app': { onHide: () => {}, onShow: () => {} },
    '../action-keyboard': {}, './MobileIcon.vue': {}, './MobileImagePreview.vue': {}, './MobileVideoViewer.vue': {},
    '../long-press-action': { useLongPressActionGuard: () => () => allowed },
    '../upload-progress': { createUploadCancellation: () => ({ abort() {}, signal: undefined }) },
    '../video-poster': { clearVideoPosterScope() {}, captureVideoPoster: async () => '', createVideoPosterDelivery: () => async (apply: () => void, current: () => boolean) => { if (current()) apply() } }
  }
  scope.run(() => runInNewContext(ts.transpileModule(source+'\nexports.api={open,retry,videoOpen,imageViewer};', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: api, require: (id: string) => { assert.ok(id in modules, id); return modules[id] },
    defineOptions: () => {}, defineProps: () => ({ media, label: '隔离附件', scope: 1 }), defineEmits: () => (name: string) => events.push(name)
  }))
  try {
    api.api.imageViewer.value = { open: () => imageOpens++ }
    api.api.open(media[0]); api.api.open(media[1]); api.api.retry()
    assert.equal(imageOpens, 0); assert.equal(api.api.videoOpen.value, false); assert.equal(events.includes('retry'), false)
    allowed = true
    api.api.open(media[0]); api.api.open(media[1]); api.api.retry()
    assert.equal(imageOpens, 1); assert.equal(api.api.videoOpen.value, true); assert.equal(events.includes('retry'), true)
  } finally { scope.stop() }
})
