export interface LoginConfig {
  url: string
  anonKey: string
  serviceKey: string
}
type Dependencies = { fetch: typeof fetch; now?: () => number; timeoutMs?: number }
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
  'Access-Control-Expose-Headers': 'Retry-After',
  'Cache-Control': 'no-store',
  Pragma: 'no-cache'
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const phoneOf = (phone: unknown) =>
  typeof phone === 'string' && /^\+?861\d{10}$/.test(phone) ? '+' + phone.replace(/^\+/, '') : ''
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const reply = (code: string, status: number, retry?: number) =>
  new Response(JSON.stringify({ code }), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      ...(retry ? { 'Retry-After': String(retry) } : {})
    }
  })
// Bound both streamed requests and upstream JSON. Abort also cancels a stalled body read.
async function jsonBody(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  signal: AbortSignal
) {
  if (!body || signal.aborted) throw new Error('invalid body')
  const reader = body.getReader()
  const cancel = () => {
    void reader.cancel().catch(() => undefined)
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (signal.aborted) throw new Error('timeout')
      if (done) break
      size += value.length
      if (size > limit) {
        cancel()
        throw new Error('body too large')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    return object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}

/** Resolves the public fishing handle server-side; Auth alone verifies the password and issues tokens. */
export function createAccountLoginHandler(config: LoginConfig, deps: Dependencies) {
  const now = deps.now ?? Date.now
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'POST') return reply('METHOD_NOT_ALLOWED', 405)
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
      return reply('INVALID_REQUEST', 400)
    if (!config.url || !config.anonKey || !config.serviceKey)
      return reply('SERVICE_UNAVAILABLE', 503)
    const controller = new AbortController(),
      signal = controller.signal
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 8000)
    const send = (path: string, admin: boolean, init: RequestInit = {}) =>
      deps.fetch(config.url + path, {
        ...init,
        signal,
        redirect: 'error',
        headers: {
          apikey: admin ? config.serviceKey : config.anonKey,
          ...(admin ? { Authorization: `Bearer ${config.serviceKey}` } : {}),
          'Content-Type': 'application/json',
          ...init.headers
        }
      })
    const invalid = () => reply('PASSWORD_INCORRECT', 400)
    try {
      let body: Record<string, unknown>
      try {
        body = await jsonBody(request.body, 4096, signal)
      } catch {
        return reply('INVALID_REQUEST', 400)
      }
      if (
        typeof body.identifier !== 'string' ||
        typeof body.password !== 'string' ||
        body.identifier.length > 32 ||
        !body.password ||
        body.password.length > 128 ||
        !/^DY[0-9A-F]{12}$/.test(body.identifier.trim().toUpperCase())
      )
        return reply('INVALID_REQUEST', 400)
      const identifier = body.identifier.trim().toUpperCase()
      const ticketResponse = await send('/rest/v1/rpc/fishing_account_login_ticket', true, {
        method: 'POST',
        body: JSON.stringify({ login_handle: identifier })
      })
      if (!ticketResponse.ok) return reply('SERVICE_UNAVAILABLE', 503)
      const ticket = await jsonBody(ticketResponse.body, 4096, signal)
      if (ticket.allowed === false) {
        const retry =
          typeof ticket.retry_after === 'number' && Number.isFinite(ticket.retry_after)
            ? Math.max(1, Math.min(3600, Math.ceil(ticket.retry_after)))
            : 60
        return reply('RATE_LIMIT', 429, retry)
      }
      if (ticket.allowed !== true) return reply('SERVICE_UNAVAILABLE', 503)
      if (ticket.user_id === null) return invalid()
      if (typeof ticket.user_id !== 'string' || !uuid.test(ticket.user_id))
        return reply('SERVICE_UNAVAILABLE', 503)
      const owner = ticket.user_id
      const userResponse = await send('/auth/v1/admin/users/' + owner, true)
      if (userResponse.status === 404) return invalid()
      if (!userResponse.ok) return reply('SERVICE_UNAVAILABLE', 503)
      const userBody = await jsonBody(userResponse.body, 65536, signal)
      const user = userBody.user ? object(userBody.user) : userBody
      const phone = phoneOf(user.phone)
      if (
        user.id !== owner ||
        !phone ||
        typeof user.phone_confirmed_at !== 'string' ||
        !user.phone_confirmed_at
      )
        return invalid()
      const response = await send('/auth/v1/token?grant_type=password', false, {
        method: 'POST',
        body: JSON.stringify({ phone, password: body.password })
      })
      if (response.status === 429) {
        const value = Number(response.headers.get('Retry-After'))
        return reply(
          'RATE_LIMIT',
          429,
          Number.isFinite(value) && value > 0 ? Math.min(3600, Math.ceil(value)) : 60
        )
      }
      if ([400, 401, 403, 422].includes(response.status)) return invalid()
      if (!response.ok) return reply('SERVICE_UNAVAILABLE', 503)
      const session = await jsonBody(response.body, 65536, signal),
        identity = object(session.user)
      const token = (value: unknown): value is string =>
        typeof value === 'string' && value.length > 0 && value.length <= 16384 && !/\s/.test(value)
      const expires =
        typeof session.expires_at === 'number'
          ? session.expires_at
          : typeof session.expires_in === 'number'
            ? Math.floor(now() / 1000) + session.expires_in
            : 0
      if (identity.id !== owner || phoneOf(identity.phone) !== phone) {
        // A phone changed owners during login. Never return a different person's session.
        if (token(session.access_token))
          await send('/auth/v1/logout?scope=local', false, {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}` }
          }).catch(() => undefined)
        return invalid()
      }
      if (
        !token(session.access_token) ||
        !token(session.refresh_token) ||
        !Number.isFinite(expires) ||
        expires <= now() / 1000
      )
        return reply('SERVICE_UNAVAILABLE', 503)
      return new Response(
        JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_at: expires,
          user: { id: owner, phone }
        }),
        {
          status: 200,
          headers: { ...cors, 'Content-Type': 'application/json' }
        }
      )
    } catch {
      return reply('SERVICE_UNAVAILABLE', 503)
    } finally {
      clearTimeout(timer)
    }
  }
}
