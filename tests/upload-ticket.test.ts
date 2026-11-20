import test from 'node:test'
import assert from 'node:assert/strict'
import { reserveUploadTicket } from '../supabase/functions/_shared/upload-ticket'

test('upload ticket forwards verified user identity and reserves before allowing upload', async () => {
  let calls = 0
  const result = await reserveUploadTicket(
    'https://project.invalid',
    'public-key',
    'user-token',
    async (url, init) => {
      calls++
      assert.equal(url, 'https://project.invalid/rest/v1/rpc/fishing_write')
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer user-token')
      assert.equal(new Headers(init?.headers).get('apikey'), 'public-key')
      assert.deepEqual(JSON.parse(String(init?.body)), { action: 'upload_ticket', payload: {} })
      assert.ok(init?.signal)
      return Response.json('ticket-id')
    }
  )
  assert.equal(result, null)
  assert.equal(calls, 1)
})
test('only an explicit quota rejection is reported as upload rate limiting', async () => {
  const quota = await reserveUploadTicket('https://project.invalid', 'key', 'token', async () =>
    Response.json({ code: 'P0001', message: 'RATE_LIMIT' }, { status: 400 })
  )
  assert.equal(quota?.status, 429)
  assert.deepEqual(await quota?.json(), { error: 'UPLOAD_RATE_LIMIT' })
  for (const reply of [
    Response.json({ code: '42702', message: 'private SQL detail' }, { status: 400 }),
    new Response('upstream failed', { status: 502 }),
    new Response('gateway quota, not a user quota', { status: 429 })
  ]) {
    const result = await reserveUploadTicket(
      'https://project.invalid',
      'key',
      'token',
      async () => reply
    )
    assert.equal(result?.status, 503)
    assert.deepEqual(await result?.json(), { error: 'UPLOAD_UNAVAILABLE' })
  }
})
test('invalid identity and transport failure remain fail-closed', async () => {
  for (const status of [401, 403]) {
    const reply = await reserveUploadTicket(
      'https://project.invalid',
      'key',
      'token',
      async () => new Response('', { status })
    )
    assert.equal(reply?.status, 401)
  }
  const reply = await reserveUploadTicket('https://project.invalid', 'key', 'token', async () => {
    throw new Error('private token must not leak')
  })
  assert.equal(reply?.status, 503)
  assert.deepEqual(await reply?.json(), { error: 'UPLOAD_UNAVAILABLE' })
})
