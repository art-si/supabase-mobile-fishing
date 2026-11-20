type Service = (path: string, options?: RequestInit) => Promise<Response>
interface Job {
  job_id: string
  owner_id: string
  path: string
  lease_token: string
  attempt: number
}
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
function validJob(value: unknown): value is Job {
  if (!value || typeof value !== 'object') return false
  const job = value as Job
  return (
    [job.job_id, job.owner_id, job.lease_token].every(
      (id) => typeof id === 'string' && uuid.test(id)
    ) &&
    [`${job.owner_id}/${job.job_id}.jpg`, `${job.owner_id}/${job.job_id}.mp4`].includes(job.path) &&
    Number.isInteger(job.attempt) &&
    job.attempt >= 1 &&
    job.attempt <= 12
  )
}
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  })

export function createMediaCleanupHandler(deps: {
  service: Service
  secret: () => string
  now?: () => number
}) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return response({ error: 'METHOD_NOT_ALLOWED' }, 405)
    let secret: string
    try {
      secret = deps.secret()
    } catch {
      return response({ error: 'CLEANUP_NOT_CONFIGURED' }, 503)
    }
    if (!/^[a-f0-9]{64}$/.test(secret)) return response({ error: 'CLEANUP_NOT_CONFIGURED' }, 503)
    const timestamp = request.headers.get('x-cleanup-time') || ''
    const signature = request.headers.get('x-cleanup-signature') || ''
    const age = Math.floor((deps.now?.() ?? Date.now()) / 1000) - Number(timestamp)
    if (
      !/^\d{10}$/.test(timestamp) ||
      !/^[a-f0-9]{64}$/.test(signature) ||
      !Number.isFinite(age) ||
      age < -5 ||
      age > 90
    )
      return response({ error: 'UNAUTHORIZED' }, 401)
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )
    const signed = Uint8Array.from(signature.match(/../g)!, (hex) => parseInt(hex, 16))
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signed,
      encoder.encode(`fishing-media-cleanup.v1.${timestamp}`)
    )
    if (!valid) return response({ error: 'UNAUTHORIZED' }, 401)
    // The request body cannot supply paths or bucket names. Only the private deletion queue can.
    try {
      const claimed = await deps.service('/rest/v1/rpc/fishing_media_cleanup_claim', {
        method: 'POST',
        body: JSON.stringify({ batch_limit: 8 }),
        signal: AbortSignal.timeout(5000)
      })
      if (!claimed.ok) return response({ error: 'CLEANUP_UNAVAILABLE' }, 502)
      const jobs: unknown = await claimed.json()
      if (
        !Array.isArray(jobs) ||
        jobs.length > 8 ||
        !jobs.every(validJob) ||
        new Set(jobs.map((j) => j.job_id)).size !== jobs.length
      )
        return response({ error: 'INVALID_QUEUE_RESPONSE' }, 502)
      const counts = {
        claimed: jobs.length,
        completed: 0,
        retrying: 0,
        failed: 0,
        unacknowledged: 0
      }
      let next = 0
      const run = async () => {
        while (next < jobs.length) {
          const job = jobs[next++] as Job
          let succeeded = false,
            failure = 'STORAGE_DELETE_FAILED'
          try {
            const deleted = await deps.service('/storage/v1/object/fishing-media', {
              method: 'DELETE',
              body: JSON.stringify({ prefixes: [job.path] }),
              signal: AbortSignal.timeout(8000)
            })
            if (deleted.ok) {
              const result: unknown = await deleted.json()
              // An empty array means the object was already absent (idempotent retry).
              succeeded =
                Array.isArray(result) &&
                result.length <= 1 &&
                result.every(
                  (entry) => entry && typeof entry === 'object' && entry.name === job.path
                )
              if (!succeeded) failure = 'STORAGE_PROTOCOL_ERROR'
            }
          } catch {
            /* Keep the lease/job retryable; never log raw errors containing signed URLs. */
          }
          try {
            const finished = await deps.service('/rest/v1/rpc/fishing_media_cleanup_finish', {
              method: 'POST',
              body: JSON.stringify({
                job_id: job.job_id,
                lease: job.lease_token,
                succeeded,
                failure
              }),
              signal: AbortSignal.timeout(5000)
            })
            const state: unknown = finished.ok ? await finished.json() : null
            if (state === 'done') counts.completed++
            else if (state === 'pending') counts.retrying++
            else if (state === 'failed') counts.failed++
            else counts.unacknowledged++
          } catch {
            counts.unacknowledged++
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, run))
      return response(counts)
    } catch {
      return response({ error: 'CLEANUP_UNAVAILABLE' }, 502)
    }
  }
}
