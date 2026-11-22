import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
// No real calls to government offices, SMS, GPS or cloud uploads. All external requests are intercepted.
export async function waterReportContract({
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
  const owner = '11111111-1111-4111-8111-111111111111',
    other = '22222222-2222-4222-8222-222222222222'
  const profile = {
    id: owner,
    nickname: '线索接口测试',
    handle: 'TEST',
    city: '黄石',
    bio: '',
    method: ''
  }
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ1kAAAAASUVORK5CYII=',
    'base64'
  )
  const assets = [],
    writes = [],
    escaped = []
  let uploads = 0,
    record,
    failWrite = true,
    deletions = 0
  await context.routeWebSocket(/supabase\.co/, socket => socket.close())
  await context.route('**/*', async (route) => {
    const req = route.request(),
      url = new URL(req.url())
    if (url.origin === base || !url.protocol.startsWith('http')) return route.continue()
    if (url.origin !== 'https://jupuypvmgjpnpntfetqv.supabase.co') {
      escaped.push(url.href)
      return route.abort()
    }
    const reply = (json, status = 200) =>
      route.fulfill({
        status,
        json,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET,POST,OPTIONS'
        }
      })
    if (req.method() === 'OPTIONS') return reply({})
    if (url.pathname === '/functions/v1/media-upload') {
      uploads++
      if (uploads === 2) return reply({ error: 'fixture unavailable' }, 503)
      const asset = { id: randomUUID(), path: `fixture/photo-${uploads}.png`, width: 1, height: 1 }
      assets.push(asset)
      return reply(asset)
    }
    if (url.pathname.startsWith('/storage/v1/object/sign/')) {
      if (req.method() === 'POST')
        return reply({ signedURL: url.pathname.replace('/storage/v1', '') + '?fixture=1' })
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: png,
        headers: { 'access-control-allow-origin': '*' }
      })
    }
    const body = req.postDataJSON() || {},
      uid = req.headers().authorization?.includes('report-B') ? other : owner
    if (url.pathname === '/auth/v1/otp') return reply({})
    if (url.pathname === '/auth/v1/verify')
      return reply({
        access_token: 'report-A',
        refresh_token: 'fixture-report-refresh',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: owner }
      })
    if (url.pathname === '/rest/v1/rpc/fishing_moderation') return reply({ allowed: false })
    if (url.pathname === '/rest/v1/rpc/fishing_read') {
      if (body.action === 'water_reports') {
        if (body.payload.id)
          return uid === owner && record?.id === body.payload.id
            ? reply(record)
            : reply({ message: 'NOT_FOUND' }, 404)
        return reply({ items: uid === owner && record ? [record] : [] })
      }
      if (body.action === 'profile')
        return reply({ profile, posts: [], friend: false, following: false, blocked: false })
      if (['feed', 'spots'].includes(body.action)) return reply({ items: [], next: null })
      return reply({ message: 'NOT_FOUND' }, 404)
    }
    if (url.pathname === '/rest/v1/rpc/fishing_write') {
      writes.push(body)
      if (body.action === 'save_water_report') {
        if (failWrite) {
          failWrite = false
          return reply({ message: 'fixture network failure' }, 503)
        }
        record = {
          ...body.payload,
          media: assets.filter((a) => body.payload.media.some((m) => m.id === a.id)),
          status: 'saved',
          crs: 'GCJ-02',
          created_at: new Date().toISOString()
        }
        return reply(record)
      }
      if (body.action === 'delete_water_report') {
        deletions++
        record = undefined
        return reply(true)
      }
    }
    escaped.push(url.href)
    return route.abort()
  })
  const button = (name) => page.getByRole('button', { name, exact: true })
  await go('/pages/water-report/index')
  await visible('中国渔政举报受理平台')
  assert.equal(await page.locator('input[aria-label="现场情况"]').count(), 0)
  pass('guest can find sourced nationwide channels without starting a private report')
  await button('手机号登录').click()
  await fill('手机号码', '13800138000')
  const loginConsent = page.getByRole('checkbox', { name: '同意用户协议与隐私说明' })
  if ((await loginConsent.getAttribute('aria-checked')) !== 'true') await loginConsent.click()
  await button('获取验证码').click()
  await page.getByText(/^验证码已发送/).waitFor()
  await fill('短信验证码', '123456')
  await button('登录 / 注册').click()
  await page.waitForURL((u) => !u.hash.startsWith('#/pages/login'))
  await go('/pages/water-report/index')
  await page.locator('#report-region').click()
  const region=page.getByRole('dialog',{name:'选择事发地区',exact:true})
  await region.locator('input[aria-label="搜索地区"]').fill('阳新县')
  await region.getByRole('button',{name:'选择阳新县',exact:true}).click()
  await fill('具体水域与位置', '接口测试水域，东岸桥边')
  await fill('现场情况', '接口测试：看到两人手持疑似电鱼设备，未靠近。')
  assert.equal(await button('添加图片 / 视频').isDisabled(),false)
  await button('上报').click()
  await visible('请选择事发水域，获取经纬度')
  assert.equal(uploads,0);assert.equal(writes.length,0)
  pass('a location description alone cannot start reporting; attachments can be added directly')
  await page.evaluate(owner=>{
    const key='dyj.live.draft.'+owner+'.water-report'
    const stored=JSON.parse(localStorage.getItem(key))
    Object.assign(stored.data,{longitude:115.22,latitude:29.84,_edited:true})
    localStorage.setItem(key,JSON.stringify(stored))
  },owner)
  await page.reload({waitUntil:'domcontentloaded'})
  await page.getByText(/^已选位置：/).waitFor()
  const chooser=page.waitForEvent('filechooser')
  await button('添加图片 / 视频').click()
  await(await chooser).setFiles([{name:'scene-a.png',mimeType:'image/png',buffer:png},{name:'scene-b.png',mimeType:'image/png',buffer:png}])
  await button('重试上传').waitFor()
  assert.equal(uploads,2);assert.equal(writes.length,0)
  await button('重试上传').click()
  await page.waitForFunction(()=>document.querySelectorAll('.mobile-media-uploader__progress').length===0)
  assert.equal(uploads,3,'successful media is not uploaded twice')
  await button('上报').click()
  await page.locator('.error[role="alert"]').filter({hasText:'服务暂时不可用'}).waitFor()
  assert.equal(writes.length,1)
  await button('上报').click()
  await visible('到官方渠道完成上报')
  const agencies=page.getByRole('dialog',{name:'选择举报机构',exact:true})
  await agencies.getByRole('button',{name:/中国渔政举报受理平台.*010-59191110/}).waitFor()
  await agencies.getByRole('button',{name:/阳新县涉渔举报.*0714-3503111/}).waitFor()
  await agencies.getByRole('button',{name:'关闭机构选择',exact:true}).click()
  await agencies.waitFor({state:'hidden'})
  assert.equal(uploads,3)
  assert.deepEqual(writes[0].payload,writes[1].payload)
  assert.equal(record.media.length,2)
  pass('single attachment and private-save retries retain material, preserve upload results and never claim official delivery')
  await button('举报联系方式').click()
  await button('拨打阳新县涉渔举报').waitFor()
  assert.ok(await button('拨打阳新县涉渔举报').isVisible())
  assert.equal(await button('拨打大冶市涉渔举报').count(), 0)
  await page.setViewportSize({ width: 320, height: 812 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.evaluate(() => (document.documentElement.style.fontSize = '20px'))
  await overflow('private report and sourced channels / 320px dark large text')
  await screenshot('water-report-saved-dark-320.png')
  await button('拨打阳新县涉渔举报').click()
  await page.getByRole('dialog', { name: '打开拨号？' }).waitFor()
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), '取消')
  await button('取消').click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(writes.length, 2)
  pass(
    'exact county channel has an official source and dialing requires confirmation; no real call made'
  )
  await button('复制文字材料').click()
  await page.getByRole('dialog', { name: '复制私密材料？' }).waitFor()
  await screenshot('water-report-copy-confirm-dark-320.png', false)
  await button('取消').click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(writes.length, 2)
  pass('precise location copy has a separate cancel-first disclosure and no automatic forwarding')
  const reportId = record.id
  await go('/pages/water-report/history')
  await button('查看详情').waitFor()
  await button('删除材料').click()
  await button('取消').click()
  await page.getByRole('alertdialog', { name: '删除这份材料？' }).waitFor({ state: 'hidden' })
  assert.equal(deletions, 0)
  await button('删除材料').click()
  await page.getByRole('alertdialog', { name: '删除这份材料？' }).getByRole('button', { name: '删除材料', exact: true }).click()
  await visible('还没有保存的上报记录。')
  assert.equal(deletions, 1)
  pass('private history deletion has an explicit consequence and respects cancellation')
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.emulateMedia({ colorScheme: 'light' })
  await button('记录水域线索').click()
  await fill('现场情况', '账号A尚未上传的私人线索')
  await overflow('report editor / wide light')
  await screenshot('water-report-editor-wide.png')
  const otherPage = await context.newPage()
  await otherPage.goto(base)
  await otherPage.evaluate((other) => {
    const key = 'dyj.auth.v1',
      value = JSON.parse(localStorage.getItem(key))
    value.data.access_token = 'report-B'
    value.data.refresh_token = 'fixture-refresh-B'
    value.data.user.id = other
    localStorage.setItem(key, JSON.stringify(value))
  }, other)
  await page.waitForFunction(
    () => document.querySelector('textarea[aria-label="现场情况"]')?.value === ''
  )
  await go(`/pages/water-report/index?id=${reportId}`)
  await visible('内容不存在或你暂时无权查看')
  await otherPage.close()
  pass(
    'account switch clears report inputs; another account cannot open the previous private material'
  )
  assert.deepEqual(escaped, [])
}
