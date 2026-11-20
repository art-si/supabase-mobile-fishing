import assert from 'node:assert/strict'
import test from 'node:test'
import { createLoginReturnIntent } from '../src/_mobile-core/login-return-intent'

const save = { id: 'one', kind: 'bookmark', enabled: true } as const

test('explicit guest save resumes once, keeping enable semantics rather than toggling', () => {
  const pending = createLoginReturnIntent<typeof save>()
  assert.equal(pending.begin(save), true)
  pending.observeUser('a')
  assert.deepEqual(pending.take('a'), save)
  assert.equal(pending.take('a'), undefined)
})

test('rapid repeated taps do not replace the original action or create another login request', () => {
  const pending = createLoginReturnIntent<{ id: string }>()
  assert.equal(pending.begin({ id: 'one' }), true)
  assert.equal(pending.begin({ id: 'two' }), false)
  assert.deepEqual(pending.take('a'), { id: 'one' })
})

test('returning as a guest cancels the action before a later unrelated login', () => {
  const pending = createLoginReturnIntent<typeof save>()
  pending.begin(save)
  assert.equal(pending.take(''), undefined)
  pending.observeUser('a')
  assert.equal(pending.take('a'), undefined)
})

test('unloading the source page clears its pending action', () => {
  const pending = createLoginReturnIntent<typeof save>()
  pending.begin(save)
  pending.cancel()
  assert.equal(pending.take('a'), undefined)
})

test('first authenticated identity owns the action, switching users cancels it', () => {
  const pending = createLoginReturnIntent<typeof save>()
  pending.begin(save)
  pending.observeUser('a')
  pending.observeUser('b')
  assert.equal(pending.take('b'), undefined)
  assert.equal(pending.take('a'), undefined)
})

test('logging out after authentication cancels, even if the same user logs in again', () => {
  const pending = createLoginReturnIntent<typeof save>()
  pending.begin(save)
  pending.observeUser('a')
  pending.observeUser('')
  pending.observeUser('a')
  assert.equal(pending.take('a'), undefined)
})

test('session refresh for the same identity does not cancel the explicit action', () => {
  const pending = createLoginReturnIntent<typeof save>()
  pending.begin(save)
  pending.observeUser('a')
  pending.observeUser('a')
  assert.deepEqual(pending.take('a'), save)
})

test('expired intent cannot run, and a new explicit action can be queued', () => {
  let clock = 0
  const pending = createLoginReturnIntent<typeof save>({ now: () => clock, lifetimeMs: 100 })
  pending.begin(save)
  clock = 100
  assert.equal(pending.take('a'), undefined)
  pending.begin(save)
  clock = 201
  pending.observeUser('a')
  assert.equal(pending.take('a'), undefined)
  assert.equal(pending.begin(save), true)
  assert.deepEqual(pending.take('a'), save)
})
