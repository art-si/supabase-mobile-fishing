export async function amapServiceHost(configured: string, backend: string, href: string, native: boolean) {
  if (!configured) throw new Error('MAP_NOT_CONFIGURED')
  const location = new URL(href)
  const edgePath = '/functions/v1/amap-js/_AMapService'
  const proxy = native && configured === '/_AMapService'
    ? new URL(edgePath, backend) : new URL(configured, location)
  const localWeb = !native && proxy.protocol === 'http:' && proxy.origin === location.origin
  const hosted = proxy.origin === backend && proxy.origin === 'https://jupuypvmgjpnpntfetqv.supabase.co' && proxy.pathname === edgePath
  if ((proxy.protocol !== 'https:' && !localWeb) || (!hosted && proxy.pathname !== '/_AMapService') ||
      proxy.search || proxy.hash || proxy.username || proxy.password) throw new Error('MAP_NOT_CONFIGURED')
  if (!hosted) return proxy.href
  if (!/^https?:$/.test(location.protocol) || !globalThis.isSecureContext || !navigator.serviceWorker) throw new Error('MAP_NOT_CONFIGURED')
  const workers = navigator.serviceWorker
  const script = new URL('amap-service-worker.js', location)
  const scope = new URL('./', script).href
  if (workers.controller?.scriptURL !== script.href) {
    const existing = await workers.getRegistration(scope)
    if (existing?.active && existing.active.scriptURL !== script.href) throw new Error('MAP_NOT_CONFIGURED')
    await workers.register(script.href, { scope })
    await new Promise<void>((resolve, reject) => {
      const finish = () => { clearTimeout(timeout); workers.removeEventListener('controllerchange', controlled) }
      const controlled = () => { if (workers.controller?.scriptURL === script.href) { finish(); resolve() } }
      const timeout = setTimeout(() => { finish(); reject(new Error('MAP_NOT_CONFIGURED')) }, 5000)
      workers.addEventListener('controllerchange', controlled)
      controlled()
    })
  }
  return new URL('/_AMapService', location).href
}
