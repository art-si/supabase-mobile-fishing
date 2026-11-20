import test from 'node:test'
import assert from 'node:assert/strict'
import { createAppForeground, type NativeAppStateSource } from '../src/_mobile-core/app-foreground'
import { createLiveUpdates } from '../src/domain/live-updates'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}
function fixture() {
  let emit = (_state: { isActive: boolean }) => {}
  const snapshot = deferred<{ isActive: boolean }>()
  let removed = 0,
    snapshots = 0
  const native: NativeAppStateSource = {
    addListener: async (event, listener) => {
      assert.equal(event, 'appStateChange')
      emit = listener
      return {
        remove: async () => {
          removed++
        }
      }
    },
    getState: () => {
      snapshots++
      return snapshot.promise
    }
  }
  return {
    native,
    snapshot,
    emit: (isActive: boolean) => emit({ isActive }),
    removed: () => removed,
    snapshots: () => snapshots
  }
}
test('web and miniapp visibility remains synchronous, deduplicated and disposable', () => {
  const states: boolean[] = []
  const activity = createAppForeground((value) => states.push(value))
  activity.setVisible(false)
  activity.setVisible(true)
  activity.setVisible(true)
  activity.setVisible(false)
  activity.setVisible(true)
  activity.dispose()
  activity.dispose()
  activity.setVisible(true)
  assert.deepEqual(states, [true, false, true, false])
})
test('native startup waits for a state and both visibility signals must be active', async () => {
  const f = fixture(),
    states: boolean[] = []
  const activity = createAppForeground((value) => states.push(value), { native: f.native })
  activity.setVisible(true)
  assert.deepEqual(states, [])
  await settle()
  assert.equal(f.snapshots(), 1)
  f.snapshot.resolve({ isActive: false })
  await settle()
  activity.setVisible(true)
  assert.deepEqual(states, [])
  f.emit(true)
  f.emit(true)
  activity.setVisible(false)
  f.emit(true)
  activity.setVisible(true)
  f.emit(false)
  activity.setVisible(true)
  f.emit(true)
  assert.deepEqual(states, [true, false, true, false, true])
  activity.dispose()
  assert.equal(f.removed(), 1)
})
test('new native events win over delayed initial snapshots in either direction', async () => {
  for (const event of [false, true]) {
    const f = fixture(),
      states: boolean[] = []
    const activity = createAppForeground((value) => states.push(value), { native: f.native })
    activity.setVisible(true)
    await settle()
    f.emit(event)
    f.snapshot.resolve({ isActive: !event })
    await settle()
    assert.deepEqual(states, event ? [true] : [])
    activity.dispose()
  }
})
test('an event arriving during listener registration makes a later startup snapshot unnecessary', async () => {
  const f = fixture(),
    original = f.native.addListener
  f.native.addListener = async (event, listener) => {
    listener({ isActive: false })
    return original(event, listener)
  }
  const states: boolean[] = []
  const activity = createAppForeground((value) => states.push(value), { native: f.native })
  activity.setVisible(true)
  await settle()
  assert.equal(f.snapshots(), 0)
  assert.deepEqual(states, [])
  f.emit(true)
  assert.deepEqual(states, [true])
  activity.dispose()
})
test('native registration or snapshot failures fall back without rejecting app startup', async () => {
  for (const method of ['addListener', 'getState'] as const) {
    const f = fixture(),
      states: boolean[] = []
    f.native[method] = () => {
      throw new Error('provider-secret must never be logged')
    }
    const activity = createAppForeground((value) => states.push(value), { native: f.native })
    activity.setVisible(true)
    await settle()
    assert.deepEqual(states, [true])
    activity.setVisible(false)
    assert.deepEqual(states, [true, false])
    activity.dispose()
  }
})
test('failed or invalid snapshots cannot erase an already known native inactive state', async () => {
  const f = fixture(),
    states: boolean[] = []
  const activity = createAppForeground((value) => states.push(value), { native: f.native })
  activity.setVisible(true)
  await settle()
  f.emit(false)
  f.snapshot.reject(new Error('late failure'))
  await settle()
  assert.deepEqual(states, [])
  f.emit(true)
  assert.deepEqual(states, [true])
  activity.dispose()
})
test('hung native startup has a bounded fallback; late snapshot cannot replace subsequent state', async () => {
  const f = fixture(),
    states: boolean[] = []
  const activity = createAppForeground((value) => states.push(value), {
    native: f.native,
    initializationTimeoutMs: 5
  })
  activity.setVisible(true)
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.deepEqual(states, [true])
  f.emit(false)
  f.snapshot.resolve({ isActive: true })
  await settle()
  assert.deepEqual(states, [true, false])
  activity.dispose()
})
test('invalid initial state falls back, and malformed events do not change visibility', async () => {
  const f = fixture(),
    states: boolean[] = []
  const activity = createAppForeground((value) => states.push(value), { native: f.native })
  activity.setVisible(true)
  await settle()
  f.snapshot.resolve({ isActive: 'false' } as unknown as { isActive: boolean })
  await settle()
  f.emit(undefined as unknown as boolean)
  assert.deepEqual(states, [true])
  activity.dispose()
})
test('disposal removes a late listener exactly once and ignores late snapshots/events', async () => {
  const f = fixture(),
    states: boolean[] = []
  const registration = deferred<{ remove(): Promise<void> }>()
  let removed = 0
  f.native.addListener = async (_event, listener) => {
    listener({ isActive: true })
    return registration.promise
  }
  const activity = createAppForeground((value) => states.push(value), { native: f.native })
  activity.setVisible(true)
  activity.dispose()
  activity.dispose()
  registration.resolve({
    remove: async () => {
      removed++
      throw new Error('cleanup fixture')
    }
  })
  await settle()
  assert.deepEqual(states, [true, false])
  assert.equal(removed, 1)
  assert.equal(f.snapshots(), 0)
  const other = fixture()
  const pending = createAppForeground((value) => states.push(value), { native: other.native })
  pending.setVisible(true)
  await settle()
  pending.dispose()
  other.snapshot.resolve({ isActive: true })
  other.emit(true)
  await settle()
  assert.deepEqual(states, [true, false])
  assert.equal(other.removed(), 1)
})
test('native foreground owns exactly one account-scoped live connection and drops background events', async () => {
  const connections: { valid(): boolean; notify(): void; closed: boolean }[] = []
  const live = createLiveUpdates((_user, valid, notify) => {
    const connection = { valid, notify, closed: false }
    connections.push(connection)
    return () => {
      connection.closed = true
    }
  })
  let notifications = 0
  live.setIdentity({ userId: 'fixture-user', scope: 1 })
  const stop = live.subscribe(() => notifications++)
  const f = fixture()
  const activity = createAppForeground(live.setForeground, { native: f.native })
  activity.setVisible(true)
  await settle()
  f.snapshot.resolve({ isActive: true })
  await settle()
  assert.equal(connections.length, 1)
  connections[0].notify()
  f.emit(false)
  activity.setVisible(true)
  await new Promise((resolve) => setTimeout(resolve, 160))
  assert.equal(notifications, 0)
  assert.equal(connections[0].closed, true)
  assert.equal(connections[0].valid(), false)
  f.emit(true)
  f.emit(true)
  activity.setVisible(true)
  assert.equal(connections.length, 2)
  activity.dispose()
  assert.equal(connections[1].closed, true)
  stop()
})
