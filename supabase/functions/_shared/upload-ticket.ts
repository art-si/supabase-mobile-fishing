import { json } from './http.ts'

// Reserve as the verified user, never as service_role. A database/network failure
// must not be mislabeled as a personal rate limit or allow an unmetered upload.
export async function reserveUploadTicket(
  url: string, anonKey: string, token: string, fetcher: typeof fetch = fetch
): Promise<Response | null> {
  try {
    const reply = await fetcher(`${url}/rest/v1/rpc/fishing_write`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'upload_ticket', payload: {} }),
      signal: AbortSignal.timeout(5000)
    })
    if (reply.ok) { await reply.body?.cancel(); return null }
    if (reply.status === 401 || reply.status === 403) return json({ error: 'AUTH_REQUIRED' }, 401)
    const problem = await reply.json().catch(() => null)
    if ((reply.status === 400 || reply.status === 429) && problem?.message === 'RATE_LIMIT') {
      return json({ error: 'UPLOAD_RATE_LIMIT' }, 429)
    }
  } catch { /* No upstream bodies, tokens or SQL details reach clients/logs. */ }
  return json({ error: 'UPLOAD_UNAVAILABLE' }, 503)
}
