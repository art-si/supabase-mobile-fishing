import { createSmsHookHandler } from './handler.ts'
import { sendPnvsSms } from './pnvs.ts'
import { createSupabaseDeliveryStore } from '../_shared/sms-idempotency.ts'

// Missing runtime secrets fail closed per request instead of crashing the function.
function deliveryStore() {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    if (supabaseUrl.replace(/\/$/, '') !== 'https://tlfmfokyhahlpzmpliad.supabase.co')
      return undefined
    return createSupabaseDeliveryStore({
      supabaseUrl,
      serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    })
  } catch {
    return undefined
  }
}

// Test-recipient-only and disabled by default. No public send mode exists.
// Enabling delivery alone cannot bypass the durable ledger or recipient allowlist.
// Deployment also needs verify_jwt=false for this function only, plus an authenticated
// Standard Webhooks Send SMS Hook in Supabase Auth. No changes are made here to Auth.
Deno.serve(
  createSmsHookHandler({
    config: () => ({
      deliveryEnabled: Deno.env.get('SMS_DELIVERY_ENABLED') === 'true',
      allowedTestPhones: (Deno.env.get('SMS_ALLOWED_TEST_PHONES') || '')
        .split(',')
        .map((phone) => phone.trim())
        .filter(Boolean),
      hookSecret: Deno.env.get('SEND_SMS_HOOK_SECRET') || '',
      idempotencySecret: Deno.env.get('SMS_IDEMPOTENCY_SECRET') || '',
      accessKeyId: Deno.env.get('ALIYUN_PNVS_ACCESS_KEY_ID') || '',
      accessKeySecret: Deno.env.get('ALIYUN_PNVS_ACCESS_KEY_SECRET') || '',
      securityToken: Deno.env.get('ALIYUN_PNVS_SECURITY_TOKEN') || undefined,
      signName: Deno.env.get('ALIYUN_PNVS_SIGN_NAME') || '',
      templateCode: Deno.env.get('ALIYUN_PNVS_TEMPLATE_CODE') || '',
      schemeName: Deno.env.get('ALIYUN_PNVS_SCHEME_NAME') || '',
      otpExpirySeconds: Number(Deno.env.get('SMS_OTP_EXPIRY_SECONDS')),
      intervalSeconds: Number(Deno.env.get('SMS_MIN_INTERVAL_SECONDS'))
    }),
    store: deliveryStore(),
    send: sendPnvsSms
  })
)
