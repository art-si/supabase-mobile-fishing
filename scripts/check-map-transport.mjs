// Read-only browser-origin probe. Logs statuses only, never keys, queries or responses.
import { chromium } from 'playwright'
import { readFile, readdir } from 'node:fs/promises'
const env = Object.fromEntries(
  (await readFile('.env.local', 'utf8')).split(/\r?\n/).flatMap((line) => {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    return m ? [[m[1], m[2].trim()]] : []
  })
)
const target = 'https://tlfmfokyhahlpzmpliad.supabase.co'
if (env.VITE_SUPABASE_URL !== target || !env.VITE_SUPABASE_KEY?.startsWith('sb_publishable_'))
  throw new Error('Unconfirmed public configuration')
const bundles = (await readdir('dist/build/h5/assets')).filter((name) => name.endsWith('.js'))
const compiled = (
  await Promise.all(bundles.map((name) => readFile(`dist/build/h5/assets/${name}`, 'utf8')))
).join('\n')
console.log(
  JSON.stringify({
    check: 'compiled-public-configuration',
    confirmedProject: compiled.includes(target),
    currentPublishableKey: compiled.includes(env.VITE_SUPABASE_KEY),
    currentMapKey: compiled.includes(env.VITE_AMAP_KEY)
  })
)
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const results = await Promise.all(
    [5179, 5181].map(async (port) => {
      const context = await browser.newContext()
      const page = await context.newPage()
      await page.route(`http://127.0.0.1:${port}/__origin-probe`, (route) =>
        route.fulfill({ contentType: 'text/html', body: '<p>Read-only transport probe</p>' })
      )
      await page.goto(`http://127.0.0.1:${port}/__origin-probe`)
      const result = await page.evaluate(
        async ({ target, key }) => {
          async function probe(path, options = {}) {
            const start = performance.now()
            try {
              const response = await fetch(target + path, {
                ...options,
                signal: AbortSignal.timeout(15000)
              })
              return { status: response.status, ms: Math.round(performance.now() - start) }
            } catch (error) {
              return { error: error.name, ms: Math.round(performance.now() - start) }
            }
          }
          return {
            spots: await probe('/rest/v1/rpc/fishing_map_spots', {
              method: 'POST',
              headers: { apikey: key, 'Content-Type': 'application/json' },
              body: JSON.stringify({ payload: { west: 120, east: 121, south: 31, north: 32 } })
            }),
            api: await probe('/rest/v1/rpc/fishing_zones_read', {
              method: 'POST',
              headers: { apikey: key, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'nearby',
                payload: { west: 120, east: 121, south: 31, north: 32 }
              })
            }),
            proxy: await probe(
              '/functions/v1/amap-js/_AMapService/v3/assistant/inputtips?key=invalid-transport-probe'
            )
          }
        },
        { target, key: env.VITE_SUPABASE_KEY }
      )
      await context.close()
      return { port, ...result }
    })
  )
  console.log(JSON.stringify({ check: 'browser-origin-transport', results }, null, 2))
  if (results.some((r) => r.spots.status !== 200 || r.api.status !== 200 || r.proxy.status !== 400))
    process.exitCode = 1
} finally {
  await browser.close()
}
