import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commentAttempt, mergeComments } from '../src/domain/comments'
import type { Comment } from '../src/domain/models'
test('comment retries preserve identity only for the unchanged trimmed payload', () => {
  let sequence = 0
  const id = () => String(++sequence)
  const first = commentAttempt(undefined, 'post', '  经验  ', null, id)
  assert.equal(commentAttempt(first, 'post', '经验', null, id), first)
  assert.notEqual(commentAttempt(first, 'post', '不同', null, id).id, first.id)
  assert.notEqual(commentAttempt(first, 'post', '经验', 'reply', id).id, first.id)
  assert.notEqual(commentAttempt(first, 'other', '经验', null, id).id, first.id)
})
test('overlapping comment pages do not duplicate existing rows', () => {
  const a = { id: 'a' } as Comment,
    b = { id: 'b' } as Comment,
    c = { id: 'c' } as Comment
  assert.deepEqual(mergeComments([a, b], [b, c]), [a, b, c])
})

test('mixed-media comment retries reuse identity only while ordered attachments stay unchanged',()=>{
 let sequence=0
 const id=()=>String(++sequence)
 const first=commentAttempt(undefined,'post','😊',null,id,[{id:'photo'},{id:'video'}])
 assert.equal(commentAttempt(first,'post',' 😊 ',null,id,[{id:'photo'},{id:'video'}]),first)
 assert.notEqual(commentAttempt(first,'post','😊',null,id,[{id:'video'},{id:'photo'}]).id,first.id)
 assert.notEqual(commentAttempt(first,'post','😊',null,id,[{id:'photo'}]).id,first.id)
 assert.notEqual(commentAttempt(first,'post','😊',null,id,[]).id,first.id)
 assert.equal(commentAttempt(undefined,'post','',null,id,[{id:'photo'}]).body,'')
 assert.deepEqual(first.media,[{id:'photo'},{id:'video'}])
})
