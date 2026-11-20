import { createMediaUploadHandler } from '../supabase/functions/media-upload/handler.ts'
const clip = await Deno.readFile(new URL('./fixtures/flower-cc0.mp4', import.meta.url))
function ok(value: unknown, message: string) {
  if (!value) throw new Error(message)
}
function harness(options: { signedIn?: boolean; ticket?: boolean; metadata?: boolean } = {}) {
  const calls: { path: string; options: RequestInit }[] = []
  const handler = createMediaUploadHandler({
    authenticate: async () =>
      options.signedIn === false
        ? null
        : { id: '11111111-1111-4111-8111-111111111111', token: 'fixture' },
    settings: () => ({ url: 'https://fixture.invalid', anonKey: 'fixture', serviceKey: 'fixture' }),
    reserveUploadTicket: async () =>
      options.ticket === false ? new Response('{}', { status: 429 }) : null,
    service: async (path, init = {}) => {
      calls.push({ path, options: init })
      return new Response('{}', {
        status: path === '/rest/v1/media_assets' && options.metadata === false ? 503 : 200
      })
    }
  })
  return { handler, calls }
}
function upload(bytes: Uint8Array = clip, kind = 'video') {
  const data = new FormData()
  data.set(
    'file',
    new File([new Uint8Array(bytes)], 'untrusted-name.mov', { type: 'application/octet-stream' })
  )
  data.set('kind', kind)
  return new Request('https://fixture.invalid', { method: 'POST', body: data })
}
Deno.test('media handler authenticates and enforces quota before accepting an upload', async () => {
  for (const [options, status] of [
    [{ signedIn: false }, 401],
    [{ ticket: false }, 429]
  ] as const) {
    const h = harness(options)
    ok((await h.handler(upload())).status === status, 'must reject denied request')
    ok(!h.calls.length, 'no storage write on rejected request')
  }
})
Deno.test(
  'video upload validates actual MP4 bytes and persists owner-bound sanitized metadata',
  async () => {
    const h = harness(),
      response = await h.handler(upload())
    const value = await response.json()
    ok(
      response.status === 200 &&
        value.kind === 'video' &&
        value.width === 960 &&
        value.duration === 5.005,
      'actual MP4 metadata'
    )
    ok(
      /^11111111-1111-4111-8111-111111111111\/[\da-f-]{36}\.mp4$/.test(value.path),
      'server assigns owner path and MP4 suffix'
    )
    ok(
      h.calls[0].options.headers &&
        (h.calls[0].options.headers as Record<string, string>)['Content-Type'] === 'video/mp4',
      'server sets real MIME'
    )
    const stored = JSON.parse(String(h.calls[1].options.body))
    ok(
      stored.path === value.path && stored.size === clip.length && stored.kind === 'video',
      'stored metadata matches sanitized file'
    )
    const invalid = harness()
    ok(
      (await invalid.handler(upload(new Uint8Array(100)))).status === 415 && !invalid.calls.length,
      'disguised video never reaches storage'
    )
    const oversized = harness()
    ok(
      (await oversized.handler(upload(new Uint8Array(20 * 1024 * 1024 + 1)))).status === 413 &&
        !oversized.calls.length,
      'oversize never reaches storage'
    )
  }
)
Deno.test('metadata failure compensates only the object created by the failed upload', async () => {
  const h = harness({ metadata: false })
  ok((await h.handler(upload())).status === 502, 'save failure stays a failure')
  const deletion = h.calls.at(-1)!
  const created = JSON.parse(String(h.calls[1].options.body))
  ok(
    deletion.options.method === 'DELETE' &&
      JSON.parse(String(deletion.options.body)).prefixes[0] === created.path,
    'compensate exact owned object'
  )
})
