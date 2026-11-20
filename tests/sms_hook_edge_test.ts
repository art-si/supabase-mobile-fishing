import { Webhook } from 'npm:standardwebhooks@1.0.0'
import { createSupabaseDeliveryStore } from '../supabase/functions/_shared/sms-idempotency.ts'
import {
  createSmsHookHandler,
  type ClaimResult,
  type DeliveryOutcome,
  type DurableDeliveryStore,
  type SmsHookConfig,
  type SmsHookDependencies
} from '../supabase/functions/send-sms-hook/handler.ts'
import {
  hmacSha256,
  sendPnvsSms,
  signAcs3,
  type PnvsConfig,
  type SmsMessage
} from '../supabase/functions/send-sms-hook/pnvs.ts'

// All secrets, numbers, responses and stores below are test-only fixtures.
// Deno runs this suite WITHOUT --allow-net or --allow-env. No real SMS is sent.
const hookKey = btoa('h'.repeat(32))
const fingerprintKey = btoa('i'.repeat(32))
const config: SmsHookConfig = {
  deliveryEnabled: true,
  allowedTestPhones: ['+8613800000000', '+8613900000000'],
  hookSecret: `v1,whsec_${hookKey}`,
  idempotencySecret: fingerprintKey,
  accessKeyId: 'TestAccessKeyId',
  accessKeySecret: 'test-access-key-secret-never-real',
  signName: '测试签名',
  templateCode: '100001',
  schemeName: '钓友集测试',
  otpExpirySeconds: 300,
  intervalSeconds: 60
}
const event = { user: { phone: '+8613800000000' }, sms: { otp: '012345' } }

Deno.test(
  'SMS hook preserves completion budget after a slow claim and accepted delivery',
  async () => {
    const ledger = ledgerFixture()
    const originalClaim = ledger.store.claim.bind(ledger.store)
    const originalComplete = ledger.store.complete.bind(ledger.store)
    ledger.store.claim = async (input, signal) => {
      await new Promise((resolve) => setTimeout(resolve, 800))
      return originalClaim(input, signal)
    }
    ledger.store.complete = async (input, signal) => {
      await new Promise((resolve) => setTimeout(resolve, 800))
      return originalComplete(input, signal)
    }
    const f = fixture({
      store: ledger.store,
      send: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        return 'accepted'
      }
    })
    const started = performance.now()
    check(
      (await f.handler(signed())).status === 200,
      'accepted delivery can persist success after slow claim'
    )
    check(
      ledger.completions[0].outcome === 'succeeded' && performance.now() - started < 4500,
      'completion fits the total budget'
    )
  }
)

Deno.test('SMS hook dynamically shortens dispatch to leave durable completion time', async () => {
  const ledger = ledgerFixture()
  const originalClaim = ledger.store.claim.bind(ledger.store)
  const originalComplete = ledger.store.complete.bind(ledger.store)
  ledger.store.claim = async (input, signal) => {
    // Simulate earlier body/verification/claim work consuming most of the budget.
    await new Promise((resolve) => setTimeout(resolve, 2400))
    return originalClaim(input, signal)
  }
  ledger.store.complete = async (input, signal) => {
    await new Promise((resolve) => setTimeout(resolve, 800))
    return originalComplete(input, signal)
  }
  let aborted = false
  let calls = 0
  const f = fixture({
    store: ledger.store,
    send: (_config, _message, signal) => {
      calls++
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => {
            aborted = true
            reject(new Error('fixture dispatch timeout'))
          },
          { once: true }
        )
      )
    }
  })
  const started = performance.now()
  check((await f.handler(signed())).status === 500, 'unknown outcome is not a login success')
  check(
    aborted && calls === 1 && ledger.completions[0].outcome === 'unknown',
    'deadline still allows durable unknown receipt'
  )
  check(performance.now() - started < 4500, 'dispatch plus receipt fits total budget')
})

