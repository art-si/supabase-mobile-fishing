import test from 'node:test'
import assert from 'node:assert/strict'
import { createCredentialStore } from '../src/_mobile-core/credential-store'

test('credential writes, rotation and logout are ordered even when the OS is slow', async () => {
  let value: string | null = null,
    release!: () => void
  const started: string[] = []
  const store = createCredentialStore({
    read: async () => value,
    write: async (next) => {
      started.push(next)
      if (next === 'old')
        await new Promise<void>((yes) => {
          release = yes
        })
      value = next
    },
    remove: async () => {
      started.push('remove')
      value = null
    }
  })
  const old = store.write('old')
  await Promise.resolve()
  const rotation = store.write('rotated'),
    logout = store.remove()
  assert.deepEqual(started, ['old'])
  release()
  await Promise.all([old, rotation, logout])
  assert.equal(await store.read(), null)
  assert.deepEqual(started, ['old', 'rotated', 'remove'])
})

test('a failed write removes stale credentials and does not poison later login', async () => {
  let value: string | null = 'old-account'
  const store = createCredentialStore({
    read: async () => value,
    write: async (next) => {
      if (next === 'bad') throw new Error('OS locked')
      value = next
    },
    remove: async () => {
      value = null
    }
  })
  await assert.rejects(store.write('bad'))
  assert.equal(await store.read(), null)
  await store.write('new-account')
  assert.equal(await store.read(), 'new-account')
})
