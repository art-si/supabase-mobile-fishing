import type { ClaimResult, DurableDeliveryStore } from '../send-sms-hook/handler.ts'

type StoreOptions = {
  supabaseUrl: string
  serviceRoleKey: string
  fetch?: typeof fetch
  timeoutMs?: number
  now?: () => number
  randomUUID?: () => string
}

const DAY_MS = 24 * 60 * 60 * 1000
const DIGEST = /^[0-9a-f]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TERMINAL_STATES = new Set(['succeeded', 'failed', 'unknown'])

function failure(): Error {
  // Never expose the REST response, access key, event payload or URLs in errors.
  return new Error('SMS_DELIVERY_STORE_UNAVAILABLE')
}

function eventIsValid(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value)
}

/**
 * At-most-once dispatch ledger, not an exactly-once delivery guarantee.
 * A lost INSERT response, process crash or unknown provider result fails closed.
 * A reservation is never reacquired, even after retain_until has elapsed.
 */
export function createSupabaseDeliveryStore(options: StoreOptions): DurableDeliveryStore {
  let origin: URL
  try {
    origin = new URL(options.supabaseUrl)
  } catch {
    throw failure()
  }
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    !['', '/'].includes(origin.pathname) ||
    !options.serviceRoleKey ||
    options.serviceRoleKey.startsWith('sb_publishable_')
  )
    throw failure()

  const tableUrl = new URL('/rest/v1/sms_hook_deliveries', origin)
  const transport = options.fetch ?? fetch
  const now = options.now ?? Date.now
  const newReservation = options.randomUUID ?? (() => crypto.randomUUID())
  const timeoutMs = options.timeoutMs ?? 1000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw failure()

  async function request(
    method: 'GET' | 'POST' | 'PATCH',
    query: Record<string, string>,
    signal: AbortSignal,
    body?: unknown
  ): Promise<{ status: number; rows: unknown }> {
    if (signal.aborted) throw failure()
    const url = new URL(tableUrl)
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), timeoutMs)
    try {
      const response = await transport(url, {
        method,
        redirect: 'error',
        signal: AbortSignal.any([signal, timeout.signal]),
        headers: {
          apikey: options.serviceRoleKey,
          authorization: `Bearer ${options.serviceRoleKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Prefer: 'return=representation'
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
      // Only the unique-key collision is recoverable. Never retry a send claim.
      if (method === 'POST' && response.status === 409) {
        const error = await response.json().catch(() => null)
        if (error?.code !== '23505') throw failure()
        return { status: 409, rows: null }
      }
      if (!response.ok) throw failure()
      return { status: response.status, rows: await response.json() }
    } catch {
      throw failure()
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    persistence: 'durable',
    async claim(input, signal): Promise<ClaimResult> {
      const currentTime = now()
      if (
        !eventIsValid(input.eventId) ||
        !DIGEST.test(input.payloadDigest) ||
        !Number.isFinite(Date.parse(input.retainUntil)) ||
        Date.parse(input.retainUntil) <= currentTime
      )
        throw failure()
      const reservationId = newReservation()
      if (!UUID.test(reservationId)) throw failure()
      // One-hour safety margin avoids local/DB clock and network skew causing a
      // nominal 24h retention timestamp to violate the DB minimum at INSERT.
      const retainUntil = new Date(
        Math.max(Date.parse(input.retainUntil), currentTime + DAY_MS + 60 * 60 * 1000)
      ).toISOString()
      const inserted = await request('POST', {}, signal, {
        event_id: input.eventId,
        payload_digest: input.payloadDigest,
        reservation_id: reservationId,
        state: 'pending',
        retain_until: retainUntil
      })
      if (inserted.status !== 409) {
        const rows = inserted.rows
        if (
          inserted.status !== 201 ||
          !Array.isArray(rows) ||
          rows.length !== 1 ||
          rows[0]?.event_id !== input.eventId ||
          rows[0]?.payload_digest !== input.payloadDigest ||
          rows[0]?.reservation_id !== reservationId ||
          rows[0]?.state !== 'pending'
        )
          throw failure()
        return { state: 'claimed', reservationId }
      }
      const existing = await request(
        'GET',
        {
          event_id: `eq.${input.eventId}`,
          select: 'payload_digest,state',
          limit: '1'
        },
        signal
      )
      if (!Array.isArray(existing.rows) || existing.rows.length !== 1) throw failure()
      const row = existing.rows[0]
      if (!DIGEST.test(row?.payload_digest)) throw failure()
      if (row.payload_digest !== input.payloadDigest) return { state: 'conflict' }
      if (row.state === 'pending' || TERMINAL_STATES.has(row.state)) return { state: row.state }
      throw failure()
    },
    async complete(input, signal): Promise<void> {
      if (
        !eventIsValid(input.eventId) ||
        !UUID.test(input.reservationId) ||
        !TERMINAL_STATES.has(input.outcome)
      ) {
        throw failure()
      }
      const result = await request(
        'PATCH',
        {
          event_id: `eq.${input.eventId}`,
          reservation_id: `eq.${input.reservationId}`,
          state: 'eq.pending',
          select: 'event_id,state,reservation_id'
        },
        signal,
        { state: input.outcome, updated_at: new Date(now()).toISOString() }
      )
      if (
        !Array.isArray(result.rows) ||
        result.rows.length !== 1 ||
        result.rows[0]?.event_id !== input.eventId ||
        result.rows[0]?.state !== input.outcome ||
        result.rows[0]?.reservation_id !== input.reservationId
      )
        throw failure()
    }
  }
}
