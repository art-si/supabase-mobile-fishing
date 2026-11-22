import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseDeliveryStore } from '../supabase/functions/_shared/sms-idempotency'

const baseUrl = 'https://jupuypvmgjpnpntfetqv.supabase.co'
const serviceKey = 'test-only-service-role-key'
const digest = 'a'.repeat(64)
const signal = () => new AbortController().signal
const input = (eventId: string, payloadDigest = digest) => ({
  eventId,
  payloadDigest,
  retainUntil: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
})
const migrationUrl = new URL(
  '../supabase/migrations/20261119083229_sms_hook_deliveries.sql',
  import.meta.url
)

// This transport executes only against an in-memory PGlite database. It never
// delegates to fetch and never contacts Supabase or an SMS provider.
function localRest(db: PGlite): typeof fetch {
  return (async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(request))
    assert.equal(url.origin, baseUrl)
    assert.equal(url.pathname, '/rest/v1/sms_hook_deliveries')
    const headers = new Headers(init?.headers)
    assert.equal(headers.get('apikey'), serviceKey)
    assert.equal(headers.get('authorization'), `Bearer ${serviceKey}`)
    assert.equal(init?.redirect, 'error')
    init?.signal?.throwIfAborted()
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })
    if (init?.method === 'POST') {
      assert.equal(headers.get('prefer'), 'return=representation')
      const body = JSON.parse(String(init.body))
      assert.deepEqual(Object.keys(body).sort(), [
        'event_id',
        'payload_digest',
        'reservation_id',
        'retain_until',
        'state'
      ])
      try {
        const result = await db.query(
          `
          insert into public.sms_hook_deliveries(event_id,payload_digest,reservation_id,state,retain_until)
          values($1,$2,$3,$4,$5) returning *
        `,
          [body.event_id, body.payload_digest, body.reservation_id, body.state, body.retain_until]
        )
        return json(result.rows, 201)
      } catch (error) {
        if ((error as { code?: string }).code === '23505') return json({ code: '23505' }, 409)
        throw error
      }
    }
    if (init?.method === 'GET') {
      assert.equal(url.searchParams.get('select'), 'payload_digest,state')
      const result = await db.query(
        'select payload_digest,state from public.sms_hook_deliveries where event_id=$1 limit 1',
        [url.searchParams.get('event_id')!.slice(3)]
      )
      return json(result.rows)
    }
    assert.equal(init?.method, 'PATCH')
    assert.equal(url.searchParams.get('state'), 'eq.pending')
    const body = JSON.parse(String(init?.body))
    assert.deepEqual(Object.keys(body).sort(), ['state', 'updated_at'])
    const result = await db.query(
      `
      update public.sms_hook_deliveries set state=$1,updated_at=$2
      where event_id=$3 and reservation_id=$4 and state='pending'
      returning event_id,state,reservation_id
    `,
      [
        body.state,
        body.updated_at,
        url.searchParams.get('event_id')!.slice(3),
        url.searchParams.get('reservation_id')!.slice(3)
      ]
    )
    return json(result.rows)
  }) as typeof fetch
}

