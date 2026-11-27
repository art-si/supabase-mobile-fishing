import assert from 'node:assert/strict'
import { setH5TextScale } from './h5-text-scale.mjs'
export async function mapContract({
  page,
  context,
  base,
  go,
  fill,
  visible,
  pass,
  overflow,
  screenshot
}) {
  page.setDefaultTimeout(45000)
  const calls = [],
    escaped = []
  let images = [],
    failPreview = true,
    failNextPage = true,
    failZoom = true,
    delayedRoute
  const point = {
    id: 'test-poi-a',
    name: '测试水域 A',
    address: '苏州市 · 接口测试地点（非真实钓位）',
    longitude: 120.12,
    latitude: 31.12,
    adcode: '320508',
    crs: 'GCJ-02'
  }
  await context.routeWebSocket(/supabase\.co/, (socket) => socket.close())
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url())
    if (url.origin === base || !url.protocol.startsWith('http')) return route.continue()
    if (url.origin === 'https://tiles.openfreemap.org' && url.pathname === '/planet')
      return route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: '' })
    if (url.origin !== 'https://jupuypvmgjpnpntfetqv.supabase.co') {
      escaped.push(url.origin)
      return route.abort()
    }
    const reply = (body, status = 200) =>
      route.fulfill({
        status,
        json: body,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'POST,GET,OPTIONS'
        }
      })
    if (request.method() === 'OPTIONS') return reply({})
    const body = request.postDataJSON()
    calls.push({ path: url.pathname, body, authorization: request.headers().authorization })
    if (url.pathname === '/rest/v1/rpc/fishing_moderation') return reply({ allowed: false })
    if (url.pathname === '/rest/v1/rpc/fishing_read') return reply({ items: [], next: null })
    if (url.pathname === '/rest/v1/rpc/fishing_spot_creation_check') return reply({ blocked: false, sources: [], checked_at: '2026-01-01T00:00:00Z' })
    if (url.pathname === '/rest/v1/rpc/fishing_zones_read') {
      assert.equal(body.action, 'nearby')
      return reply({ items: [], truncated: false, zoom_in: false })
    }
    if (url.pathname !== '/functions/v1/amap') {
      escaped.push(url.pathname)
      return route.abort()
    }
    assert.equal(request.method(), 'POST')
    assert.equal(request.headers().authorization, 'Bearer contract-user-token')
    if (body.action === 'region') return reply({ province: '湖北省', city: '武汉市', district: '汉阳区', adcode: '420105', citycode: '027' })
    if (body.action === 'search') {
      if (body.query === '北太子湖') return reply({ items: [{ ...point, name: '北太子湖', address: '武汉市 · 契约水域', longitude: 114.19, latitude: 30.517, adcode: '420105' }], hasMore: false })
      if (body.query === '慢请求') {
        delayedRoute = route
        return
      }
      if (body.query === '无结果') return reply({ items: [], hasMore: false })
      if (body.query === '故障') return reply({ error: 'MAP_PROVIDER_FAILED' }, 502)
      if (body.page === 2 && failNextPage) {
        failNextPage = false
        return reply({ error: 'MAP_PROVIDER_FAILED' }, 502)
      }
      return reply({
        items: [{ ...point, ...(body.page === 2 ? { id: 'test-poi-b', name: '测试水域 B' } : {}) }],
        hasMore: body.page === 1
      })
    }
    assert.equal(body.action, 'preview')
    if (failPreview) {
      failPreview = false
      return reply({ error: 'MAP_NOT_CONFIGURED' }, 503)
    }
    if (body.zoom === 15 && failZoom) {
      failZoom = false
      delayedRoute = route
      return
    }
    return reply({ image: images[body.zoom === 15 ? 1 : 0], width: 640, height: 360, precision: 'exact', zoom: body.zoom })
  })
  await go('/pages/map/search')
  await fill('搜索高德地点', '水库')
  await page.getByRole('button', { name: '登录后搜索地点', exact: true }).click()
  await visible('手机号登录')
  assert.equal(
    calls.some((c) => c.path.includes('/amap')),
    false
  )
  pass('static map requires login before protected service requests')
  // Map-only fixture, not a simulated successful SMS login. No Auth endpoints are mocked.
  await page.evaluate(() =>
    localStorage.setItem(
      'dyj.auth.v1',
      JSON.stringify({
        type: 'object',
        data: {
          access_token: 'contract-user-token',
          refresh_token: 'contract-refresh',
          expires_at: Date.now() / 1000 + 3600,
          user: { id: '11111111-1111-4111-8111-111111111111' }
        }
      })
    )
  )
  await go('/pages/map/search')
  await page.reload()
  await visible('先找到那片水')
  pass('isolated signed-in map session resumes search without a fake SMS success')
  images = await page.evaluate(() => ['#edf2ee', '#e7eee5'].map((color) => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 360
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 640, 360)
    ctx.fillStyle = '#274e43'
    ctx.font = '22px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('TEST FIXTURE — NOT A REAL MAP', 320, 185)
    return canvas.toDataURL('image/png')
  }))
  const button = (name) => page.getByRole('button', { name, exact: true })
  const searchInput = page.locator('input[aria-label="搜索高德地点"]')
  await button('选择搜索城市').click()
  const citySheet = page.getByRole('dialog', { name: '选择搜索城市' })
  await citySheet.locator('input[aria-label="搜索城市"]').fill('苏州')
  await citySheet.getByRole('button', { name: '选择苏州市', exact: true }).click()
  await citySheet.waitFor({ state: 'hidden' })
  await fill('搜索高德地点', '水库')
  await searchInput.press('Enter')
  await visible('测试水域 A')
  const searchCalls = () => calls.filter((c) => c.body?.action === 'search')
  assert.equal(searchCalls().at(-1).body.city, '苏州市')
  const viewport = page.viewportSize()
  await page.setViewportSize({ width: viewport.width, height: 300 })
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await visible('地图未能加载，请检查网络后重试')
  await visible('测试水域 A')
  await button('重试').click()
  await visible('测试水域 B')
  assert.deepEqual(searchCalls().map((c) => c.body.page), [1, 2, 2])
  await page.setViewportSize(viewport)
  pass('place search passes the selected city and retries only the failed page')
  await searchInput.press('ArrowDown')
  await searchInput.press('Enter')
  await visible('静态地图暂不可用')
  await button('重试').click()
  const frame = page.locator('.static-map-image:not([aria-hidden="true"])')
  const stage = page.locator('.static-map-stage')
  await frame.waitFor({ state: 'visible' })
  assert.ok((await stage.boundingBox()).height > 100)
  pass('static map exposes missing configuration, retries, and displays an uncropped image')
  const zoomIn = button('放大静态地图')
  const previewCalls = () => calls.filter((c) => c.body?.action === 'preview')
  await zoomIn.focus()
  const original = await stage.boundingBox()
  const zoomRequest = page.waitForRequest((r) => r.postDataJSON()?.zoom === 15)
  await zoomIn.press('Enter')
  await zoomRequest
  await page.getByText('正在更新地图…', { exact: true }).waitFor()
  assert.equal(await zoomIn.getAttribute('aria-disabled'), 'true')
  assert.equal(await zoomIn.evaluate((node) => node === document.activeElement), true)
  await zoomIn.press('Enter')
  assert.equal(previewCalls().filter((c) => c.body.zoom === 15).length, 1)
  assert.deepEqual(await stage.boundingBox(), original)
  assert.ok(await frame.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0))
  await delayedRoute.fulfill({
    status: 502,
    json: { error: 'MAP_PROVIDER_FAILED' },
    headers: { 'access-control-allow-origin': '*' }
  })
  await visible('未能更新地图')
  assert.equal(await frame.locator('img').getAttribute('src'), images[0])
  await button('重试').click()
  await page.waitForFunction((expected) => {
    const image = document.querySelector('.static-map-image:not([aria-hidden="true"]) img')
    return image?.complete && image.getAttribute('src') === expected
  }, images[1])
  assert.deepEqual(previewCalls().map((c) => c.body.zoom), [14, 14, 15, 15])
  pass('keyboard zoom preserves its frame and focus while loading and retries the failed scale')
  for (const [width, height] of [[320, 700], [375, 812], [440, 956], [844, 390], [1280, 800]]) {
    await page.setViewportSize({ width, height })
    await overflow(`static map ${width}x${height}`)
    if (width === 440) await screenshot('map-static-440-fixture.png')
  }
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.setViewportSize({ width: 320, height: 812 })
  await setH5TextScale(page, 32)
  await overflow('static map dark at 200% text')
  await screenshot('map-static-dark-320-fixture.png')
  await setH5TextScale(page, 16)
  await fill('搜索高德地点', '无结果')
  await page.locator('input[aria-label="搜索高德地点"]').press('Enter')
  await visible('没有找到相关地点，试试附近的桥、公园或更换城市。')
  assert.equal(await page.locator('.static-map-image').count(), 0)
  pass('changed query clears previous selection and empty result gives recovery guidance')
  await fill('搜索高德地点', '故障')
  await page.locator('input[aria-label="搜索高德地点"]').press('Enter')
  await visible('地图未能加载，请检查网络后重试')
  await screenshot('map-search-error-dark-320.png')
  await fill('搜索高德地点', '慢请求')
  const pending = page.waitForRequest((r) => r.postData()?.includes('慢请求'))
  await page.locator('input[aria-label="搜索高德地点"]').press('Enter')
  await pending
  await fill('搜索高德地点', '桥')
  await page.locator('input[aria-label="搜索高德地点"]').press('Enter')
  await visible('测试水域 A')
  const finished = page.waitForResponse((r) => r.request().postData()?.includes('慢请求'))
  await delayedRoute.fulfill({
    json: { items: [{ ...point, name: '过期结果' }], hasMore: false },
    headers: { 'access-control-allow-origin': '*' }
  })
  await finished
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  )
  assert.equal(await page.getByText('过期结果', { exact: true }).count(), 0)
  pass('late search response cannot replace a newer query')
  await go('/pages/spot/create')
  await fill('钓位名称（选填）', '保留这个草稿名')
  await button('水域地图选点').click()
  await visible('地图暂时未能加载')
  await page.getByRole('button', { name: '改用地点搜索与静态预览', exact: true }).click()
  await visible('先找到那片水')
  await fill('搜索高德地点', '北太子湖')
  await page.locator('input[aria-label="搜索高德地点"]').press('Enter')
  await page.getByRole('option', { name: /北太子湖/ }).click()
  await page.getByRole('button', { name: '确认这处水域', exact: true }).click()
  await page.locator('.spot-entry__address').getByText('北太子湖', { exact: true }).waitFor()
  await page.locator('.spot-entry__address').getByText('武汉市', { exact: true }).waitFor()
  assert.equal(await page.locator('input[aria-label="钓位名称（选填）"]').inputValue(), '保留这个草稿名')
  assert.equal(
    calls.some((c) => c.path.includes('fishing_write')),
    false
  )
  pass('selection returns to preserved private editor and never automatically publishes')
  assert.deepEqual(escaped, [], 'Every test network call is intercepted; no real external traffic')
}
