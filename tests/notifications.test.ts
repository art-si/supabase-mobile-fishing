import test from 'node:test'
import assert from 'node:assert/strict'
import {
  hasNewNotification,
  notificationCount,
  notificationUrl,
  refreshNotifications,
  type InboxNotification
} from '../src/domain/notifications'
const item: InboxNotification = {
  id: '10',
  kind: 'comment',
  category: 'interaction',
  created_at: '2026-11-20T00:00:00Z',
  read: false,
  available: true,
  title: '标题',
  preview: '正文',
  target: { type: 'post', id: '11111111-1111-4111-8111-111111111111' }
}
test('unread count is bounded for display, bigint IDs never use lossy numeric comparison', () => {
  assert.equal(notificationCount(100), '99+')
  assert.equal(notificationCount(0), '0')
  assert.equal(hasNewNotification('10', '9'), true)
  assert.equal(hasNewNotification('9', '10'), false)
  assert.equal(hasNewNotification('9007199254740993', '9007199254740992'), true)
  assert.equal(hasNewNotification('9007199254740992', '9007199254740993'), false)
  assert.equal(hasNewNotification('1'), true)
  assert.equal(hasNewNotification(null, '1'), false)
  assert.equal(hasNewNotification('invalid', '1'), false)
})
test('notification destinations are closed allowlist, not arbitrary URLs or privileged review pages', () => {
  assert.match(notificationUrl(item)!, /^\/pages\/post\/detail\?id=/)
  assert.equal(notificationUrl({ ...item, available: false }), null)
  assert.equal(notificationUrl({ ...item, target: null }), null)
  assert.equal(notificationUrl({ ...item, target: { type: 'post', id: 'id&admin=1' } }), null)
  assert.equal(
    notificationUrl({ ...item, target: { type: 'reports', id: item.target!.id } }),
    '/pages/content-report/index'
  )
  assert.equal(
    notificationUrl({ ...item, target: { type: 'zones', id: item.target!.id } }),
    '/pages/map/marks'
  )
})
test('refresh replaces private snapshots, removes deleted rows, preserves reading order without inserting new events', () => {
  const second = { ...item, id: '9' },
    missing = { ...item, id: '8' }
  const redacted = {
    ...item,
    available: false,
    target: null,
    title: '内容已不可见',
    preview: '',
    read: true
  }
  const result = refreshNotifications(
    [item, second, missing],
    [second, redacted, { ...item, id: '11' }]
  )
  assert.deepEqual(result, [redacted, second])
  assert.equal(result[0].preview, '')
})
