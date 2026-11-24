import { createJsMapHandler, jsMapAllowedOrigins } from '../_shared/amap-js.ts'
import { service } from '../_shared/http.ts'

Deno.serve(
  createJsMapHandler({
    key: Deno.env.get('AMAP_JS_KEY') || '',
    securityCode: Deno.env.get('AMAP_SECURITY_JS_CODE') || '',
    allowedOrigins: jsMapAllowedOrigins(Deno.env.get('AMAP_JS_ALLOWED_ORIGINS') || ''),
    reserve: async () => {
      const response = await service('/rest/v1/rpc/fishing_js_map_ticket', {
        method: 'POST',
        body: '{}',
        signal: AbortSignal.timeout(5000)
      })
      if (!response.ok) throw new Error('MAP_QUOTA_UNAVAILABLE')
      return (await response.json()) === true
    },
    fetch
  })
)