Deno.test('SMS hook blocks absent, invalid or non-matching server test allowlists', async () => {
  for (const allowedTestPhones of [
    [],
    ['*'],
    ['13800000000'],
    ['8613800000000'],
    ['+8613700000000'],
    ['+8613800000000', 'invalid']
  ]) {
    const f = fixture({ config: () => ({ ...config, allowedTestPhones }) })
    check((await f.handler(signed())).status === 500, 'test recipient must be explicitly allowed')
    check(
      f.sends.length === 0 && f.claims.length === 0,
      'blocked requests do not reach provider or ledger'
    )
  }
})

Deno.test(
  'SMS hook integrates the real durable REST adapter without network permission',
  async () => {
    const requests: string[] = []
    let reservation: Record<string, unknown> = {}
    const store = createSupabaseDeliveryStore({
      supabaseUrl: 'https://test.invalid',
      serviceRoleKey: 'server-test-fixture-only',
      fetch: ((_input: unknown, init?: RequestInit) => {
        requests.push(init?.method || '')
        const body = JSON.parse(String(init?.body))
        if (init?.method === 'POST') {
          reservation = body
          return Promise.resolve(Response.json([body], { status: 201 }))
        }
        return Promise.resolve(Response.json([{ ...reservation, ...body }]))
      }) as typeof fetch
    })
    const f = fixture({ store })
    check(
      (await f.handler(signed())).status === 200 && f.sends.length === 1,
      'adapter and handler contracts match'
    )
    check(
      JSON.stringify(requests) === JSON.stringify(['POST', 'PATCH']),
      'reserve, send, complete exactly once'
    )
    const stored = JSON.stringify(reservation)
    check(
      !stored.includes(event.user.phone) && !stored.includes(event.sms.otp),
      'persistent request contains only keyed fingerprint and metadata'
    )
  }
)

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

function signed(body = JSON.stringify(event), id = 'event-fixture-1', seconds = Date.now() / 1000) {
  const date = new Date(Math.floor(seconds) * 1000)
  const headers = {
    'content-type': 'application/json',
    'webhook-id': id,
    'webhook-timestamp': String(Math.floor(date.getTime() / 1000)),
    'webhook-signature': new Webhook(hookKey).sign(id, date, body)
  }
  return new Request('https://test.invalid/send-sms-hook', { method: 'POST', body, headers })
}

// This is an explicitly simulated ledger for contract tests, NOT an implementation
// exported by production code and NOT evidence of database durability.
function ledgerFixture() {
  const records = new Map<
    string,
    { digest: string; state: DeliveryOutcome | 'pending'; token: string }
  >()
  const claims: { eventId: string; payloadDigest: string; retainUntil: string }[] = []
  const completions: { eventId: string; reservationId: string; outcome: DeliveryOutcome }[] = []
  const store: DurableDeliveryStore = {
    persistence: 'durable',
    claim(input, signal) {
      signal.throwIfAborted()
      claims.push(input)
      const old = records.get(input.eventId)
      if (old)
        return Promise.resolve<ClaimResult>({
          state: old.digest !== input.payloadDigest ? 'conflict' : old.state
        })
      const token = 'reservation-fixture'
      records.set(input.eventId, { digest: input.payloadDigest, state: 'pending', token })
      return Promise.resolve({ state: 'claimed', reservationId: token })
    },
    complete(input, signal) {
      signal.throwIfAborted()
      completions.push(input)
      const old = records.get(input.eventId)
      if (!old || old.token !== input.reservationId)
        return Promise.reject(new Error('fixture CAS failure'))
      old.state = input.outcome
      return Promise.resolve()
    }
  }
  return { store, claims, completions, records }
}

function fixture(overrides: Partial<SmsHookDependencies> = {}) {
  const ledger = ledgerFixture()
  const sends: SmsMessage[] = []
  const handler = createSmsHookHandler({
    config: () => config,
    store: ledger.store,
    send: async (_config, message) => {
      sends.push(message)
      return 'accepted'
    },
    ...overrides
  })
  return { handler, sends, ...ledger }
}

