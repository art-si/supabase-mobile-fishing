import { Webhook } from 'npm:standardwebhooks@1.0.0'
import {
  hmacSha256,
  validPnvsConfig,
  type PnvsConfig,
  type SendOutcome,
  type SmsMessage
} from './pnvs.ts'

export type DeliveryOutcome = 'succeeded' | 'failed' | 'unknown'
export type ClaimResult =
  | { state: 'claimed'; reservationId: string }
  | { state: 'succeeded' | 'pending' | 'unknown' | 'failed' | 'conflict' }

/**
 * A real cross-instance, durable, atomic ledger is required. No in-memory fallback.
 * claim must persist pending before returning claimed, bind eventId to payloadDigest,
 * and never reclaim pending/unknown/failed. complete must compare reservationId.
 * A crash or failed completion leaves pending, which must block further delivery.
 * Retain records for at least retainUntil (24h), beyond all valid signature windows.
 * Never persist raw payload, phone, OTP, credentials, or vendor response bodies.
 */
export interface DurableDeliveryStore {
  readonly persistence: 'durable'
  claim(
    input: { eventId: string; payloadDigest: string; retainUntil: string },
    signal: AbortSignal
  ): Promise<ClaimResult>
  complete(
    input: { eventId: string; reservationId: string; outcome: DeliveryOutcome },
    signal: AbortSignal
  ): Promise<void>
}

export interface SmsHookConfig extends PnvsConfig {
  deliveryEnabled: boolean
  hookSecret: string
  // Independent 32-byte base64 HMAC key; never use a bare hash of low-entropy OTP data.
  idempotencySecret: string
}

export interface SmsHookDependencies {
  config: () => SmsHookConfig
  store?: DurableDeliveryStore
  send: (config: PnvsConfig, message: SmsMessage, signal: AbortSignal) => Promise<SendOutcome>
}

const MAX_BODY_BYTES = 20 * 1024
const MAX_EXECUTION_MS = 4500 // Supabase HTTP hooks have a 5s total budget.
const COMPLETION_RESERVE_MS = 1100 // Durable REST completion has a 1s timeout.
const MAX_SEND_MS = 2000
const SAFE_MESSAGE = '短信暂时未能发送，请稍后重试'

