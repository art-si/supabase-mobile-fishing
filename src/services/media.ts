import { config } from '@/config'
import { accessToken, assertSession, sessionScope, sessionRequest } from './session'
import type { Media } from '@/domain/models'
import { prepareUploadImage, type PreparedUploadImage } from '@mobile-core/image-prepare'
import { prepareUploadVideo, VideoPreparationError, type PreparedUploadVideo } from '@mobile-core/video-prepare'
import { convertBrowserVideo } from '@/platforms/video-conversion'
import { normalizeHeifImage } from '@/platforms/heif-image'
import { watch } from 'vue'
import { ApiError } from './http'
import { serviceErrorMessage } from '@/domain/user-errors'
import { chooseVideoFile } from '@mobile-core/video-choose'
import { createUploadCancellation, trackUpload, type UploadOptions } from '@mobile-core/upload-progress'
export const videoMaxBytes = 20 * 1024 * 1024
export async function chooseVideo() {
  try {
    return await chooseVideoFile(videoMaxBytes)
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : 'VIDEO_SELECTION_FAILED'
    throw new ApiError(serviceErrorMessage(code) || '暂时无法读取视频，请检查相册权限', 0, code)
  }
}
export async function uploadVideo(filePath: string, options: UploadOptions = {}): Promise<Media> {
  const scope = sessionScope.value
  const token = await accessToken()
  assertSession(scope)
  if (!token) throw new ApiError('请先登录，草稿会保留', 401, 'NOT_AUTHENTICATED')
  let clearTask = () => {}
  let prepared: PreparedUploadVideo | undefined
  let previewOwnsCopy = false
  const cancellation = createUploadCancellation(options.signal)
  const stopWatching = watch(sessionScope, () => cancellation.abort(), { flush: 'sync' })
  try {
    prepared = await prepareUploadVideo(filePath, videoMaxBytes, { ...options, signal: cancellation.signal, convertBrowserVideo })
    assertSession(scope)
    if (cancellation.signal.aborted) throw new ApiError('已取消上传', 0, 'UPLOAD_CANCELLED')
    if (prepared.path !== filePath) previewOwnsCopy = options.onPreparedMedia?.({path:prepared.path,dispose:prepared.dispose}) === true
    options.onStage?.('uploading')
    assertSession(scope)
    if (cancellation.signal.aborted) throw new ApiError('已取消上传', 0, 'UPLOAD_CANCELLED')
    return await new Promise<Media>((resolve, reject) => {
      const task = uni.uploadFile({
        url: `${config.supabaseUrl}/functions/v1/media-upload`,
        filePath: prepared!.path,
        name: 'file',
        formData: { kind: 'video' },
        timeout: 120000,
        header: { Authorization: `Bearer ${token}`, apikey: config.supabaseKey },
        success(response) {
          try {
            assertSession(scope)
            let body: any = {}
            try {
              body = JSON.parse(response.data)
            } catch {
              /* no diagnostics */
            }
            if (
              response.statusCode >= 200 &&
              response.statusCode < 300 &&
              body.kind === 'video' &&
              typeof body.id === 'string' &&
              /^[\da-f-]{36}$/i.test(body.id) &&
              typeof body.path === 'string' &&
              body.path.endsWith(`/${body.id}.mp4`) &&
              Number.isFinite(body.width) &&
              body.width > 0 &&
              Number.isFinite(body.height) &&
              body.height > 0 &&
              Number.isFinite(body.duration) &&
              body.duration >= 0 &&
              Number.isFinite(body.size) &&
              body.size > 0 &&
              body.size <= videoMaxBytes
            ) {
              resolve(body)
              return
            }
            const code =
              response.statusCode === 413
                ? 'VIDEO_TOO_LARGE'
                : response.statusCode === 415
                  ? 'VIDEO_UNSUPPORTED'
                  : response.statusCode === 401
                    ? 'NOT_AUTHENTICATED'
                    : response.statusCode === 429
                      ? 'RATE_LIMIT'
                      : 'VIDEO_UPLOAD_FAILED'
            reject(new ApiError(serviceErrorMessage(code)!, response.statusCode, code))
          } catch (error) {
            reject(error)
          }
        },
        fail() {
          reject(new ApiError(serviceErrorMessage('NETWORK_ERROR')!, 0, 'NETWORK_ERROR'))
        }
      })
      clearTask = trackUpload(task, { ...options, signal: cancellation.signal }, () =>
        reject(new ApiError('已取消上传', 0, 'UPLOAD_CANCELLED'))
      )
    })
  } catch (error) {
    assertSession(scope)
    if (error instanceof VideoPreparationError) throw new ApiError(serviceErrorMessage(error.code) || serviceErrorMessage('VIDEO_UPLOAD_FAILED')!, 0, error.code)
    throw error
  } finally {
    clearTask()
    if (!previewOwnsCopy) prepared?.dispose()
    stopWatching()
    cancellation.dispose()
  }
}

export function canRetryPhoto(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
  return ![
    'IMAGE_INPUT_TOO_LARGE',
    'IMAGE_DIMENSIONS_TOO_LARGE',
    'IMAGE_UNSUPPORTED',
    'VIDEO_TOO_LARGE',
    'VIDEO_UNSUPPORTED',
    'VIDEO_CONVERSION_UNAVAILABLE'
  ].includes(String(code))
}

