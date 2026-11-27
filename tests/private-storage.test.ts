import test from 'node:test'
import assert from 'node:assert/strict'
import { privateStorageKey } from '../src/domain/private-storage'
test('logout cleanup is scoped to account drafts and transient locations, not content or other accounts', () => {
  const owner = 'account-a'
  for (const key of [
    'dyj.live.draft.account-a.post',
    'dyj.live.draft.account-a.trip',
    'dyj.live.chat.account-a.conversation',
    'dyj.live.spot-draft.account-a',
    'dyj.live.draft.guest.post',
    'dyj.live.spot-draft.guest',
    'dyj.map.selection.request'
  ])
    assert.equal(privateStorageKey(key, owner), true, key)
  for (const key of [
    'dyj.live.draft.account-ab.post',
    'dyj.live.draft.account-b.post',
    'dyj.demo.draft.account-a.post',
    'dyj.demo.database',
    'dyj.appearance.skin',
    'unrelated-app-key',
    'dyj.feed.city',
    'dyj.auth.v1'
  ])
    assert.equal(privateStorageKey(key, owner), false, key)
  assert.equal(privateStorageKey('dyj.live.draft.guest.post', ''), false)
})