Deno.test(
  'SMS hook rejects non-POST and unsigned requests without delivery or claims',
  async () => {
    const f = fixture()
    for (const method of ['GET', 'OPTIONS', 'PUT']) {
      const response = await f.handler(new Request('https://test.invalid', { method }))
      check(response.status === 405, 'only POST is accepted')
    }
    const response = await f.handler(
      new Request('https://test.invalid', { method: 'POST', body: '{}' })
    )
    check(
      response.status === 401 && f.sends.length === 0 && f.claims.length === 0,
      'unsigned calls cost nothing'
    )
  }
)

Deno.test(
  'SMS hook verifies the exact raw body and rejects stale/future/tampered signatures',
  async () => {
    const f = fixture()
    for (const seconds of [Date.now() / 1000 - 1000, Date.now() / 1000 + 1000])
      check(
        (await f.handler(signed(undefined, 'expired-fixture', seconds))).status === 401,
        'invalid timestamp'
      )
    const original = signed()
    const altered = new Request(original.url, {
      method: 'POST',
      headers: original.headers,
      body: JSON.stringify(event, null, 2)
    })
    check((await f.handler(altered)).status === 401, 'whitespace changes are signed too')
    const wrong = signed()
    wrong.headers.set('webhook-signature', 'v1,not-a-valid-signature')
    check((await f.handler(wrong)).status === 401, 'bad signature rejected')
    check(
      f.sends.length === 0 && f.claims.length === 0,
      'verification comes before any side effect'
    )
  }
)

Deno.test(
  'SMS hook requires strict secret formats, explicit enablement and a durable store',
  async () => {
    for (const patch of [
      { deliveryEnabled: false },
      { hookSecret: '' },
      { hookSecret: hookKey },
      { hookSecret: 'v1,whsec_bad' },
      { idempotencySecret: '' },
      { accessKeyId: '' },
      { accessKeySecret: '' },
      { signName: '' },
      { templateCode: '' },
      { schemeName: '' },
      { otpExpirySeconds: NaN },
      { otpExpirySeconds: 301 },
      { intervalSeconds: 5 },
      { securityToken: 'line\nbreak' }
    ]) {
      const f = fixture({ config: () => ({ ...config, ...patch }) })
      check(
        (await f.handler(signed())).status !== 200,
        'invalid or disabled configuration fails closed'
      )
      check(f.sends.length === 0 && f.claims.length === 0, 'no external side effects')
    }
    for (const store of [undefined, { persistence: 'memory' } as unknown as DurableDeliveryStore]) {
      const f = fixture({ store })
      check(
        (await f.handler(signed())).status === 500 && f.sends.length === 0,
        'missing durable ledger blocks delivery'
      )
    }
  }
)

Deno.test(
  'SMS hook accepts only six-digit OTP and mainland E.164, including Supabase digits-only wire form',
  async () => {
    for (const phone of [
      '13800000000',
      '+13123456789',
      ' +8613800000000',
      '+86 13800000000',
      '+8612800000000',
      8613800000000
    ]) {
      const f = fixture()
      const response = await f.handler(
        signed(JSON.stringify({ user: { phone }, sms: { otp: '123456' } }))
      )
      check(
        response.status === 400 && f.sends.length === 0,
        'non-E.164 or non-mainland phone is rejected'
      )
    }
    for (const otp of ['12345', '1234567', 123456, ' 123456', '12a456', null]) {
      const f = fixture()
      const response = await f.handler(signed(JSON.stringify({ user: event.user, sms: { otp } })))
      check(response.status === 400 && f.sends.length === 0, 'invalid OTP never sent')
    }
    const f = fixture()
    check(
      (
        await f.handler(
          signed(JSON.stringify({ user: { phone: '8613800000000' }, sms: event.sms }))
        )
      ).status === 200,
      'Supabase digits-only E.164 is accepted'
    )
    check(
      f.sends[0].phone === event.user.phone && f.sends[0].otp === '012345',
      'normalize phone and retain leading OTP zero'
    )
  }
)

