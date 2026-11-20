import { authenticate, json, limitedFormData } from '../supabase/functions/_shared/http.ts'
function check(value: unknown, message: string) {
  if (!value) throw new Error(message)
}
Deno.test('multipart limit accepts a small file without requiring Content-Length', async () => {
  const form = new FormData()
  form.append('file', new File(['abc'], 'test.jpg', { type: 'image/jpeg' }))
  const request = new Request('https://test.invalid', { method: 'POST', body: form })
  const parsed = await limitedFormData(request, 4096)
  const file = parsed.get('file')
  check(file instanceof File && (await file.text()) === 'abc', 'multipart content is preserved')
})
Deno.test('chunked uploads cannot bypass the total request limit', async () => {
  let cancelled = false
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024))
    },
    cancel() {
      cancelled = true
    }
  })
  const request = new Request('https://test.invalid', { method: 'POST', body })
  let rejected = false
  try {
    await limitedFormData(request, 512)
  } catch (error) {
    rejected = error instanceof Error && error.message === 'TOO_LARGE'
  }
  check(rejected && cancelled, 'oversized stream is rejected and cancelled')
})
Deno.test(
  'unauthenticated request is rejected before reading server secrets or networking',
  async () => {
    check(
      (await authenticate(new Request('https://test.invalid'))) === null,
      'caller must supply a valid token'
    )
  }
)
Deno.test('private function responses must not be cached', () => {
  check(json({ ok: true }).headers.get('cache-control') === 'no-store', 'response is private')
})
