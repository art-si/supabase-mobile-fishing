import { config } from '@/config'
import { authErrorMessage, retryAfterFromHeaders } from '@/domain/auth-errors'
import { serviceErrorMessage } from '@/domain/user-errors'
import type { UploadSignal } from '@mobile-core/upload-progress'
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code = '',
    public retryAfter?: number
  ) {
    super(message)
  }
}
export function isTransientRequestError(error: unknown) {
  return error instanceof ApiError &&
    error.code !== 'REQUEST_CANCELLED' &&
    (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500)
}
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  data?: unknown
  token?: string
  headers?: Record<string, string>
  timeout?: number
  signal?: UploadSignal
}
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const cancelled = () => new ApiError('请求已取消', 0, 'REQUEST_CANCELLED')
  if (options.signal?.aborted) throw cancelled()
  if (!config.supabaseKey)
    throw new ApiError('服务暂时不可用，请稍后重试', 0, 'SERVICE_UNAVAILABLE')
  return new Promise((resolve, reject) => {
    let settled = false, wasCancelled = false, abortCalled = false
    let task: UniApp.RequestTask | undefined
    const cleanup = () => options.signal?.removeEventListener('abort', onAbort)
    const succeed = (value: T) => { if (!settled) { settled = true; cleanup(); resolve(value) } }
    const fail = (error: unknown) => { if (!settled) { settled = true; cleanup(); reject(error) } }
    const abortNative = () => {
      if (!task || abortCalled) return
      abortCalled = true
      try { task.abort() } catch { /* cancellation already settled the request */ }
    }
    function onAbort() {
      if (settled) return
      wasCancelled = true
      // Settle before abort(), whose native fail callback can fire synchronously.
      fail(cancelled())
      abortNative()
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted) { onAbort(); return }
    try { task = uni.request({
      url: `${config.supabaseUrl}${path}`,
      method: options.method || 'GET',
      data: options.data as UniApp.RequestOptions['data'],
      timeout: options.timeout ?? 15000,
      header: {
        apikey: config.supabaseKey,
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...options.headers
      },
      success(response) {
        if (settled) return
        if (response.statusCode >= 200 && response.statusCode < 300)
          return succeed(response.data as T)
        const body =
          response.data && typeof response.data === 'object'
            ? (response.data as Record<string, unknown>)
            : {}
        const message =
          [body.message, body.msg, body.error_description, body.error].find(
            (value): value is string => typeof value === 'string' && value.length > 0
          ) || ''
        const responseCode =
          [body.error_code, body.code].find(
            (value): value is string => typeof value === 'string' && value.length > 0
          ) || ''
        // SQL RPC errors may use the message field for an exact machine code.
        // Never search an arbitrary diagnostic for a known-code substring.
        const known = serviceErrorMessage(responseCode)
          ? responseCode
          : serviceErrorMessage(message.trim())
            ? message.trim()
            : ''
        fail(
          new ApiError(
            known
              ? serviceErrorMessage(known)!
              : path.startsWith('/auth/v1/')
                ? authErrorMessage(responseCode, response.statusCode)
                : response.statusCode === 429
                  ? '请求过于频繁，请稍后重试'
                  : response.statusCode === 401
                    ? '登录已失效，请重新登录'
                    : '服务暂时不可用，请稍后重试',
            response.statusCode,
            known || responseCode,
            retryAfterFromHeaders(response.header)
          )
        )
      },
      fail: (failure) => {
        if (settled) return
        // Uni reports timeout as a transport failure too. Keep diagnostics private,
        // but do not tell people that their connection disconnected without evidence.
        const code = /timeout|timed out/i.test(failure.errMsg || '')
          ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR'
        fail(new ApiError(serviceErrorMessage(code)!, 0, code))
      }
    })
    // An interceptor may cancel while uni.request is still creating its task.
    if (wasCancelled) abortNative()
    } catch (error) { fail(error) }
  })
}
