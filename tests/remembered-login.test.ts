import test from 'node:test'
import assert from 'node:assert/strict'
import { createRememberedLogin, type LoginSecret } from '../src/_mobile-core/remembered-login'
import { createBrowserPasswordStore } from '../src/_mobile-core/browser-passwords'
import { normalizeLoginIdentifier } from '../src/domain/account-security'

const login = {
  owner: 'fixture-account-A',
  identifier: '+8613800000000',
  password: 'FixturePassword1'
}
function fixture() {
  let preference: unknown = null,
    secret: LoginSecret | null = null
  let locked = false,
    writes = 0,
    removals = 0
  let gate: Promise<void> | undefined
  const manager = createRememberedLogin({
    normalizeIdentifier: normalizeLoginIdentifier,
    preferences: {
      read: () => preference,
      write: (value) => {
        preference = value
      },
      remove: () => {
        preference = null
      }
    },
    passwords: {
      available: () => true,
      read: async () => {
        if (locked) throw Error('locked')
        return secret
      },
      write: async (value) => {
        writes++
        await gate
        secret = value
        return true
      },
      remove: async () => {
        removals++
        secret = null
      }
    }
  })
  return {
    manager,
    get preference() {
      return preference
    },
    get secret() {
      return secret
    },
    get writes() {
      return writes
    },
    get removals() {
      return removals
    },
    lock: () => {
      locked = true
    },
    setGate: (value: Promise<void>) => {
      gate = value
    },
    replaceSecret: (value: LoginSecret) => {
      secret = value
    }
  }
}
test('remembered password uses the dedicated credential port and metadata never contains the password', async () => {
  const f = fixture()
  assert.equal(f.manager.preference(), null)
  assert.deepEqual(await f.manager.save(login), { saved: true, passwordSaved: true })
  assert.equal(JSON.stringify(f.preference).includes(login.password), false)
  assert.deepEqual(f.secret, { identifier: login.identifier, password: login.password })
  assert.equal((await f.manager.load())?.password, login.password)
  assert.equal(f.writes, 1)
})
test('opt-out during an older OS write cannot restore either the password or preference', async () => {
  const f = fixture()
  let release!: () => void
  f.setGate(
    new Promise<void>((resolve) => {
      release = resolve
    })
  )
  const saving = f.manager.save(login)
  await new Promise((resolve) => setTimeout(resolve, 0))
  const clearing = f.manager.forget()
  release()
  assert.deepEqual(await saving, { saved: false, passwordSaved: false })
  await clearing
  assert.equal(f.preference, null)
  assert.equal(f.secret, null)
  assert.equal(await f.manager.load(), null)
})
test('late login results cannot remember an account after page or account replacement', async () => {
  const f = fixture()
  let current = true,
    release!: () => void
  f.setGate(
    new Promise<void>((resolve) => {
      release = resolve
    })
  )
  const saving = f.manager.save(login, () => current)
  await new Promise((resolve) => setTimeout(resolve, 0))
  current = false
  release()
  await saving
  assert.equal(f.preference, null)
  assert.equal(f.secret, null)
})
test('locked credentials retain the remembered account while refusing a mismatched password', async () => {
  const f = fixture()
  await f.manager.save(login)
  f.replaceSecret({ identifier: '+8613900000000', password: 'OtherPassword1' })
  assert.equal((await f.manager.load())?.password, '')
  f.lock()
  assert.equal((await f.manager.load())?.identifier, login.identifier)
  assert.equal((await f.manager.load())?.password, '')
  assert.ok(f.preference)
})
test('password changes and deletion clear only the owner being changed', async () => {
  const f = fixture()
  await f.manager.save(login)
  await f.manager.forgetOwner('fixture-account-B')
  assert.ok(f.preference)
  assert.ok(f.secret)
  await f.manager.forgetOwner(login.owner)
  assert.equal(f.preference, null)
  assert.equal(f.secret, null)
  await f.manager.save(login)
  await f.manager.forgetOtherOwners('fixture-account-B')
  assert.equal(f.preference, null)
  assert.equal(f.secret, null)
})
test('an unavailable password manager remembers identity only and never writes a plaintext secret', async () => {
  let preference: unknown = null,
    secretWrites = 0
  const manager = createRememberedLogin({
    normalizeIdentifier: normalizeLoginIdentifier,
    preferences: {
      read: () => preference,
      write: (value) => {
        preference = value
      },
      remove: () => {
        preference = null
      }
    },
    passwords: {
      available: () => false,
      read: async () => null,
      write: async () => {
        secretWrites++
        return false
      },
      remove: async () => {}
    }
  })
  assert.deepEqual(await manager.save(login), { saved: true, passwordSaved: false })
  assert.equal(secretWrites, 0)
  assert.equal(JSON.stringify(preference).includes(login.password), false)
  assert.equal((await manager.load())?.password, '')
})
test('browser adapter requests silent password autofill only and delegates storage to the browser', async () => {
  const calls: unknown[] = []
  class PasswordCredential {
    type = 'password'
    id: string
    password: string
    constructor(value: { id: string; password: string }) {
      this.id = value.id
      this.password = value.password
    }
  }
  const saved = new PasswordCredential({ id: login.identifier, password: login.password })
  const store = createBrowserPasswordStore({
    secure: true,
    PasswordCredential,
    credentials: {
      get: async (options) => {
        calls.push(options)
        return saved
      },
      store: async (value) => {
        calls.push(value)
        return value
      },
      preventSilentAccess: async () => {
        calls.push('preventSilentAccess')
      }
    }
  })
  assert.equal(await store.write({ identifier: login.identifier, password: login.password }), true)
  assert.equal((await store.read())?.password, login.password)
  assert.equal((calls[1] as any).mediation, 'silent')
  assert.equal((calls[1] as any).password, true)
  await store.remove()
  assert.equal(calls[2], 'preventSilentAccess')
  assert.equal(createBrowserPasswordStore({ secure: false, PasswordCredential }).available(), false)
})
