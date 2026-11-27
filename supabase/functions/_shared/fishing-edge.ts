import { authenticate, json, service, settings } from './http.ts'

export class FishingError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

type Caller = NonNullable<Awaited<ReturnType<typeof authenticate>>>
export function fishingHandler(run: (caller: Caller, input: Record<string, unknown>) => Promise<unknown>) {
  return async (request: Request) => {
    if (request.method === 'OPTIONS') return json({})
    if (request.method !== 'POST') return json({ code: 'INVALID_INPUT' }, 405)
    try {
      const caller = await authenticate(request)
      if (!caller) throw new FishingError('NOT_AUTHENTICATED', 401)
      return json(await run(caller, await readFishingInput(request)))
    } catch (error) {
      return error instanceof FishingError
        ? json({ code: error.code }, error.status)
        : json({ code: 'SERVICE_UNAVAILABLE' }, 503)
    }
  }
}

export async function readFishingInput(request: Request, maxBytes = 8192) {
  const reader = request.body?.getReader()
  if (!reader) throw new FishingError('INVALID_INPUT', 400)
  const decoder = new TextDecoder()
  let input = ''
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxBytes) {
        await reader.cancel()
        throw new FishingError('INVALID_INPUT', 400)
      }
      input += decoder.decode(value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
  const body = parseRecord(input + decoder.decode())
  if (!body) throw new FishingError('INVALID_INPUT', 400)
  return body
}

export function parseRecord(value: string): Record<string, unknown> | null {
  try {
    const data = JSON.parse(value)
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null
  } catch { return null }
}

export async function fishingRpc<T>(name: string, body: unknown, userToken?: string): Promise<T> {
  const path = '/rest/v1/rpc/' + name
  const options = {
    method: 'POST',
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(3500)
  }
  const { url, anonKey } = settings()
  const response = userToken
    ? await fetch(url + path, {
        ...options,
        headers: { apikey: anonKey, Authorization: 'Bearer ' + userToken, 'Content-Type': 'application/json' }
      })
    : await service(path, options)
  if (!response.ok) throw new FishingError('SERVICE_UNAVAILABLE', 503)
  if (response.status === 204) return undefined as T
  return response.json()
}
