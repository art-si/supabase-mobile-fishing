import { config } from '@/config'
import { authErrorMessage, retryAfterFromHeaders } from '@/domain/auth-errors'
import { serviceErrorMessage } from '@/domain/user-errors'
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
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  data?: unknown
  token?: string
  headers?: Record<string, string>
}
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!config.supabaseKey)
    throw new ApiError('服务暂时不可用，请稍后重试', 0, 'SERVICE_UNAVAILABLE')
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${config.supabaseUrl}${path}`,
      method: options.method || 'GET',
      data: options.data as UniApp.RequestOptions['data'],
      timeout: 15000,
      header: {
        apikey: config.supabaseKey,
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...options.headers
      },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300)
          return resolve(response.data as T)
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
        reject(
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
      fail: () => reject(new ApiError(serviceErrorMessage('NETWORK_ERROR')!, 0, 'NETWORK_ERROR'))
    })
  })
}
