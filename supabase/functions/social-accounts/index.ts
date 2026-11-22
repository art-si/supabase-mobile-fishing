import { createHash, createHmac } from 'node:crypto'
import { fishingHandler, fishingRpc, FishingError } from '../_shared/fishing-edge.ts'
import { platforms, type Platform } from '../_shared/discovery-contract.ts'

const providers = {
  douyin: {
    authorize: 'https://open.douyin.com/platform/oauth/connect/',
    token: 'https://open.douyin.com/oauth/access_token/'
  },
  toutiao: {
    authorize: 'https://open.snssdk.com/oauth/authorize/',
    token: 'https://open.snssdk.com/oauth/access_token/'
  },
  bilibili: {
    authorize: 'https://account.bilibili.com/pc/account-pc/auth/oauth',
    token: 'https://api.bilibili.com/x/account-oauth2/v1/token'
  }
} satisfies Record<Platform, { authorize: string; token: string }>

function configuration(platform: Platform) {
  const prefix = 'SOCIAL_' + platform.toUpperCase()
  const id = Deno.env.get(prefix + '_CLIENT_ID')
  const secret = Deno.env.get(prefix + '_CLIENT_SECRET')
  const callback = Deno.env.get('SOCIAL_H5_CALLBACK')
  if (!id || !secret || !callback) return null
  try {
    const url = new URL(callback)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        !url.pathname.endsWith('/static/social-callback.html')) return null
    return { id, secret, callback: url.href }
  } catch { return null }
}

type Credentials = NonNullable<ReturnType<typeof configuration>>
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

async function exchange(platform: Platform, credentials: Credentials, code: string) {
  const { id, secret } = credentials
  const bili = platform === 'bilibili'
  const url = new URL(providers[platform].token)
  const params = new URLSearchParams({
    [bili ? 'client_id' : 'client_key']: id,
    client_secret: secret,
    grant_type: 'authorization_code',
    code
  })
  if (bili) url.search = params.toString()
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(3500),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    ...(bili ? {} : { body: params })
  })
  if (!response.ok) throw new FishingError('SOCIAL_FAILED', 502)
  const payload = await response.json()
  if (!['0', 0].includes(bili ? payload.code : payload.data?.error_code))
    throw new FishingError('SOCIAL_FAILED', 502)
  if (!bili) return payload.data?.open_id
  if (typeof payload.data?.access_token !== 'string') throw new FishingError('SOCIAL_FAILED', 502)

  const headers = {
    'x-bili-accesskeyid': id,
    'x-bili-content-md5': createHash('md5').update('').digest('hex'),
    'x-bili-signature-method': 'HMAC-SHA256',
    'x-bili-signature-nonce': crypto.randomUUID(),
    'x-bili-signature-version': '2.0',
    'x-bili-timestamp': String(Math.floor(Date.now() / 1000))
  }
  const canonical = Object.entries(headers).map(([name, value]) => name + ':' + value).join('\n')
  const profile = await fetch('https://member.bilibili.com/arcopen/fn/user/account/info', {
    redirect: 'error',
    signal: AbortSignal.timeout(3500),
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'access-token': payload.data.access_token,
      Authorization: createHmac('sha256', secret).update(canonical).digest('hex')
    }
  })
  if (!profile.ok) throw new FishingError('SOCIAL_FAILED', 502)
  const identity = await profile.json()
  return identity.code === 0 ? identity.data?.openid : null
}

Deno.serve(fishingHandler(async (caller, input) => {
  const operation = input.operation
  const uid = caller.id
  if (operation === 'list') {
    const bound = await fishingRpc<Partial<Record<Platform, string>>>('fishing_external_account',
      { uid, operation })
    return Object.keys(platforms).map(key => {
      const platform = key as Platform
      return { platform, available: Boolean(configuration(platform)), boundAt: bound[platform] ?? null }
    })
  }
  if (typeof input.platform !== 'string' || !Object.hasOwn(providers, input.platform))
    throw new FishingError('INVALID_INPUT', 400)
  const platform = input.platform as Platform

  async function update(operation: string, state?: string, subject?: string) {
    const result = await fishingRpc<string>('fishing_external_account', {
      uid, operation, platform, state_digest: state ? digest(state) : null, subject_digest: subject
    })
    if (result !== 'ok') throw new FishingError(result, 409)
  }
  if (operation === 'unlink') {
    await update('unlink')
    return { ok: true }
  }
  const credentials = configuration(platform)
  if (!credentials) throw new FishingError('SOCIAL_UNAVAILABLE', 503)
  if (operation === 'start') {
    const state = crypto.randomUUID()
    await update('start', state)
    const url = new URL(providers[platform].authorize)
    url.search = new URLSearchParams(platform === 'bilibili'
      ? { client_id: credentials.id, gourl: credentials.callback, state }
      : { client_key: credentials.id, response_type: 'code', scope: 'user_info',
          redirect_uri: credentials.callback, state }).toString()
    return { url: url.href, state }
  }
  if (operation !== 'finish' || typeof input.state !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(input.state) || typeof input.code !== 'string' ||
      !input.code || input.code.length > 512) throw new FishingError('SOCIAL_EXPIRED', 400)
  await update('check', input.state)
  const subject = await exchange(platform, credentials, input.code)
  if (typeof subject !== 'string' || !subject || subject.length > 256)
    throw new FishingError('SOCIAL_FAILED', 502)
  await update('finish', input.state, digest(JSON.stringify([platform, credentials.id, subject])))
  return { ok: true }
}))
