import assert from 'node:assert/strict'
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
  const calls = [],
    escaped = []
  let image = '',
    failPreview = true,
    delayedRoute
  const point = {
    id: 'test-poi-a',
    name: '测试水域 A',
    address: '苏州市 · 接口测试地点（非真实钓位）',
    longitude: 120.12,
    latitude: 31.12,
    crs: 'GCJ-02'
  }
  await context.routeWebSocket(/supabase\.co/, (socket) => socket.close())
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url())
    if (url.origin === base || !url.protocol.startsWith('http')) return route.continue()
    if (url.origin !== 'https://tlfmfokyhahlpzmpliad.supabase.co') {
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
    if (body.action === 'search') {
      if (body.query === '慢请求') {
        delayedRoute = route
        return
      }
      if (body.query === '无结果') return reply({ items: [], hasMore: false })
      if (body.query === '故障') return reply({ error: 'MAP_PROVIDER_FAILED' }, 502)
      return reply({
        items: [{ ...point, ...(body.page === 2 ? { id: 'test-poi-b', name: '测试水域 B' } : {}) }],
        hasMore: body.page === 1
      })
    }
    if (failPreview) {
      failPreview = false
      return reply({ error: 'MAP_NOT_CONFIGURED' }, 503)
    }
    return reply({ image, width: 640, height: 360, precision: 'exact', zoom: body.zoom })
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
  image = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 360
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#edf2ee'
    ctx.fillRect(0, 0, 640, 360)
    ctx.fillStyle = '#274e43'
    ctx.font = '22px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('TEST FIXTURE — NOT A REAL MAP', 320, 185)
    return canvas.toDataURL('image/png')
  })
  await fill('城市（选填）', '苏州')
  await fill('搜索高德地点', '水库')
  await page.locator('input[aria-label="搜索高德地点"]').press('Enter')
  await visible('测试水域 A')
  await page.getByRole('button', { name: '加载更多地点', exact: true }).click()
  await visible('测试水域 B')
  assert.equal(calls.filter((c) => c.body?.action === 'search').at(-1).body.page, 2)
  pass('place search passes explicit city and paginates without automatic location requests')
  await page.getByRole('option', { name: /测试水域 A/ }).click()
  await visible('静态地图暂不可用')
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await page.locator('.static-map-image').waitFor({ state: 'visible' })
  assert.ok((await page.locator('.static-map-image').boundingBox()).height > 100)
  pass('static map exposes missing configuration, retries, and displays an uncropped image')
  await page.getByRole('button', { name: '放大静态地图', exact: true }).click()
  await page.locator('.static-map-image').waitFor({ state: 'visible' })
  assert.equal(calls.filter((c) => c.body?.action === 'preview').at(-1).body.zoom, 15)
  pass('zoom controls request another static preview, not an interactive map')
  for (const width of [320, 440, 600]) {
    await page.setViewportSize({ width, height: 956 })
    await overflow(`static map ${width}`)
    if (width === 440) await screenshot('map-static-440-fixture.png')
  }
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.setViewportSize({ width: 320, height: 812 })
  await screenshot('map-static-dark-320-fixture.png')
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
  await page.getByRole('button', { name: '在高德地图上选点', exact: true }).click()
  await visible('地图暂时无法使用，请稍后重试；仍可查看钓位列表')
  await page.getByRole('button', { name: '改用地点搜索与静态预览', exact: true }).click()
  await visible('先找到那片水')
  await fill('搜索高德地点', '水库')
  await page.locator('input[aria-label="搜索高德地点"]').press('Enter')
  await page.getByRole('option', { name: /测试水域 A/ }).click()
  await page.getByRole('button', { name: '确认这个位置', exact: true }).click()
  await visible('已选择位置，精确位置是否公开由你决定')
  await page.waitForFunction(
    () => document.querySelector('input[aria-label="钓位名称"]')?.value === '测试水域 A'
  )
  assert.equal(await page.locator('input[aria-label="钓位名称"]').inputValue(), '测试水域 A')
  assert.equal(
    calls.some((c) => c.path.includes('fishing_write')),
    false
  )
  pass('selection returns to preserved private editor and never automatically publishes')
  assert.deepEqual(escaped, [], 'Every test network call is intercepted; no real external traffic')
}
