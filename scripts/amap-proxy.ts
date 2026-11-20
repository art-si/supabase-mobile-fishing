import { networkInterfaces } from 'node:os'
import type { Plugin, ViteDevServer, PreviewServer } from 'vite'
import { createJsMapHandler } from '../supabase/functions/_shared/amap-js'

// Development/preview only. Production and Capacitor require the hosted HTTPS proxy.
export function amapProxy(key: string, securityCode: string): Plugin {
  const install = (server: ViteDevServer | PreviewServer) => {
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
    for (const addresses of Object.values(networkInterfaces()))
      for (const address of addresses || [])
        if (address.family === 'IPv4') localHosts.add(address.address)
    let minute = 0,
      count = 0,
      day = 0,
      daily = 0
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/_AMapService/')) return next()
      try {
        const url = new URL(req.url, `http://${req.headers.host}`)
        if (!localHosts.has(url.hostname)) {
          res.writeHead(403).end()
          return
        }
        const handler = createJsMapHandler({
          key,
          securityCode,
          allowedOrigins: [url.origin],
          fetch,
          reserve: async () => {
            const now = Date.now()
            if (Math.floor(now / 60000) !== minute) {
              minute = Math.floor(now / 60000)
              count = 0
            }
            if (Math.floor(now / 86400000) !== day) {
              day = Math.floor(now / 86400000)
              daily = 0
            }
            if (count >= 60 || daily >= 1000) return false
            count++
            daily++
            return true
          }
        })
        const headers = new Headers()
        for (const name of ['origin', 'referer']) {
          const value = req.headers[name]
          if (typeof value === 'string') headers.set(name, value)
        }
        const reply = await handler(new Request(url, { method: req.method, headers }))
        res.writeHead(reply.status, Object.fromEntries(reply.headers))
        res.end(Buffer.from(await reply.arrayBuffer()))
      } catch {
        res
          .writeHead(502, { 'Content-Type': 'application/json' })
          .end('{"error":"MAP_PROVIDER_FAILED"}')
      }
    })
  }
  return {
    name: 'fishing-amap-server-proxy',
    configureServer: install,
    configurePreviewServer: install
  }
}