Deno.test(
  'SMS destination takes precedence over old user phone, but invalid explicit destination cannot fall back',
  async () => {
    const f = fixture()
    const body = JSON.stringify({
      user: event.user,
      sms: { phone: '+8613900000000', otp: '123456' }
    })
    check((await f.handler(signed(body))).status === 200, 'new destination accepted')
    check(f.sends[0].phone === '+8613900000000', 'send only to the explicitly signed destination')
    const invalid = fixture()
    check(
      (
        await invalid.handler(
          signed(JSON.stringify({ user: event.user, sms: { phone: '', otp: '123456' } }))
        )
      ).status === 400,
      'empty explicit destination fails closed'
    )
    check(invalid.sends.length === 0, 'never fall back to old phone')
  }
)

Deno.test(
  'SMS hook rejects oversized streaming payloads before verification, ledger or sending',
  async () => {
    let cancelled = false
    const body = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(4096))
      },
      cancel() {
        cancelled = true
      }
    })
    const request = new Request('https://test.invalid', {
      method: 'POST',
      body,
      headers: signed().headers
    })
    const f = fixture()
    check((await f.handler(request)).status === 500, 'oversized payload rejected')
    check(
      cancelled && f.sends.length === 0 && f.claims.length === 0,
      'stream cancelled with no effects'
    )
  }
)

Deno.test(
  'SMS hook uses an independent HMAC fingerprint and stores no phone/OTP/payload',
  async () => {
    const f = fixture()
    const body = JSON.stringify(event, null, 2)
    const response = await f.handler(signed(body))
    check(
      response.status === 200 && (await response.text()) === '{}',
      'success returns no sensitive fields'
    )
    const expected = await hmacSha256(new TextEncoder().encode('i'.repeat(32)), body)
    check(f.claims[0].payloadDigest === expected, 'keyed fingerprint binds the raw payload')
    check(
      Date.parse(f.claims[0].retainUntil) > Date.now() + 23 * 60 * 60 * 1000,
      'durable retention exceeds signature window'
    )
    const ledgerText = JSON.stringify([f.claims, f.completions])
    check(
      !ledgerText.includes(event.user.phone) && !ledgerText.includes(event.sms.otp),
      'ledger receives no phone or OTP'
    )
    check(
      response.headers.get('cache-control') === 'no-store' &&
        !response.headers.has('access-control-allow-origin'),
      'not a browser CORS endpoint and not cacheable'
    )
  }
)

Deno.test(
  'SMS hook successful replay returns success without sending, conflicting payload remains blocked',
  async () => {
    const f = fixture()
    check((await f.handler(signed())).status === 200, 'first delivery succeeds')
    check(
      (await f.handler(signed())).status === 200 && f.sends.length === 1,
      'same successful event is idempotent'
    )
    const changed = JSON.stringify({ ...event, sms: { otp: '654321' } })
    check(
      (await f.handler(signed(changed))).status === 500 && f.sends.length === 1,
      'event ID cannot bind a different payload'
    )
  }
)

Deno.test('SMS hook never reclaims pending, unknown, failed or conflicted events', async () => {
  for (const state of ['pending', 'unknown', 'failed', 'conflict'] as const) {
    const ledger = ledgerFixture()
    ledger.store.claim = () => Promise.resolve({ state })
    const f = fixture({ store: ledger.store })
    check((await f.handler(signed())).status === 500 && f.sends.length === 0, `${state} is blocked`)
  }
})

Deno.test('SMS hook concurrent requests share an atomic claim and cannot double-send', async () => {
  const ledger = ledgerFixture()
  let release!: () => void
  let count = 0
  const f = fixture({
    store: ledger.store,
    send: async () => {
      count++
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return 'accepted'
    }
  })
  const first = f.handler(signed())
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0))
  check((await f.handler(signed())).status === 500 && count === 1, 'pending duplicate is not sent')
  release()
  check((await first).status === 200 && count === 1, 'only initial request sends')
})

