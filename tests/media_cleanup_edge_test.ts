import { createMediaCleanupHandler } from '../supabase/functions/media-cleanup/handler.ts'
const secret = 'ab'.repeat(32),
  now = 1795138000000
const owner = '11111111-1111-4111-8111-111111111111'
const check = (ok: unknown, label: string) => {
  if (!ok) throw new Error(label)
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
function job(attempt = 1) {
  const id = crypto.randomUUID()
  return {
    job_id: id,
    owner_id: owner,
    path: `${owner}/${id}.jpg`,
    lease_token: crypto.randomUUID(),
    attempt
  }
}
async function signed(time = Math.floor(now / 1000), keyValue = secret, body: unknown = {}) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(keyValue),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const raw = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`fishing-media-cleanup.v1.${time}`)
  )
  return new Request('https://fixture.invalid/media-cleanup', {
    method: 'POST',
    headers: {
      'x-cleanup-time': String(time),
      'x-cleanup-signature': [...new Uint8Array(raw)]
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('')
    },
    body: JSON.stringify(body)
  })
}
Deno.test(
  'cleanup rejects public credentials, wrong/expired/future signatures and non-POST methods before service calls',
  async () => {
    let calls = 0
    const handler = createMediaCleanupHandler({
      secret: () => secret,
      now: () => now,
      service: async () => {
        calls++
        return json([])
      }
    })
    check(
      (await handler(new Request('https://fixture.invalid', { method: 'GET' }))).status === 405,
      'GET denied'
    )
    check(
      (
        await handler(
          new Request('https://fixture.invalid', {
            method: 'POST',
            headers: { Authorization: 'Bearer public-user-token', apikey: 'public-key' }
          })
        )
      ).status === 401,
      'client credentials denied'
    )
    for (const request of [
      await signed(undefined, 'cd'.repeat(32)),
      await signed(now / 1000 - 91),
      await signed(now / 1000 + 6)
    ])
      check((await handler(request)).status === 401, 'signature/time denied')
    check(calls === 0, 'no backend calls without valid scoped authorization')
  }
)
Deno.test('cleanup configuration failure is explicit and never exposes a secret', async () => {
  for (const value of ['', 'abc']) {
    const handler = createMediaCleanupHandler({
      secret: () => value,
      service: async () => {
        throw new Error('must not call')
      }
    })
    check((await handler(await signed())).status === 503, 'missing/invalid key')
  }
  const handler = createMediaCleanupHandler({
    secret: () => {
      throw new Error('private-value')
    },
    service: async () => json([])
  })
  const response = await handler(await signed())
  check(
    response.status === 503 && !(await response.text()).includes('private-value'),
    'error is redacted'
  )
})
Deno.test(
  'cleanup accepts the time boundary and an empty queue without touching Storage',
  async () => {
    const paths: string[] = []
    const handler = createMediaCleanupHandler({
      secret: () => secret,
      now: () => now,
      service: async (path) => {
        paths.push(path)
        return json([])
      }
    })
    const response = await handler(await signed(now / 1000 - 90))
    check(response.status === 200 && (await response.json()).claimed === 0, 'empty queue')
    check(paths.length === 1 && paths[0].endsWith('_claim'), 'only claim called')
  }
)
Deno.test('cleanup validates every job before making any deletion request', async () => {
  const valid = job()
  for (const batch of [
    [valid, { ...job(), path: '../other/file.jpg' }],
    [valid, valid],
    Array.from({ length: 9 }, () => job()),
    { paths: [valid.path] }
  ]) {
    let calls = 0
    const handler = createMediaCleanupHandler({
      secret: () => secret,
      now: () => now,
      service: async () => {
        calls++
        return json(batch)
      }
    })
    check(
      (await handler(await signed())).status === 502 && calls === 1,
      'bad response never reaches Storage'
    )
  }
})
Deno.test(
  'cleanup only uses queued paths, treats absent objects idempotently, and returns aggregate counts',
  async () => {
    const item = job(),
      calls: { path: string; body: Record<string, unknown> }[] = []
    const handler = createMediaCleanupHandler({
      secret: () => secret,
      now: () => now,
      service: async (path, options) => {
        const body = JSON.parse(String(options?.body))
        calls.push({ path, body })
        if (path.endsWith('_claim')) return json([item])
        if (path.startsWith('/storage/')) return json([])
        check(
          body.succeeded === true && body.lease === item.lease_token,
          'acknowledges exact lease'
        )
        return json('done')
      }
    })
    const response = await handler(
      await signed(undefined, undefined, { paths: ['somebody/else.jpg'], bucket: 'other' })
    )
    const body = await response.text()
    check(
      JSON.parse(body).completed === 1 && !body.includes(item.path) && !body.includes(owner),
      'aggregate response has no identifiers'
    )
    check(
      calls[1].path === '/storage/v1/object/fishing-media' &&
        JSON.stringify(calls[1].body.prefixes) === JSON.stringify([item.path]),
      'caller payload cannot choose deletion target'
    )
  }
)
Deno.test(
  'cleanup keeps Storage and acknowledgement failures separate and does not claim false completion',
  async () => {
    const jobs = [job(), job(12), job(), job()]
    const outcomes: Record<string, unknown>[] = []
    const handler = createMediaCleanupHandler({
      secret: () => secret,
      now: () => now,
      service: async (path, options) => {
        const body = JSON.parse(String(options?.body))
        if (path.endsWith('_claim')) return json(jobs)
        if (path.startsWith('/storage/')) {
          const index = jobs.findIndex((j) => j.path === body.prefixes[0])
          if (index === 0) return json({ error: 'unavailable' }, 503)
          if (index === 1) throw new Error('private URL must not be logged')
          if (index === 2) return json({ not: 'a deletion result' })
          return json([{ name: body.prefixes[0] }])
        }
        outcomes.push(body)
        if (body.job_id === jobs[3].job_id) return json({ error: 'ack unavailable' }, 503)
        return json(body.job_id === jobs[1].job_id ? 'failed' : 'pending')
      }
    })
    const result = await (await handler(await signed())).json()
    check(
      result.completed === 0 &&
        result.retrying === 2 &&
        result.failed === 1 &&
        result.unacknowledged === 1,
      'actual queue state is counted'
    )
    check(
      outcomes.filter((o) => o.succeeded === false).length === 3,
      'failed deletion is never acknowledged as success'
    )
    check(
      outcomes.find((o) => o.job_id === jobs[2].job_id)?.failure === 'STORAGE_PROTOCOL_ERROR',
      'malformed success is retryable'
    )
  }
)
Deno.test('cleanup caps worker concurrency and rejects failed queue reads', async () => {
  let active = 0,
    max = 0
  const jobs = Array.from({ length: 8 }, () => job())
  const handler = createMediaCleanupHandler({
    secret: () => secret,
    now: () => now,
    service: async (path, options) => {
      if (path.endsWith('_claim')) return json(jobs)
      if (path.endsWith('_finish')) return json('done')
      active++
      max = Math.max(max, active)
      await new Promise((done) => setTimeout(done, 5))
      active--
      return json([{ name: JSON.parse(String(options?.body)).prefixes[0] }])
    }
  })
  check(
    (await (await handler(await signed())).json()).completed === 8 && max <= 4,
    'bounded workers'
  )
  const failed = createMediaCleanupHandler({
    secret: () => secret,
    now: () => now,
    service: async () => json({}, 500)
  })
  check((await failed(await signed())).status === 502, 'queue unavailable')
})
