const env = import.meta.env
export const config = {
  supabaseUrl: (env.VITE_SUPABASE_URL || 'https://jupuypvmgjpnpntfetqv.supabase.co').replace(
    /\/$/,
    ''
  ),
  supabaseKey: (env.VITE_SUPABASE_KEY || '').trim(),
  amapKey: (env.VITE_AMAP_KEY || '').trim(),
  amapServiceHost: env.DEV ? '/_AMapService' : (env.VITE_AMAP_SERVICE_HOST || '').trim(),
  // Confirmed by the owner: personal WeChat Mini Program, not an organization.
  miniProgramSubject: 'personal',
  wechatPhone: false,
  operatorPhone: env.VITE_OPERATOR_PHONE_ENABLED === 'true',
  captcha: env.VITE_AUTH_CAPTCHA_ENABLED === 'true',
  phoneAuth: env.VITE_PHONE_AUTH_ENABLED === 'true'
} as const
export const backendReady = Boolean(config.supabaseKey)
