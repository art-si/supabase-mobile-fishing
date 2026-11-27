import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { resolveMobileProRoot } from '../scripts/mobile-pro.mjs'

function module(source: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const api: any = {}
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: api, require: (id: string) => { assert.ok(id in dependencies, id); return dependencies[id] }, ...globals
  })
  return api
}
const cancellation = module(readFileSync(resolve(resolveMobileProRoot(), 'packages/mobile-core/src/upload-progress.ts'), 'utf8'), {})
function controller() {
  const native = cancellation.createUploadCancellation(), listeners = new Set<() => void>()
  let added = 0, removed = 0
  return {
    signal: {
      get aborted() { return native.signal.aborted },
      addEventListener(type: string, listener: () => void, options: object) { added++; listeners.add(listener); native.signal.addEventListener(type, listener, options) },
      removeEventListener(type: string, listener: () => void) { removed++; listeners.delete(listener); native.signal.removeEventListener(type, listener) }
    },
    abort: native.abort, size: () => listeners.size, added: () => added, removed: () => removed
  }
}
function transport(options: { abortThrows?: boolean; onCreate?: (request: any) => void } = {}) {
  const calls: any[] = []
  let aborts = 0
  const api = module(readFileSync(new URL('../src/services/http.ts', import.meta.url), 'utf8'), {
    '@/config': { config: { supabaseKey: 'isolated-public-key', supabaseUrl: 'https://isolated.invalid' } },
    '@/domain/auth-errors': { authErrorMessage: () => 'isolated auth failure', retryAfterFromHeaders: () => undefined },
    '@/domain/user-errors': { serviceErrorMessage: (code: string) => code }
  }, {
    uni: { request(input: any) {
      calls.push(input)
      options.onCreate?.(input)
      return { abort() { aborts++; input.fail({ errMsg: 'request:fail abort' }); if (options.abortThrows) throw new Error('isolated abort bridge failure') } }
    } }
  })
  return { api, calls, aborts: () => aborts }
}
const isCancelled = (error: any) => error.code === 'REQUEST_CANCELLED' && error.status === 0

test('native request cancellation rejects immediately, calls abort once and ignores synchronous or late callbacks', async () => {
  const state = transport(), owner = controller()
  const pending = state.api.request('/functions/v1/amap', { method: 'POST', data: { action: 'preview' }, signal: owner.signal })
  assert.equal(owner.size(), 1)
  owner.abort(); owner.abort()
  await assert.rejects(pending, error => isCancelled(error) && !state.api.isTransientRequestError(error))
  assert.equal(state.aborts(), 1)
  assert.equal(owner.size(), 0)
  state.calls[0].success({ statusCode: 200, data: { stale: true } })
  state.calls[0].fail({ errMsg: 'request:fail timeout' })
  assert.equal(state.aborts(), 1)
})

test('an already-cancelled operation never creates a native request or subscribes', async () => {
  const state = transport(), owner = controller()
  owner.abort()
  await assert.rejects(state.api.request('/functions/v1/amap', { signal: owner.signal }), isCancelled)
  assert.equal(state.calls.length, 0); assert.equal(owner.added(), 0)
})

test('cancellation during native task creation still aborts the returned task and settles once', async () => {
  const owner = controller(), state = transport({ onCreate: () => owner.abort() })
  await assert.rejects(state.api.request('/functions/v1/amap', { signal: owner.signal }), isCancelled)
  assert.equal(state.calls.length, 1); assert.equal(state.aborts(), 1); assert.equal(owner.size(), 0)
  const throwing = transport({ abortThrows: true }), other = controller()
  const pending = throwing.api.request('/functions/v1/amap', { signal: other.signal })
  other.abort(); await assert.rejects(pending, isCancelled)
  assert.equal(other.size(), 0)
})

test('normal success, HTTP failure and native failure detach cancellation without changing existing behavior', async () => {
  for (const kind of ['success', 'http', 'native'] as const) {
    const state = transport(), owner = controller(), pending = state.api.request('/business', { signal: owner.signal })
    if (kind === 'success') { state.calls[0].success({ statusCode: 200, data: { ok: true } }); assert.deepEqual(await pending, { ok: true }) }
    else if (kind === 'http') { state.calls[0].success({ statusCode: 403, data: {} }); await assert.rejects(pending, (error: any) => error.status === 403) }
    else { state.calls[0].fail({ errMsg: 'request:fail timeout' }); await assert.rejects(pending, (error: any) => error.code === 'REQUEST_TIMEOUT') }
    assert.equal(owner.size(), 0)
    owner.abort(); assert.equal(state.aborts(), 0)
  }
  const state = transport(), pending = state.api.request('/business', { data: { original: true } })
  assert.equal(state.calls[0].timeout, 15000)
  state.calls[0].success({ statusCode: 200, data: true }); assert.equal(await pending, true)
})

test('synchronous native success or creation failure leaves no cancellation listener behind', async () => {
  const owner = controller(), success = transport({ onCreate: request => request.success({ statusCode: 200, data: true }) })
  assert.equal(await success.api.request('/business', { signal: owner.signal }), true)
  assert.equal(owner.size(), 0); owner.abort(); assert.equal(success.aborts(), 0)
  const other = controller(), failure = transport({ onCreate: () => { throw new Error('isolated request creation failure') } })
  await assert.rejects(failure.api.request('/business', { signal: other.signal }), /isolated request creation failure/)
  assert.equal(other.size(), 0)
})

function mapService(state: ReturnType<typeof transport>, gate?: Promise<void>) {
  return module(readFileSync(new URL('../src/services/amap.ts', import.meta.url), 'utf8'), {
    './http': state.api,
    '@/domain/user-errors': { serviceErrorMessage: (code: string) => code },
    './session': { sessionScope: { value: 1 }, sessionRequest: async (path: string, options: unknown) => { if (gate) await gate; return state.api.request(path, options) } }
  })
}
test('the static-preview third signal reaches native abort without entering the provider payload', async () => {
  const state = transport(), api = mapService(state), owner = controller()
  const pending = api.getStaticPreview({ longitude: 114, latitude: 30, hideMarker: true, viewport: { width: 390, height: 500 } }, 14, owner.signal)
  assert.equal(state.calls.length, 1)
  assert.equal(state.calls[0].data.action, 'preview')
  assert.equal('signal' in state.calls[0].data, false)
  owner.abort(); await assert.rejects(pending, isCancelled)
  assert.equal(state.aborts(), 1); assert.equal(owner.size(), 0)
})

test('a signal cancelled while waiting for an entry/token gate prevents the subsequent native request', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), state = transport(), api = mapService(state, gate), owner = controller()
  const pending = api.getStaticPreview({ longitude: 114, latitude: 30 }, 14, owner.signal)
  owner.abort(); assert.equal(state.calls.length, 0)
  const rejected = assert.rejects(pending, isCancelled)
  release(); await rejected
  assert.equal(state.calls.length, 0)
})
