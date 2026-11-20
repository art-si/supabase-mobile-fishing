import test from 'node:test'
import assert from 'node:assert/strict'
import { freshDraft, validateDraft } from '../src/domain/rules'
import { moveCompositionPhoto, postCaption } from '../src/domain/composition'
import { editAttempt, editFields } from '../src/domain/content-edit'

test('posts accept body or photos, not a title alone or whitespace', () => {
  const draft = freshDraft()
  assert.deepEqual(Object.keys(validateDraft(draft)), ['body', 'post-location'])
  Object.assign(draft, {
    location_label: '测试水域',
    location_longitude: 120.62,
    location_latitude: 31.32
  })
  draft.title = '只有标题'
  draft.body = '\n\t　 '
  assert.ok(validateDraft(draft).body)
  draft.title = ''
  draft.body = '水边观察'
  assert.deepEqual(validateDraft(draft), {})
  draft.body = ''
  draft.media = [{ id: 'photo', path: 'private', width: 20, height: 30 }]
  assert.deepEqual(validateDraft(draft), {})
  draft.media = Array.from({ length: 10 }, () => draft.media[0])
  assert.ok(validateDraft(draft).media)
})
test('private logs need a title and date, but no text/photo/catch is forced', () => {
  const draft = freshDraft()
  assert.deepEqual(Object.keys(validateDraft(draft, 'trip')), ['title'])
  draft.title = '今天空军'
  assert.deepEqual(validateDraft(draft, 'trip'), {})
  draft.occurred_on = ''
  assert.ok(validateDraft(draft, 'trip').occurred_on)
})
test('display captions never invent a persisted title or show an empty accessible name', () => {
  const post = { title: '', body: '水边\n观察', kind: 'catch' as const }
  assert.equal(postCaption(post), '水边 观察')
  assert.equal(post.title, '')
  assert.equal(postCaption({ ...post, body: '' }), '渔获分享')
  assert.equal(postCaption({ ...post, body: '\n　', kind: 'experience' }), '钓鱼心得')
  assert.equal(postCaption({ ...post, title: '标题' }), '标题')
})
test('photo movement preserves identity and rejects invalid destinations', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    first = items[0]
  assert.equal(moveCompositionPhoto(items, 0, 2), true)
  assert.deepEqual(
    items.map((x) => x.id),
    ['b', 'c', 'a']
  )
  assert.equal(items[2], first)
  for (const [from, to] of [
    [0, -1],
    [0, 3],
    [NaN, 0],
    [0.5, 1],
    [1, 1]
  ])
    assert.equal(moveCompositionPhoto(items, from, to), false)
  assert.deepEqual(
    items.map((x) => x.id),
    ['b', 'c', 'a']
  )
})
test('editing serializes ordered IDs only and a new order changes the retry signature', () => {
  const draft = freshDraft()
  draft.media = ['a', 'b', 'c'].map((id) => ({
    id,
    path: 'secret',
    url: 'signed',
    width: 1,
    height: 1
  }))
  draft.title = '　'
  draft.body = '\n'
  const before = editAttempt('post', draft, 1)
  moveCompositionPhoto(draft.media, 2, 0)
  const after = editAttempt('post', draft, 1, before.attempt)
  assert.notEqual(before.attempt.requestId, after.attempt.requestId)
  assert.deepEqual(editFields('post', draft).media, [{ id: 'c' }, { id: 'a' }, { id: 'b' }])
  assert.equal(editFields('post', draft).title, '')
  assert.equal(editFields('post', draft).body, '')
})
