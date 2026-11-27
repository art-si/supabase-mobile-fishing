import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

class ApiError extends Error {
  constructor(message: string, public status: number, public code = '') { super(message) }
}
function harness(send: (path: string, options: any) => Promise<unknown>) {
  const scope = { value: 1 }
  const exports: Record<string, any> = {}
  const dependencies: Record<string, unknown> = {
    './http': { ApiError }, './media': { resolveContentMedia: async () => {} },
    './session': { sessionScope: scope, sessionRequest: send, assertSession: (expected: number) => {
      if (expected !== scope.value) throw new ApiError('changed', 409, 'SESSION_CHANGED')
    } }
  }
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/services/repository.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, require: (name: string) => {
    assert.ok(name in dependencies, name)
    return dependencies[name]
  } })
  return { ...exports, scope }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (value: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('simultaneous identical fishing reads share work, other filters stay independent, and results do not stay cached', async () => {
  const pending: ReturnType<typeof deferred>[] = []
  const h = harness(async () => { const next = deferred(); pending.push(next); return next.promise })
  const first = h.read('spots', { type: '水库' }), same = h.read('spots', { type: '水库' })
  const other = h.read('spots', { type: '钓场' })
  assert.equal(first, same)
  assert.equal(pending.length, 2)
  pending[0]!.resolve({ items: ['reservoir'] }); pending[1]!.resolve({ items: ['venue'] })
  assert.deepEqual(await first, { items: ['reservoir'] })
  assert.deepEqual(await other, { items: ['venue'] })
  const refresh = h.read('spots', { type: '水库' })
  assert.equal(pending.length, 3)
  pending[2]!.resolve({ items: [] }); await refresh
})

test('removal invalidation prevents a new reader from joining an older snapshot without replaying or cancelling it', async () => {
  const pending: ReturnType<typeof deferred>[] = []
  const h = harness(async () => { const next = deferred(); pending.push(next); return next.promise })
  const beforeRemoval = h.read('feed')
  h.invalidatePendingReads()
  const afterRemoval = h.read('feed')
  assert.notEqual(beforeRemoval, afterRemoval)
  assert.equal(pending.length, 2)
  pending[0]!.resolve({ items: ['old snapshot'] }); await beforeRemoval
  assert.equal(h.read('feed'), afterRemoval, 'old completion must not erase the replacement pending read')
  pending[1]!.resolve({ items: [] })
  assert.deepEqual(await afterRemoval, { items: [] })
  assert.equal(pending.length, 2)
})

test('transport failures recover once for fishing reads and do not loop', async () => {
  for (const [status, code] of [[0, 'NETWORK_ERROR'], [0, 'REQUEST_TIMEOUT'], [503, '']] as const) {
    let calls = 0
    const h = harness(async () => {
      if (++calls === 1) throw new ApiError('transient', status, code)
      return { items: [] }
    })
    await h.read('spots'); assert.equal(calls, 2)
  }
  let calls = 0
  const h = harness(async () => { calls++; throw new ApiError('timeout', 0, 'REQUEST_TIMEOUT') })
  await assert.rejects(h.read('spots'), { code: 'REQUEST_TIMEOUT' })
  assert.equal(calls, 2)
})

test('writes, authentication failures, throttling and business denials are never automatically replayed', async () => {
  for (const [kind, status, code] of [['write', 0, 'REQUEST_TIMEOUT'], ['read', 401, ''],
    ['read', 403, 'FORBIDDEN'], ['read', 429, ''], ['read', 0, 'SERVICE_UNAVAILABLE'],
    ['read', 400, 'INVALID_INPUT']] as const) {
    let calls = 0
    const h = harness(async () => { calls++; throw new ApiError('failure', status, code) })
    await assert.rejects(h[kind]('action'))
    assert.equal(calls, 1)
  }
})

test('changing accounts cannot share a private read, return its result, or retry under the new account', async () => {
  const pending: ReturnType<typeof deferred>[] = []
  const h = harness(async () => { const next = deferred(); pending.push(next); return next.promise })
  const first = h.read('mine'), rejected = assert.rejects(first, { code: 'SESSION_CHANGED' })
  h.scope.value++
  const second = h.read('mine')
  assert.equal(pending.length, 2)
  pending[0]!.reject(new ApiError('lost', 0, 'NETWORK_ERROR'))
  pending[1]!.resolve({ items: ['second account'] })
  await rejected
  assert.deepEqual(await second, { items: ['second account'] })
  assert.equal(pending.length, 2)
})
