import test from 'node:test'
import assert from 'node:assert/strict'
import { createLiveUpdates } from '../src/domain/live-updates'
import { messageStatus } from '../src/domain/message-status'
import type { Conversation, Message } from '../src/domain/models'

const wait = () => new Promise((resolve) => setTimeout(resolve, 160))
test('one account-scoped connection, coalescing, visibility, unsubscribe and late-event isolation', async () => {
  const connections: {
    user: string
    current: () => boolean
    notify: () => void
    closed: boolean
  }[] = []
  const service = createLiveUpdates((user, current, notify) => {
    const connection = { user, current, notify, closed: false }
    connections.push(connection)
    return () => {
      connection.closed = true
    }
  })
  let a = 0,
    b = 0
  service.setIdentity({ userId: 'alice', scope: 1 })
  const stopA = service.subscribe(() => a++)
  assert.equal(connections.length, 0)
  service.setForeground(true)
  const stopB = service.subscribe(() => b++)
  assert.equal(connections.length, 1)
  connections[0].notify()
  connections[0].notify()
  await wait()
  assert.deepEqual([a, b], [1, 1])
  service.setIdentity({ userId: 'bob', scope: 2 })
  assert.equal(connections[0].closed, true)
  assert.equal(connections[0].current(), false)
  connections[0].notify()
  await wait()
  assert.deepEqual([a, b], [1, 1])
  connections[1].notify()
  service.setForeground(false)
  await wait()
  assert.deepEqual([a, b], [1, 1])
  assert.equal(connections[1].closed, true)
  service.setForeground(true)
  assert.equal(connections.length, 3)
  stopA()
  connections[2].notify()
  await wait()
  assert.deepEqual([a, b], [1, 2])
  stopB()
  assert.equal(connections[2].closed, true)
  const stop = service.subscribe(() => {})
  service.setIdentity(null)
  assert.equal(connections[3].current(), false)
  stop()
})
test('same-account token rotation replaces the connection without leaking stale callbacks', () => {
  const live: (() => boolean)[] = []
  let closed = 0
  const service = createLiveUpdates((_user, current) => {
    live.push(current)
    return () => {
      closed++
    }
  })
  service.setForeground(true)
  service.setIdentity({ userId: 'alice', scope: 1 })
  const stop = service.subscribe(() => {})
  service.setIdentity({ userId: 'alice', scope: 1 })
  assert.equal(live.length, 1)
  service.setIdentity({ userId: 'alice', scope: 1 }, true)
  assert.equal(closed, 1)
  assert.equal(live[0](), false)
  assert.equal(live[1](), true)
  stop()
})
test('only persisted messages covered by a permitted peer cursor are read', () => {
  const message = { sequence: 8 } as Message
  const conversation = { can_send: true, peer_read_sequence: 8 } as Conversation
  assert.equal(messageStatus(message, conversation), '已读')
  assert.equal(messageStatus(message, { ...conversation, peer_read_sequence: 7 }), '已发送')
  assert.equal(messageStatus(message, { ...conversation, peer_read_sequence: null }), '已发送')
  assert.equal(messageStatus(message, { ...conversation, peer_read_sequence: NaN }), '已发送')
  assert.equal(messageStatus(message, { ...conversation, can_send: false }), '已发送')
  assert.equal(messageStatus(message, null), '已发送')
  assert.equal(messageStatus({ ...message, delivery: 'failed' }, conversation), '未发送')
  assert.equal(messageStatus({ ...message, delivery: 'sending' }, conversation), '发送中…')
})