Deno.test(
  'SMS hook rejects provider failures, suppresses diagnostics and never retries',
  async () => {
    for (const outcome of ['rejected', 'unknown', 'throw'] as const) {
      const ledger = ledgerFixture()
      let calls = 0
      const f = fixture({
        store: ledger.store,
        send: async () => {
          calls++
          if (outcome === 'throw')
            throw new Error(
              `private ${event.user.phone} ${event.sms.otp} ${config.accessKeySecret}`
            )
          return outcome
        }
      })
      const response = await f.handler(signed())
      const text = await response.text()
      check(
        response.status === 500 && !response.headers.has('retry-after'),
        'not automatically retryable'
      )
      check(
        !text.includes(event.user.phone) &&
          !text.includes(event.sms.otp) &&
          !text.includes('private'),
        'safe error only'
      )
      check(
        ledger.completions[0].outcome === (outcome === 'rejected' ? 'failed' : 'unknown'),
        'terminal ledger state'
      )
      check((await f.handler(signed())).status === 500 && calls === 1, 'replay never sends again')
    }
  }
)

Deno.test(
  'SMS hook fails closed if claim or completion fails; ambiguous success stays pending',
  async () => {
    const broken = ledgerFixture()
    broken.store.claim = () => Promise.reject(new Error('database unavailable'))
    const claimFailure = fixture({ store: broken.store })
    check(
      (await claimFailure.handler(signed())).status === 500 && claimFailure.sends.length === 0,
      'claim must commit first'
    )
    const ledger = ledgerFixture()
    ledger.store.complete = () => Promise.reject(new Error('database unavailable'))
    const f = fixture({ store: ledger.store })
    check(
      (await f.handler(signed())).status === 500 && f.sends.length === 1,
      'successful SMS is not reported until receipt persisted'
    )
    check(
      (await f.handler(signed())).status === 500 && f.sends.length === 1,
      'pending survives completion failure and prevents duplicate billing'
    )
  }
)

Deno.test(
  'SMS hook total budget stays below 5s and aborts stuck dependencies without later sending',
  async () => {
    const ledger = ledgerFixture()
    let aborted = false
    ledger.store.claim = (_input, signal) =>
      new Promise<ClaimResult>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            aborted = true
            reject(new Error('stopped'))
          },
          { once: true }
        )
      })
    const f = fixture({ store: ledger.store })
    const started = performance.now()
    check((await f.handler(signed())).status === 500, 'time budget is enforced')
    check(
      performance.now() - started < 5000 && aborted && f.sends.length === 0,
      'no post-timeout delivery'
    )
  }
)

Deno.test(
  'Aliyun ACS3 signature matches official known-answer vector without networking',
  async () => {
    const result = await signAcs3({
      host: 'ecs.cn-shanghai.aliyuncs.com',
      action: 'RunInstances',
      version: '2014-05-26',
      query: {
        ImageId: 'win2019_1809_x64_dtc_zh-cn_40G_alibase_20230811.vhd',
        RegionId: 'cn-shanghai'
      },
      accessKeyId: 'YourAccessKeyId',
      accessKeySecret: 'YourAccessKeySecret',
      date: '2023-10-26T10:22:32Z',
      nonce: '3156853299f313e23d1673dc12e1703d'
    })
    check(
      result.headers.Authorization.endsWith(
        'Signature=06563a9e1b43f5dfe96b81484da74bceab24a1d853912eee15083a6f0f3283c0'
      ),
      'matches official V3 example'
    )
  }
)

