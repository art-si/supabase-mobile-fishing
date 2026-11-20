// Official metadata: Dypnsapi / 2017-05-25 / SendSmsVerifyCode is RPC,
// POST /, with query parameters. Never log this URL: it contains phone + OTP.
// https://api.aliyun.com/meta/v1/products/Dypnsapi/versions/2017-05-25/apis/SendSmsVerifyCode/api.json
// Signature V3: https://help.aliyun.com/en/sdk/product-overview/v3-request-structure-and-signature
const ENDPOINT = 'dypnsapi.aliyuncs.com'
const encoder = new TextEncoder()

export interface PnvsConfig {
  accessKeyId: string
  accessKeySecret: string
  securityToken?: string
  signName: string
  templateCode: string
  schemeName: string
  otpExpirySeconds: number
  intervalSeconds: number
}

export interface SmsMessage {
  phone: string
  otp: string
}

export type SendOutcome = 'accepted' | 'rejected' | 'unknown'

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('')
}

export async function sha256(value: string) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

export async function hmacSha256(key: Uint8Array, value: string) {
  const imported = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return hex(await crypto.subtle.sign('HMAC', imported, encoder.encode(value)))
}

function encode(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

// Exported for the official known-answer test, not for accepting caller endpoints.
export async function signAcs3(input: {
  host: string
  action: string
  version: string
  query: Record<string, string>
  accessKeyId: string
  accessKeySecret: string
  securityToken?: string
  date: string
  nonce: string
}) {
  const query = Object.keys(input.query)
    .sort()
    .map((key) => `${encode(key)}=${encode(input.query[key])}`)
    .join('&')
  const payloadHash = await sha256('')
  const headers: Record<string, string> = {
    host: input.host,
    'x-acs-action': input.action,
    'x-acs-version': input.version,
    'x-acs-date': input.date,
    'x-acs-signature-nonce': input.nonce,
    'x-acs-content-sha256': payloadHash
  }
  if (input.securityToken) headers['x-acs-security-token'] = input.securityToken
  const names = Object.keys(headers).sort()
  const signedHeaders = names.join(';')
  const canonicalHeaders = names.map((key) => `${key}:${headers[key].trim()}\n`).join('')
  const canonicalRequest = `POST\n/\n${query}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
  const stringToSign = `ACS3-HMAC-SHA256\n${await sha256(canonicalRequest)}`
  const signature = await hmacSha256(encoder.encode(input.accessKeySecret), stringToSign)
  headers.Authorization = `ACS3-HMAC-SHA256 Credential=${input.accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`
  return { query, headers }
}

export function validPnvsConfig(config: PnvsConfig) {
  const bounded = (value: unknown, max: number) =>
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    value === value.trim() &&
    !/[\r\n\u0000]/.test(value)
  return (
    bounded(config.accessKeyId, 128) &&
    /^[A-Za-z0-9]+$/.test(config.accessKeyId) &&
    bounded(config.accessKeySecret, 256) &&
    bounded(config.signName, 100) &&
    bounded(config.templateCode, 100) &&
    /^[A-Za-z0-9_-]+$/.test(config.templateCode) &&
    bounded(config.schemeName, 20) &&
    (!config.securityToken || bounded(config.securityToken, 8192)) &&
    Number.isSafeInteger(config.otpExpirySeconds) &&
    config.otpExpirySeconds >= 60 &&
    config.otpExpirySeconds <= 600 &&
    config.otpExpirySeconds % 60 === 0 &&
    Number.isSafeInteger(config.intervalSeconds) &&
    config.intervalSeconds >= 60 &&
    config.intervalSeconds <= 3600
  )
}

// A single attempt only. Neither HTTP transport nor PNVS automatic retries are enabled.
// The caller must hold a durable claim BEFORE invoking this adapter.
export async function sendPnvsSms(
  config: PnvsConfig,
  message: SmsMessage,
  signal: AbortSignal,
  transport: typeof fetch = fetch
): Promise<SendOutcome> {
  if (
    !validPnvsConfig(config) ||
    !/^\+861[3-9]\d{9}$/.test(message.phone) ||
    !/^\d{6}$/.test(message.otp) ||
    signal.aborted
  )
    return 'rejected'
  const controller = new AbortController()
  const cancel = () => controller.abort()
  signal.addEventListener('abort', cancel, { once: true })
  const timeout = setTimeout(cancel, 2000)
  try {
    const request = await signAcs3({
      host: ENDPOINT,
      action: 'SendSmsVerifyCode',
      version: '2017-05-25',
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      securityToken: config.securityToken,
      date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      nonce: crypto.randomUUID(),
      query: {
        SchemeName: config.schemeName,
        CountryCode: '86',
        PhoneNumber: message.phone.slice(3),
        SignName: config.signName,
        TemplateCode: config.templateCode,
        TemplateParam: JSON.stringify({
          code: message.otp,
          min: String(config.otpExpirySeconds / 60)
        }),
        CodeLength: '6',
        ValidTime: String(config.otpExpirySeconds),
        Interval: String(config.intervalSeconds),
        DuplicatePolicy: '1',
        ReturnVerifyCode: 'false',
        AutoRetry: '0'
      }
    })
    if (controller.signal.aborted) return 'unknown'
    const response = await transport(`https://${ENDPOINT}/?${request.query}`, {
      method: 'POST',
      headers: { ...request.headers, accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal
    })
    // Even a 5xx/redirect is ambiguous after submission. Do not echo diagnostics.
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      return 'unknown'
    }
    const reader = response.body?.getReader()
    if (!reader) return 'unknown'
    let size = 0
    const chunks: Uint8Array[] = []
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > 16384) {
          await reader.cancel()
          return 'unknown'
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    const result: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!result || typeof result !== 'object' || Array.isArray(result)) return 'unknown'
    const record = result as Record<string, unknown>
    if (record.Code === 'OK' && record.Success === true) return 'accepted'
    if (typeof record.Code === 'string' && record.Code !== 'OK' && record.Success === false)
      return 'rejected'
    return 'unknown'
  } catch {
    return 'unknown'
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', cancel)
  }
}