function reply(status = 200) {
  // Never opt into automatic hook retries for an ambiguous provider outcome.
  return new Response(
    JSON.stringify(
      status === 200
        ? {}
        : {
            error: { http_code: status, message: SAFE_MESSAGE }
          }
    ),
    { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
  )
}

function base64Key(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return null
  try {
    const binary = atob(value)
    return binary.length === 32 && btoa(binary) === value
      ? Uint8Array.from(binary, (char) => char.charCodeAt(0))
      : null
  } catch {
    return null
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseMessage(value: unknown): SmsMessage | null {
  const event = record(value)
  const sms = record(event?.sms)
  const user = record(event?.user)
  // New hook contracts can carry the destination (e.g. a phone change) in sms.phone.
  // If present but invalid, reject; never silently send to the old user.phone.
  const phone = sms && Object.hasOwn(sms, 'phone') ? sms.phone : user?.phone
  const otp = sms?.otp
  // Supabase also emits E.164 digits without '+'. Only that exact wire variant
  // is accepted; bare domestic numbers, spacing and other countries are rejected.
  if (
    typeof phone !== 'string' ||
    !/^\+?861[3-9]\d{9}$/.test(phone) ||
    typeof otp !== 'string' ||
    !/^\d{6}$/.test(otp)
  )
    return null
  return { phone: phone.startsWith('+') ? phone : `+${phone}`, otp }
}

async function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // Work may have rejected during the deadline race. Always observe it.
    void work.catch(() => undefined)
    throw new Error('SMS_DEADLINE')
  }
  let abort!: () => void
  const deadline = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error('SMS_DEADLINE'))
    signal.addEventListener('abort', abort, { once: true })
  })
  try {
    return await Promise.race([work, deadline])
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

async function rawBody(request: Request, signal: AbortSignal) {
  const length = request.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES))
    throw new Error('SMS_BODY_TOO_LARGE')
  if (!request.body) throw new Error('SMS_BODY_INVALID')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  const cancel = () => {
    void reader.cancel().catch(() => undefined)
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      const { done, value } = await bounded(reader.read(), signal)
      if (done) break
      size += value.length
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        throw new Error('SMS_BODY_TOO_LARGE')
      }
      chunks.push(value)
    }
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export function createSmsHookHandler(deps: SmsHookDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return reply(405)
    const started = performance.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), MAX_EXECUTION_MS)
    const signal = controller.signal
    let claim: { eventId: string; reservationId: string } | undefined
    try {
      const config = deps.config()
      if (
        !config.hookSecret.startsWith('v1,whsec_') ||
        !base64Key(config.hookSecret.slice('v1,whsec_'.length))
      )
        return reply(500)
      const eventId = request.headers.get('webhook-id') || ''
      if (
        !/^[A-Za-z0-9_-]{1,128}$/.test(eventId) ||
        !request.headers.get('webhook-timestamp') ||
        !request.headers.get('webhook-signature')
      )
        return reply(401)
      const body = await bounded(rawBody(request, signal), signal)
      let verified: unknown
      try {
        verified = new Webhook(config.hookSecret.slice('v1,whsec_'.length)).verify(
          body,
          Object.fromEntries(request.headers)
        )
      } catch {
        return reply(401)
      }
      const message = parseMessage(verified)
      if (!message) return reply(400)
      const fingerprintKey = base64Key(config.idempotencySecret)
      if (
        !config.deliveryEnabled ||
        !validPnvsConfig(config) ||
        !fingerprintKey ||
        !deps.store ||
        deps.store.persistence !== 'durable'
      )
        return reply(500)
      const payloadDigest = await bounded(hmacSha256(fingerprintKey, body), signal)
      const result = await bounded(
        deps.store.claim(
          {
            eventId,
            payloadDigest,
            retainUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          },
          signal
        ),
        signal
      )
      if (result?.state === 'succeeded') return reply()
      if (result?.state !== 'claimed' || !result.reservationId || signal.aborted) return reply(500)
      claim = { eventId, reservationId: result.reservationId }
      const sendBudget = Math.min(
        MAX_SEND_MS,
        Math.floor(MAX_EXECUTION_MS - (performance.now() - started) - COMPLETION_RESERVE_MS)
      )
      // Keep pending if the total budget was consumed before dispatch. Never start
      // a chargeable request when there is no time left to persist its result.
      if (sendBudget <= 0) return reply(500)
      const sendController = new AbortController()
      const abortSend = () => sendController.abort()
      signal.addEventListener('abort', abortSend, { once: true })
      const sendTimeout = setTimeout(abortSend, sendBudget)
      let outcome: SendOutcome
      try {
        outcome = await bounded(
          deps.send(config, message, sendController.signal),
          sendController.signal
        )
      } catch {
        outcome = 'unknown'
      } finally {
        clearTimeout(sendTimeout)
        signal.removeEventListener('abort', abortSend)
        sendController.abort()
      }
      // If the process dies here, durable pending still blocks re-delivery.
      const status: DeliveryOutcome =
        outcome === 'accepted' ? 'succeeded' : outcome === 'rejected' ? 'failed' : 'unknown'
      if (signal.aborted) return reply(500)
      await bounded(deps.store.complete({ ...claim, outcome: status }, signal), signal)
      return status === 'succeeded' ? reply() : reply(500)
    } catch {
      // No PII/OTP/raw exception logging; an unfinished claim remains pending.
      return reply(500)
    } finally {
      clearTimeout(timeout)
      controller.abort()
    }
  }
}
