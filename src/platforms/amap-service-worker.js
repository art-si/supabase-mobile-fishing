const endpoint = 'https://jupuypvmgjpnpntfetqv.supabase.co/functions/v1/amap-js'

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || request.mode === 'navigate' || url.origin !== self.location.origin || !url.pathname.startsWith('/_AMapService/')) return
  event.respondWith(fetch(endpoint + url.pathname + url.search, {
    credentials: 'omit', redirect: 'error', cache: 'no-store'
  }).then(response => new Response(response.body, {
    status: response.status, headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  })))
})