Deno.test(
  'PNVS adapter sends only fixed RPC parameters with retries and returned OTP disabled',
  async () => {
    let calls = 0
    let captured: RequestInit | undefined
    const transport = ((input: string | URL | Request, init?: RequestInit) => {
      calls++
      captured = init
      const url = new URL(String(input))
      check(
        url.origin === 'https://dypnsapi.aliyuncs.com' && url.pathname === '/',
        'fixed HTTPS endpoint'
      )
      check(
        url.searchParams.get('PhoneNumber') === '13800000000' &&
          url.searchParams.get('CountryCode') === '86',
        'provider phone format'
      )
      check(
        url.searchParams.get('ReturnVerifyCode') === 'false' &&
          url.searchParams.get('AutoRetry') === '0',
        'no returned OTP and no auto retry'
      )
      check(
        url.searchParams.get('ValidTime') === '300' && url.searchParams.get('CodeLength') === '6',
        'expiry and length match configuration'
      )
      check(
        url.searchParams.get('TemplateParam') === JSON.stringify({ code: '012345', min: '5' }),
        'Supabase code supplied in template params'
      )
      check(
        !url.searchParams.has('Code') && !url.searchParams.has('AccessKeyId'),
        'no invented code field or credentials in URL'
      )
      return Promise.resolve(
        Response.json({ Code: 'OK', Success: true, Model: { VerifyCode: 'never-return-me' } })
      )
    }) as typeof fetch
    const result = await sendPnvsSms(
      config,
      { phone: event.user.phone, otp: event.sms.otp },
      new AbortController().signal,
      transport
    )
    check(result === 'accepted' && calls === 1, 'exactly one request with opaque result')
    check(
      captured?.method === 'POST' &&
        captured.redirect === 'error' &&
        captured.signal instanceof AbortSignal,
      'bounded request, no redirect credentials leak'
    )
    const headers = new Headers(captured.headers)
    check(
      headers.get('authorization')?.startsWith('ACS3-HMAC-SHA256 Credential='),
      'V3 signing enabled'
    )
    check(
      headers.get('x-acs-action') === 'SendSmsVerifyCode' &&
        headers.get('x-acs-version') === '2017-05-25',
      'fixed operation'
    )
  }
)

Deno.test(
  'PNVS adapter classifies malformed/negative HTTP outcomes without retrying or leaking response',
  async () => {
    for (const response of [
      Response.json({ Code: 'FREQUENCY_FAIL', Success: false, Message: 'private' }),
      Response.json({ Code: 'OK', Success: false }),
      Response.json({ Code: 'OK' }),
      new Response('not-json'),
      new Response('private', { status: 503 }),
      Response.json({ Code: 'OK', Success: true, padding: 'x'.repeat(17000) })
    ]) {
      let calls = 0
      const transport = (() => {
        calls++
        return Promise.resolve(response)
      }) as typeof fetch
      const result = await sendPnvsSms(
        config,
        { phone: event.user.phone, otp: event.sms.otp },
        new AbortController().signal,
        transport
      )
      check(
        (result === 'rejected' || result === 'unknown') && calls === 1,
        'no retry and no unverified success'
      )
    }
  }
)

Deno.test('PNVS adapter stops immediately on invalid config or a pre-aborted signal', async () => {
  let calls = 0
  const transport = (() => {
    calls++
    throw new Error('must not call')
  }) as typeof fetch
  const controller = new AbortController()
  controller.abort()
  check(
    (await sendPnvsSms(
      config,
      { phone: event.user.phone, otp: event.sms.otp },
      controller.signal,
      transport
    )) === 'rejected',
    'aborted input rejected'
  )
  check(
    (await sendPnvsSms(
      { ...config, accessKeyId: '' },
      { phone: event.user.phone, otp: event.sms.otp },
      new AbortController().signal,
      transport
    )) === 'rejected',
    'invalid config rejected'
  )
  check(calls === 0, 'no networking before validation')
})

Deno.test(
  'PNVS adapter aborts its single timed-out request, reports unknown, and never retries',
  async () => {
    let calls = 0
    let aborted = false
    const transport = ((_input: unknown, init?: RequestInit) => {
      calls++
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            aborted = true
            reject(new Error('private transport error'))
          },
          { once: true }
        )
      })
    }) as typeof fetch
    const started = performance.now()
    const result = await sendPnvsSms(
      config as PnvsConfig,
      { phone: event.user.phone, otp: event.sms.otp },
      new AbortController().signal,
      transport
    )
    check(
      result === 'unknown' && calls === 1 && aborted,
      'timeout has ambiguous delivery and is never retried'
    )
    check(performance.now() - started < 4000, 'provider timeout leaves room for durable completion')
  }
)
