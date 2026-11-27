import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { ref, watch } from 'vue'
import { serviceErrorMessage, userErrorText } from '../src/domain/user-errors'
import { createUploadCancellation, trackUpload, type UploadOptions } from '../src/_mobile-core/upload-progress'
import { VideoPreparationError } from '../src/_mobile-core/video-prepare'

function harness(
  options: {
    status?: number
    body?: string
    fail?: boolean
    changed?: boolean
    prepFailure?: boolean
    videoPrepare?: (options: UploadOptions) => Promise<void>
  } = {}
) {
  let uploads = 0,
    disposed = 0
  const scope = ref(1),
    requests: any[] = []
  class ApiError extends Error {
    constructor(
      message: string,
      public status = 0,
      public code = ''
    ) {
      super(message)
    }
  }
  const dependencies: Record<string, unknown> = {
    vue: { watch },
    '@/config': {

      config: { supabaseUrl: 'https://test.invalid', supabaseKey: 'public-fixture' }
    },
    './session': {
      sessionScope: scope,
      accessToken: async () => 'fixture-token',
      assertSession(snapshot: number) {
        if (scope.value !== snapshot)
          throw Object.assign(new Error('SESSION_CHANGED'), { code: 'SESSION_CHANGED' })
      }
    },
    './http': { ApiError },
    '@/domain/rules': {},
    '@/stores/auth': {},
    '@/domain/user-errors': { serviceErrorMessage },
    '@mobile-core/video-choose': { chooseVideoFile: async () => null },
    '@mobile-core/upload-progress': { trackUpload, createUploadCancellation },
    '@/platforms/video-conversion': { convertBrowserVideo: async () => new Blob() },
    '@/platforms/heif-image': { normalizeHeifImage: async () => new Blob() },
    '@mobile-core/video-prepare': {
      VideoPreparationError,
      prepareUploadVideo: async (path: string, maximum: number, prepareOptions: UploadOptions) => {
        requests.push({ path, maximum, options: prepareOptions })
        prepareOptions.onStage?.('preparing')
        await options.videoPrepare?.(prepareOptions)
        if (options.changed) scope.value++
        return { path: 'blob:prepared-video', size: 1000, dispose() { disposed++ } }
      }
    },
    '@mobile-core/image-prepare': {
      prepareUploadImage: async (path: string, limits: object, preparation: object) => {
        requests.push({ path, limits, preparation })
        if (options.prepFailure)
          throw Object.assign(new Error('IMAGE_UNSUPPORTED'), { code: 'IMAGE_UNSUPPORTED' })
        if (options.changed) scope.value++
        return {
          path: 'blob:prepared-copy',
          dispose() {
            disposed++
          }
        }
      }
    }
  }
  const exports: any = {}
  runInNewContext(
    ts.transpileModule(readFileSync(new URL('../src/services/media.ts', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    {
      exports,
      Error,
      require: (name: string) => {
        assert.ok(name in dependencies, name)
        return dependencies[name]
      },
      uni: {
        uploadFile(o: any) {
          uploads++
          requests.push(o)
          if (options.fail) o.fail({ errMsg: 'private diagnostic' })
          else
            o.success({
              statusCode: options.status ?? 200,
              data:
                options.body ??
                JSON.stringify(o.formData?.kind === 'video'
                  ? { id: '11111111-1111-4111-8111-111111111111', path: 'owner/11111111-1111-4111-8111-111111111111.mp4', kind: 'video', width: 320, height: 180, duration: 2, size: 1000 }
                  : { id: 'asset', path: 'owner/asset.jpg', width: 2048, height: 1536 })
            })
          return { abort() {}, onProgressUpdate() {}, offProgressUpdate() {} }
        }
      }
    }
  )
  return { api: exports, scope, requests, stats: () => ({ uploads, disposed }) }
}
test('upload uses the prepared copy and disposes it after success or service failure', async () => {
  for (const options of [{}, { status: 503 }, { fail: true }, { body: 'invalid' }]) {
    const m = harness(options)
    if (Object.keys(options).length) await assert.rejects(m.api.uploadPhoto('blob:original'))
    else assert.equal((await m.api.uploadPhoto('blob:original')).width, 2048)
    assert.equal(m.requests[1].filePath, 'blob:prepared-copy')
    assert.deepEqual(m.stats(), { uploads: 1, disposed: 1 })
  }
})

test('video upload sends the prepared MP4 and releases it on success, network or server failure', async () => {
  for (const options of [{}, { status: 415 }, { fail: true }]) {
    const m = harness(options), stages: string[] = []
    const result = m.api.uploadVideo('blob:selected-mov', { onStage: (stage: string) => stages.push(stage) })
    if (Object.keys(options).length) await assert.rejects(result)
    else assert.equal((await result).kind, 'video')
    assert.equal(m.requests[1].filePath, 'blob:prepared-video')
    assert.equal(m.requests[0].maximum, 20 * 1024 * 1024)
    assert.deepEqual(stages, ['preparing', 'uploading'])
    assert.deepEqual(m.stats(), { uploads: 1, disposed: 1 })
  }
})

test('prepared previews transfer explicit ownership and stay available on upload failure', async () => {
  for (const method of ['uploadPhoto','uploadVideo']) for (const accepts of [true,false]) for (const fail of [true,false]) {
    const m=harness({fail});let preview: {path:string;dispose():void}|undefined
    const result=m.api[method]('blob:original',{onPreparedMedia(value:{path:string;dispose():void}){preview=value;return accepts}})
    if(fail)await assert.rejects(result);else await result
    assert.equal(preview?.path,method==='uploadVideo'?'blob:prepared-video':'blob:prepared-copy')
    assert.equal(m.stats().disposed,accepts?0:1)
    if(accepts){preview!.dispose();assert.equal(m.stats().disposed,1)}
  }
})

test('a cancelled or stale preview callback cannot start uploading a released copy',async()=>{
  for(const method of ['uploadPhoto','uploadVideo']){
    const m=harness(),controller=new AbortController()
    await assert.rejects(m.api[method]('blob:original',{signal:controller.signal,onPreparedMedia(){controller.abort();return false}}),{code:'UPLOAD_CANCELLED'})
    assert.deepEqual(m.stats(),{uploads:0,disposed:1})
  }
})

test('account changes abort active conversion immediately and never begin an upload', async () => {
  let signal: UploadOptions['signal']
  const m = harness({ videoPrepare: options => new Promise((_, reject) => {
    signal = options.signal
    signal?.addEventListener('abort', () => reject(new VideoPreparationError('UPLOAD_CANCELLED')))
  }) })
  const result = m.api.uploadVideo('blob:selected-webm')
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(signal?.aborted, false)
  m.scope.value++
  assert.equal(signal?.aborted, true)
  await assert.rejects(result, { code: 'SESSION_CHANGED' })
  assert.deepEqual(m.stats(), { uploads: 0, disposed: 0 })
})

test('caller cancellation or a late session change disposes a returned video copy without uploading', async () => {
  for (const changed of [false, true]) {
    let finish!: () => void
    const controller = new AbortController()
    const m = harness({ videoPrepare: () => new Promise<void>(resolve => { finish = resolve }) })
    const result = m.api.uploadVideo('blob:selected-video', { signal: controller.signal })
    await new Promise<void>(resolve => setImmediate(resolve))
    if (changed) m.scope.value++
    else controller.abort()
    finish()
    await assert.rejects(result, { code: changed ? 'SESSION_CHANGED' : 'UPLOAD_CANCELLED' })
    assert.deepEqual(m.stats(), { uploads: 0, disposed: 1 })
  }
})
test('session change during preparation prevents upload and disposes the generated copy', async () => {
  const m = harness({ changed: true })
  await assert.rejects(m.api.uploadPhoto('blob:original'), { code: 'SESSION_CHANGED' })
  assert.deepEqual(m.stats(), { uploads: 0, disposed: 1 })
  const invalid = harness({ prepFailure: true })
  await assert.rejects(invalid.api.uploadPhoto('blob:original'), { code: 'IMAGE_UNSUPPORTED' })
  assert.deepEqual(invalid.stats(), { uploads: 0, disposed: 0 })
})
test('photo errors distinguish size, format, auth, quota and service failures without vendor text', () => {
  const m = harness()
  for (const [status, body, code] of [
    [413, { error: 'IMAGE_DIMENSIONS_TOO_LARGE' }, 'IMAGE_DIMENSIONS_TOO_LARGE'],
    [413, { error: 'INVALID_FILE' }, 'IMAGE_INPUT_TOO_LARGE'],
    [415, null, 'IMAGE_UNSUPPORTED'],
    [422, { error: 'private diagnostic' }, 'IMAGE_PREPARATION_FAILED'],
    [401, null, 'NOT_AUTHENTICATED'],
    [429, null, 'RATE_LIMIT'],
    [503, null, 'PHOTO_SERVICE_UNAVAILABLE'],
    [400, null, 'PHOTO_UPLOAD_FAILED']
  ] as const) {
    const error = m.api.photoUploadError(status, body)
    assert.equal(error.code, code)
    assert.equal(userErrorText(error), serviceErrorMessage(code))
    assert.doesNotMatch(userErrorText(error), /private|diagnostic|Supabase/)
    assert.equal(
      m.api.canRetryPhoto(error),
      !['IMAGE_INPUT_TOO_LARGE', 'IMAGE_DIMENSIONS_TOO_LARGE', 'IMAGE_UNSUPPORTED'].includes(code)
    )
  }
})