test('SMS ledger migration and REST adapter are fail-closed and server-only (local PGlite)', async (t) => {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
  `)
  await db.exec(await readFile(migrationUrl, 'utf8'))
  try {
    await t.test(
      'RLS and explicit grants leave no client data access or broad service UPDATE',
      async () => {
        const result = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
          "select relrowsecurity,relforcerowsecurity from pg_class where oid='public.sms_hook_deliveries'::regclass"
        )
        assert.deepEqual(result.rows[0], { relrowsecurity: true, relforcerowsecurity: true })
        assert.equal(
          (
            await db.query(
              "select 1 from pg_policies where schemaname='public' and tablename='sms_hook_deliveries'"
            )
          ).rows.length,
          0
        )
        for (const role of ['anon', 'authenticated']) {
          for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
            assert.equal(
              (
                await db.query<{ allowed: boolean }>(
                  "select has_table_privilege($1, 'public.sms_hook_deliveries', $2) allowed",
                  [role, privilege]
                )
              ).rows[0].allowed,
              false
            )
          }
          await db.exec(`set role ${role}`)
          await assert.rejects(
            db.query('select * from public.sms_hook_deliveries'),
            /permission denied/
          )
          await db.exec('reset role')
        }
        for (const [column, expected] of [
          ['state', true],
          ['updated_at', true],
          ['event_id', false],
          ['payload_digest', false],
          ['reservation_id', false],
          ['retain_until', false]
        ] as const) {
          const { rows } = await db.query<{ allowed: boolean }>(
            "select has_column_privilege('service_role','public.sms_hook_deliveries',$1,'UPDATE') allowed",
            [column]
          )
          assert.equal(rows[0].allowed, expected)
        }
        assert.equal(
          (
            await db.query<{ allowed: boolean }>(
              "select has_table_privilege('service_role','public.sms_hook_deliveries','DELETE') allowed"
            )
          ).rows[0].allowed,
          false
        )
        const columns = await db.query<{ column_name: string }>(
          "select column_name from information_schema.columns where table_schema='public' and table_name='sms_hook_deliveries'"
        )
        assert.deepEqual(columns.rows.map((r) => r.column_name).sort(), [
          'created_at',
          'event_id',
          'payload_digest',
          'reservation_id',
          'retain_until',
          'state',
          'updated_at'
        ])
      }
    )

    await db.exec('set role service_role')
    const store = createSupabaseDeliveryStore({
      supabaseUrl: baseUrl,
      serviceRoleKey: serviceKey,
      fetch: localRest(db),
      timeoutMs: 5000
    })

    await t.test(
      'retention tolerates time elapsed between handler preparation and store claim',
      async () => {
        const handlerTime = Date.now()
        const storeTime = handlerTime + 10_000
        const delayedStore = createSupabaseDeliveryStore({
          supabaseUrl: baseUrl,
          serviceRoleKey: serviceKey,
          fetch: localRest(db),
          now: () => storeTime
        })
        const result = await delayedStore.claim(
          {
            eventId: 'clock-advanced',
            payloadDigest: digest,
            retainUntil: new Date(handlerTime + 24 * 60 * 60 * 1000).toISOString()
          },
          signal()
        )
        assert.equal(result.state, 'claimed')
        const { rows } = await db.query<{ retain_until: Date }>(
          "select retain_until from public.sms_hook_deliveries where event_id='clock-advanced'"
        )
        assert.ok(new Date(rows[0].retain_until).getTime() >= storeTime + 25 * 60 * 60 * 1000)
      }
    )

    await t.test('parallel same-event claims admit exactly one dispatch reservation', async () => {
      const claims = await Promise.all(
        Array.from({ length: 16 }, () => store.claim(input('parallel-event'), signal()))
      )
      assert.equal(claims.filter((c) => c.state === 'claimed').length, 1)
      assert.equal(claims.filter((c) => c.state === 'pending').length, 15)
      assert.equal(
        (await db.query("select * from public.sms_hook_deliveries where event_id='parallel-event'"))
          .rows.length,
        1
      )
      const owner = claims.find((c) => c.state === 'claimed')!
      assert.equal(owner.state, 'claimed')
      if (owner.state !== 'claimed') throw new Error('missing reservation')
      await store.complete(
        { eventId: 'parallel-event', reservationId: owner.reservationId, outcome: 'succeeded' },
        signal()
      )
      assert.deepEqual(await store.claim(input('parallel-event'), signal()), { state: 'succeeded' })
      assert.deepEqual(await store.claim(input('parallel-event', 'b'.repeat(64)), signal()), {
        state: 'conflict'
      })
    })

    await t.test(
      'unknown/failed/pending are never reclaimed and CAS cannot overwrite a terminal result',
      async () => {
        for (const outcome of ['unknown', 'failed'] as const) {
          const claimed = await store.claim(input(`case-${outcome}`), signal())
          assert.equal(claimed.state, 'claimed')
          if (claimed.state !== 'claimed') throw new Error('missing reservation')
          await assert.rejects(
            store.complete(
              { eventId: `case-${outcome}`, reservationId: randomUUID(), outcome: 'succeeded' },
              signal()
            ),
            /SMS_DELIVERY_STORE_UNAVAILABLE/
          )
          assert.deepEqual(await store.claim(input(`case-${outcome}`), signal()), {
            state: 'pending'
          })
          await store.complete(
            { eventId: `case-${outcome}`, reservationId: claimed.reservationId, outcome },
            signal()
          )
          assert.deepEqual(await store.claim(input(`case-${outcome}`), signal()), {
            state: outcome
          })
          await assert.rejects(
            store.complete(
              {
                eventId: `case-${outcome}`,
                reservationId: claimed.reservationId,
                outcome: 'succeeded'
              },
              signal()
            ),
            /SMS_DELIVERY_STORE_UNAVAILABLE/
          )
        }
        await db.exec('reset role')
        await db.query(
          "update public.sms_hook_deliveries set created_at=now()-interval '3 days', retain_until=now()-interval '1 day' where event_id='case-unknown'"
        )
        await db.exec('set role service_role')
        assert.deepEqual(await store.claim(input('case-unknown'), signal()), { state: 'unknown' })
      }
    )

    await t.test(
      'lost INSERT response leaves a durable pending record, never a fresh reservation',
      async () => {
        const actual = localRest(db)
        let calls = 0
        const lostResponse = (async (...args: Parameters<typeof fetch>) => {
          calls++
          await actual(...args)
          throw new Error('private transport diagnostics must not leak')
        }) as typeof fetch
        const failing = createSupabaseDeliveryStore({
          supabaseUrl: baseUrl,
          serviceRoleKey: serviceKey,
          fetch: lostResponse
        })
        await assert.rejects(
          failing.claim(input('lost-response'), signal()),
          /^Error: SMS_DELIVERY_STORE_UNAVAILABLE$/
        )
        assert.equal(calls, 1)
        assert.deepEqual(await store.claim(input('lost-response'), signal()), { state: 'pending' })
      }
    )
  } finally {
    await db.close()
  }
})

test('SMS ledger rejects invalid configuration/input and aborted calls without transport', async () => {
  let calls = 0
  const forbiddenFetch = (async () => {
    calls++
    throw new Error('network forbidden')
  }) as typeof fetch
  const store = createSupabaseDeliveryStore({
    supabaseUrl: baseUrl,
    serviceRoleKey: serviceKey,
    fetch: forbiddenFetch
  })
  for (const url of [
    'http://example.com',
    `${baseUrl}/other`,
    `${baseUrl}?q=secret`,
    'https://user:pass@example.com'
  ]) {
    assert.throws(
      () =>
        createSupabaseDeliveryStore({
          supabaseUrl: url,
          serviceRoleKey: serviceKey,
          fetch: forbiddenFetch
        }),
      /SMS_DELIVERY_STORE_UNAVAILABLE/
    )
  }
  for (const bad of [
    input('bad,filter'),
    input('x', '123'),
    { ...input('x'), retainUntil: new Date().toISOString() }
  ]) {
    await assert.rejects(store.claim(bad, signal()), /SMS_DELIVERY_STORE_UNAVAILABLE/)
  }
  const cancelled = new AbortController()
  cancelled.abort()
  await assert.rejects(
    store.claim(input('aborted'), cancelled.signal),
    /SMS_DELIVERY_STORE_UNAVAILABLE/
  )
  assert.equal(calls, 0)
})

test('SMS ledger sanitizes malformed/permission responses and bounds timeout without retry', async () => {
  for (const response of [
    new Response('private denial', { status: 403 }),
    new Response(JSON.stringify({ code: 'unrelated', message: 'private' }), { status: 409 }),
    new Response('not json', { status: 201 }),
    new Response('[]', { status: 201 })
  ]) {
    let calls = 0
    const store = createSupabaseDeliveryStore({
      supabaseUrl: baseUrl,
      serviceRoleKey: serviceKey,
      fetch: (async () => {
        calls++
        return response
      }) as typeof fetch
    })
    await assert.rejects(
      store.claim(input('bad-response'), signal()),
      /^Error: SMS_DELIVERY_STORE_UNAVAILABLE$/
    )
    assert.equal(calls, 1)
  }
  let timedCalls = 0
  const store = createSupabaseDeliveryStore({
    supabaseUrl: baseUrl,
    serviceRoleKey: serviceKey,
    timeoutMs: 15,
    fetch: (async (_request, init) => {
      timedCalls++
      return await new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(new Error('private timeout')), {
          once: true
        })
      })
    }) as typeof fetch
  })
  await assert.rejects(
    store.claim(input('timed-out'), signal()),
    /^Error: SMS_DELIVERY_STORE_UNAVAILABLE$/
  )
  assert.equal(timedCalls, 1)
})
