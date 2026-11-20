export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  })
}
export async function limitedFormData(request: Request, limit: number) {
  if (Number(request.headers.get('content-length') || 0) > limit) throw new Error('TOO_LARGE')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('INVALID_FILE')
  const chunks: ArrayBuffer[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new Error('TOO_LARGE')
      }
      chunks.push(Uint8Array.from(value).buffer)
    }
  } finally {
    reader.releaseLock()
  }
  return new Response(new Blob(chunks), {
    headers: { 'Content-Type': request.headers.get('content-type') || '' }
  }).formData()
}
export function settings() {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !serviceKey || !anonKey) throw new Error('SERVER_NOT_CONFIGURED')
  return { url, serviceKey, anonKey }
}
export async function authenticate(request: Request) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { url, anonKey } = settings()
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000)
  })
  if (!response.ok) return null
  const user = (await response.json()) as { id?: string }
  if (!user.id || !/^[0-9a-f-]{36}$/i.test(user.id)) return null
  return { id: user.id, token }
}
export async function service(path: string, options: RequestInit = {}) {
  const { url, serviceKey } = settings()
  return fetch(`${url}${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  })
}
