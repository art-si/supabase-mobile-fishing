import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { createLatestRequest } from '../src/_mobile-core/latest-request'

function controller() {
  const resource: any = {}, exported: any = {}, calls: any[] = [], hooks: Record<string, () => void> = {}
  const scope = vue.effectScope(), sessionScope = vue.ref(1)
  let deleted: (value: { type: string; id: string }) => void = () => {}
  const execute = (source: string, exports: unknown, modules: Record<string, unknown>) => runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: (id: string) => { if (id.endsWith('.vue')) return {}; assert.ok(id in modules, id); return modules[id] },
    defineOptions() {}, defineExpose() {}, uni: { getStorageSync: () => '' }
  })
  execute(readFileSync(new URL('../src/composables/useResource.ts', import.meta.url), 'utf8'), resource, {
    vue, '@mobile-core/latest-request': { createLatestRequest },
    '@/domain/rules': { errorText: () => '隔离读取错误' }, '@/services/session': { sessionScope }, '@/services/http': { ApiError: class extends Error {} }
  })
  const source = readFileSync(new URL('../src/components/FeedView.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]
  scope.run(() => execute(source+'\nexports.api={data,loading,query,submitted,filter,search};', exported, {
    vue, '@dcloudio/uni-app': { onHide: (fn: () => void) => { hooks.hide = fn }, onShow: (fn: () => void) => { hooks.show = fn } },
    '@/domain/cities': { cityOption: () => undefined, cityOptions: [] }, '@/platforms/city-location': { canLocateCity: false },
    '@/domain/rules': { errorText: () => '隔离读取错误' }, '@/composables/useResource': resource,
    '@/composables/useMutation': { useMutation: () => ({ busy: vue.ref(false), error: vue.ref(''), run: (fn: () => Promise<void>) => fn() }) },
    '@/composables/useLoginAction': { useLoginAction: () => ({ requireLogin: () => true }) },
    '@/stores/auth': { useAuthStore: () => ({ userId: 'owner', context: 1, signedIn: true }) },
    '@/services/content-deletion': { onContentDeleted: (fn: typeof deleted) => { deleted = fn } },
    '@/services/repository': { read: (action: string, payload: unknown) => new Promise(resolve => calls.push({ action, payload, resolve })), write: () => { throw new Error('Unexpected fixture write') } }
  }))
  const drain = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await vue.nextTick() }
  return { api: exported.api, calls, drain, deleted: (type: string, id: string) => deleted({ type, id }), hide: () => hooks.hide(), stop: () => scope.stop() }
}

test('deleting during a filtered first-page read reloads that query and rejects the older response', async () => {
  const state = controller()
  try {
    state.calls[0].resolve({ items: [{ id: 'removed' }, { id: 'retained' }], next: 'old-page' }); await state.drain()
    state.api.query.value = '鲫鱼'; state.api.search('鲫鱼')
    assert.equal(state.calls.length, 2)
    state.deleted('post', 'removed')
    assert.equal(state.calls.length, 3)
    assert.equal(state.calls[2].payload.query, '鲫鱼')
    assert.equal(state.calls[2].payload.filter, 'recommended')
    assert.equal(state.api.submitted.value, '鲫鱼')
    assert.deepEqual(state.api.data.value.items.map((item: any) => item.id), ['retained'])
    state.calls[1].resolve({ items: [{ id: 'removed' }, { id: 'stale-query-result' }], next: null }); await state.drain()
    assert.equal(state.api.loading.value, true)
    assert.deepEqual(state.api.data.value.items.map((item: any) => item.id), ['retained'])
    state.calls[2].resolve({ items: [{ id: 'fresh-filtered-result' }], next: 'filtered-page' }); await state.drain()
    assert.deepEqual(state.api.data.value.items.map((item: any) => item.id), ['fresh-filtered-result'])
    assert.equal(state.api.loading.value, false)
    state.deleted('post', 'fresh-filtered-result')
    assert.equal(state.calls.length, 3, 'a settled long list is updated in place, without resetting pagination')
    assert.equal(state.api.data.value.next, 'filtered-page')
  } finally { state.stop() }
})

test('hidden lists discard an interrupted read without issuing a new background query or removing another type', async () => {
  const state = controller()
  try {
    state.calls[0].resolve({ items: [{ id: 'same-id' }], next: 'page-two' }); await state.drain()
    state.deleted('spot', 'same-id')
    assert.equal(state.api.data.value.items.length, 1)
    state.api.query.value = '台钓'; state.api.search('台钓')
    state.hide(); state.deleted('post', 'same-id')
    assert.equal(state.calls.length, 2)
    state.calls[1].resolve({ items: [{ id: 'same-id' }], next: null }); await state.drain()
    assert.equal(state.api.data.value.items.length, 0)
    assert.equal(state.api.data.value.next, 'page-two')
    assert.equal(state.api.query.value, '台钓')
  } finally { state.stop() }
})