export function photoUploadError(status: number, response: unknown): ApiError {
  const code = response && typeof response === 'object' && 'error' in response ? response.error : ''
  const publicCode =
    status === 401
      ? 'NOT_AUTHENTICATED'
      : status === 429
        ? 'RATE_LIMIT'
        : status === 413
          ? code === 'IMAGE_DIMENSIONS_TOO_LARGE'
            ? 'IMAGE_DIMENSIONS_TOO_LARGE'
            : 'IMAGE_INPUT_TOO_LARGE'
          : status === 415
            ? 'IMAGE_UNSUPPORTED'
            : status === 422
              ? 'IMAGE_PREPARATION_FAILED'
              : status >= 500
                ? 'PHOTO_SERVICE_UNAVAILABLE'
                : 'PHOTO_UPLOAD_FAILED'
  return new ApiError(serviceErrorMessage(publicCode)!, status, publicCode)
}
export async function choosePhotos(count: number, source?: 'camera' | 'album'): Promise<string[]> {
  return new Promise((resolve, reject) =>
    uni.chooseImage({
      count,
      sizeType: ['compressed'],
      sourceType: source ? [source] : ['album', 'camera'],
      success: (r) => resolve(r.tempFilePaths as string[]),
      fail: (e) =>
        String(e.errMsg).includes('cancel')
          ? resolve([])
          : reject(new Error('暂时无法读取照片，请检查相册权限'))
    })
  )
}
export async function uploadPhoto(filePath: string, options: UploadOptions = {}): Promise<Media> {
  const scope = sessionScope.value
  const token = await accessToken()
  assertSession(scope)
  if (!token) throw new ApiError('请先登录，草稿会保留', 401, 'NOT_AUTHENTICATED')
  let prepared: PreparedUploadImage | undefined
  let previewOwnsCopy = false
  let clearTask = () => {}
  const cancellation = createUploadCancellation(options.signal)
  const stopWatching = watch(sessionScope, () => cancellation.abort(), { flush: 'sync' })
  try {
    options.onStage?.('preparing')
    prepared = await prepareUploadImage(filePath, {
      maxBytes: 8 * 1024 * 1024,
      maxPixels: 24000000,
      maxEdge: 2048
    }, { normalizeUnsupportedImage: normalizeHeifImage, signal: cancellation.signal })
    assertSession(scope)
    if (cancellation.signal.aborted) throw new ApiError('已取消上传', 0, 'UPLOAD_CANCELLED')
    if (prepared.path !== filePath) previewOwnsCopy = options.onPreparedMedia?.({path:prepared.path,dispose:prepared.dispose}) === true
    options.onStage?.('uploading')
    assertSession(scope)
    if (cancellation.signal.aborted) throw new ApiError('已取消上传', 0, 'UPLOAD_CANCELLED')
    return await new Promise<Media>((resolve, reject) => {
      const task = uni.uploadFile({
        url: `${config.supabaseUrl}/functions/v1/media-upload`,
        filePath: prepared!.path,
        name: 'file',
        timeout: 45000,
        header: { Authorization: `Bearer ${token}`, apikey: config.supabaseKey },
        success: (r) => {
          try {
            assertSession(scope)
          } catch (error) {
            reject(error)
            return
          }
          if (r.statusCode >= 200 && r.statusCode < 300) {
            try {
              resolve(JSON.parse(r.data) as Media)
            } catch {
              reject(new Error('未能确认照片上传结果，请重试'))
            }
          } else {
            let body: unknown
            try {
              body = JSON.parse(r.data)
            } catch {
              /* Do not show proxy or provider diagnostics. */
            }
            reject(photoUploadError(r.statusCode, body))
          }
        },
        fail: () => reject(new ApiError(serviceErrorMessage('NETWORK_ERROR')!, 0, 'NETWORK_ERROR'))
      })
      clearTask = trackUpload(task, { ...options, signal: cancellation.signal }, () =>
        reject(new ApiError('已取消上传', 0, 'UPLOAD_CANCELLED'))
      )
    })
  } catch (error) {
    assertSession(scope)
    throw error
  } finally {
    clearTask()
    if (!previewOwnsCopy) prepared?.dispose()
    stopWatching()
    cancellation.dispose()
  }
}
export async function resolvePhotos(posts: { media: Media[] }[]) {
  const scope = sessionScope.value
  const signatures = new Map<string, Promise<string | undefined>>()
  await Promise.all(
    posts.flatMap((p) =>
      p.media.map(async (asset) => {
        try {
          let signature = signatures.get(asset.path)
          if (!signature) {
            signature = sessionRequest<{ signedURL: string }>(
              `/storage/v1/object/sign/fishing-media/${asset.path.split('/').map(encodeURIComponent).join('/')}`,
              { method: 'POST', data: { expiresIn: asset.kind === 'video' ? 300 : 60 } },
              false
            ).then(result => `${config.supabaseUrl}/storage/v1${result.signedURL}`).catch(() => undefined)
            signatures.set(asset.path, signature)
          }
          asset.url = await signature
        } catch {
          asset.url = undefined
        }
      })
    )
  )
  assertSession(scope)
  return posts
}

/** Sign avatars and attachments in the same batch, deduplicating shared paths. */
export async function resolveContentMedia<T>(result: T): Promise<T> {
  const groups: { media: Media[] }[] = []
  function collect(value: unknown) {
    if (Array.isArray(value)) { value.forEach(collect); return }
    if (!value || typeof value !== 'object') return
    if ('media' in value && Array.isArray(value.media)) groups.push(value as { media: Media[] })
    if ('avatar' in value && value.avatar && typeof value.avatar === 'object' && 'path' in value.avatar)
      groups.push({ media: [value.avatar as Media] })
    for (const [key, child] of Object.entries(value)) if (key !== 'media' && key !== 'avatar') collect(child)
  }
  collect(result)
  if (groups.length) await resolvePhotos(groups)
  return result
}
