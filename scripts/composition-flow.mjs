import assert from 'node:assert/strict'
import { setH5TextScale } from './h5-text-scale.mjs'
import { catchMeasurementsFlow } from './catch-measurements-flow.mjs'

// Same flow against isolated PostgreSQL HTTP and real temporary hosted accounts.
export async function compositionFlow({
  page,
  data,
  project,
  button,
  field,
  go,
  replyFor,
  shot,
  check,
  setPhase
}) {
  // Coordinates below are explicit test data, not a device/provider-location claim.
  const originalGo = go
  go = async (tab, route) => {
    if (route === '/pages/post/compose') await tab.evaluate(() => {
      const auth = JSON.parse(localStorage.getItem('dyj.auth.v1') || 'null')?.data
      if (!auth?.user?.id) return
      const key = 'dyj.live.draft.' + auth.user.id + '.post'
      let draft = JSON.parse(localStorage.getItem(key) || 'null')?.data
      if (!draft?.id) draft = { id: crypto.randomUUID(), title:'',body:'',kind:'catch',species:'',method:'台钓',bait:'',additives:'',weight:'',weight_unit:'kg',count:'',length:'',occurred_on:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),occurred_time:'08:00',audience:'private',media:[] }
      if (!draft.location_label || draft.location_longitude == null) Object.assign(draft,{location_label:'接口验收测试水域',location_longitude:120.62,location_latitude:31.32})
      localStorage.setItem(key,JSON.stringify({type:'object',data:draft}))
    })
    return originalGo(tab, route)
  }
  const compose = '/pages/post/compose'
  setPhase('composition-start')
  const initial = replyFor(page, 'library')
  await go(page, '/pages/mine/library?type=posts')
  const first = await initial
  assert.equal(first.status(), 200, first.status() === 200 ? undefined : (await first.json()).message)
  const key = (await first.request().allHeaders()).apikey
  const actor = data.accounts.find((x) => x.label === 'a')
  async function rpc(action, payload = {}, label = 'a') {
    return page.evaluate(
      async ({ url, key, token, action, payload }) => {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            apikey: key,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ action, payload }),
          signal: AbortSignal.timeout(20000)
        })
        return { status: response.status, json: await response.json() }
      },
      {
        url: `${project}/rest/v1/rpc/fishing_read`,
        key,
        token: data.accounts.find((x) => x.label === label).session.access_token,
        action,
        payload
      }
    )
  }
  const snapshot = async (type, id) => {
    const response = await rpc('edit_content', { type, id })
    assert.equal(response.status, 200)
    return response.json
  }
  const photoSources = () =>
    page
      .locator('.mobile-media-uploader__image')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('src')))
  const upload = async () => {
    const response = page.waitForResponse(
      (r) => r.url() === `${project}/functions/v1/media-upload` && r.request().method() === 'POST'
    )
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '添加图片 / 视频' }).click()
    await (
      await chooser
    ).setFiles({
      name: 'synthetic-composition.png',
      mimeType: 'image/png',
      buffer: Buffer.from(data.photo, 'base64')
    })
    const result = await response
    assert.equal(result.status(), 200)
    const asset = await result.json()
    await button(page, '保存并发布').waitFor()
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll('[role="status"]')].some((n) => n.textContent === '上传中…')
    )
    return asset
  }
  const closeSort = async () => {
    await page.keyboard.press('Escape')
    await page.getByRole('dialog', { name: '附件顺序' }).waitFor({ state: 'hidden' })
  }
  const sortReady = async () => {
    await page.getByRole('dialog', { name: '附件顺序' }).waitFor()
    // Wait for the shared popup's finite entrance transition before measuring/capturing it.
    await page.waitForTimeout(350)
    check(
      await page.getByRole('dialog', { name: '附件顺序' }).evaluate((n) => {
        const b = n.getBoundingClientRect()
        return b.top >= -1 && b.bottom <= innerHeight + 1 && b.height > 100
      }),
      'Photo ordering sheet is actually inside the visible viewport'
    )
  }
  const fits = async (label) =>
    check(
      await page.evaluate(
        () =>
          Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) <=
          innerWidth + 1
      ),
      label
    )
  await go(page, compose)
  await button(page, '保存并发布').click()
  await page.locator('#compose-errors').waitFor()
  check(
    (await page.locator('#compose-errors').innerText()).includes('写一点鱼情或添加照片'),
    'Empty post asks for text or photos instead of a title'
  )
  check(
    await page.locator('#compose-errors').evaluate((n) => n === document.activeElement),
    'Empty post focuses the linked error summary'
  )
  await field(page, '今天的渔获').fill('水边观察：只写正文也能记录。')
  await page.locator('#compose-errors').waitFor({ state: 'hidden' })
  await button(page, '鱼情详情').click()
  await field(page, '尾数').fill('0')
  await field(page, '鱼长（cm）').fill('38.5')
  await button(page, '总重量单位').click()
  await button(page, '斤').click()
  await field(page, '总重量（斤）').fill('2.4')
  const textSaved = replyFor(page, 'save_post')
  await button(page, '保存并发布').click()
  const textResponse = await textSaved,
    text = await textResponse.json()
  check(
    textResponse.status() === 200 && text.title === '' && text.media.length === 0,
    'Text-only post saves without an invented title'
  )
  await page.waitForURL(/#\/(?:pages\/home\/index)?\?tab=feed$/)
  await go(page, `/pages/post/detail?id=${text.id}`)
  await page.locator('.post-card').waitFor()
  check(
    (await page.locator('.post-card .heading').count()) === 0,
    'Untitled text detail does not duplicate body as a heading'
  )
  check(
    text.count === 0 && text.length_cm === 38.5 && text.weight_kg === 1.2,
    'New catch post persists zero tails cm and converted jin'
  )
  setPhase('catch-measurements')
  await catchMeasurementsFlow({
    page,
    button,
    field,
    replyFor,
    snapshot,
    check,
    shot,
    id: text.id,
    visual: !data.run
  })
  await go(page, '/pages/mine/library?type=posts')
  await button(page, `阅读全文：${text.body}`).click()
  await page.waitForURL(`**/pages/post/detail?id=${text.id}`)
  check(true, 'Untitled text remains reachable from the library')

  setPhase('composition-photos')
  await go(page, compose)
  const assets = [await upload(), await upload(), await upload()]
  await button(page, '预览第 2 张图片').click()
  await page.locator('uni-swiper').waitFor()
  check(
    (await page.locator('uni-swiper-item').count()) === 3,
    'Draft photos open the platform preview with all selected photos'
  )
  await page.keyboard.press('Escape')
  await page.locator('uni-swiper').waitFor({ state: 'hidden' })
  const original = await photoSources()
  await button(page, '调整附件顺序').click()
  const sheet = page.getByRole('dialog', { name: '附件顺序' })
  await sheet.waitFor()
  check(
    (await button(page, '附件 1 前移').isDisabled()) &&
      (await button(page, '附件 3 后移').isDisabled()),
    'Photo ordering disables moves beyond list boundaries'
  )
  await button(page, '附件 3 前移').focus()
  await page.keyboard.press('Enter')
  await page.getByText('照片已从第 3 张移至第 2 张', { exact: true }).waitFor()
  check(
    (await photoSources()).join() === [original[0], original[2], original[1]].join(),
    'Keyboard photo movement preserves the intended image identity'
  )
  await closeSort()
  check(
    await button(page, '调整附件顺序').evaluate((n) => n === document.activeElement),
    'Closing photo ordering returns focus to its trigger'
  )
  await page.reload()
  await button(page, '调整附件顺序').waitFor()
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.mobile-media-uploader__image img')].length === 3 &&
      [...document.querySelectorAll('.mobile-media-uploader__image img')].every(
        (n) => n.complete && n.naturalWidth > 0
      )
  )
  check(true, 'Reload restores draft order and renews private photo URLs')
  const draftOrder = await page.evaluate(
    (owner) =>
      JSON.parse(localStorage.getItem(`dyj.live.draft.${owner}.post`)).data.media.map((m) => m.id),
    actor.session.user.id
  )
  assert.deepEqual(draftOrder, [assets[0].id, assets[2].id, assets[1].id])
  check(true, 'Draft storage records reordered asset IDs')
  if (!data.run) {
    await button(page, '调整附件顺序').click()
    await sortReady()
    await page.evaluate(() => {
      localStorage.removeItem('dyj.auth.v1')
      window.dispatchEvent(new StorageEvent('storage', { key: 'dyj.auth.v1', newValue: null }))
    })
    await sheet.waitFor({ state: 'hidden' })
    check(
      (await page.locator('.mobile-evidence__preview:visible,.mobile-media-uploader__sort:visible').count()) === 0,
      'Session loss immediately removes private photo controls and the sorting sheet'
    )
    await page.evaluate((session) => {
      const value = JSON.stringify({ type: 'object', data: session })
      localStorage.setItem('dyj.auth.v1', value)
      window.dispatchEvent(new StorageEvent('storage', { key: 'dyj.auth.v1', newValue: value }))
    }, actor.session)
    await button(page, '调整附件顺序').waitFor()
    await page.waitForFunction(() => document.querySelectorAll('.mobile-media-uploader__image img').length === 3)
    check(true, 'Restoring the same isolated session recovers its ordered draft')
  }

  setPhase('composition-responsive')
  for (const [width, height] of [
    [320, 812],
    [375, 812],
    [440, 956],
    [812, 375],
    [1280, 900]
  ]) {
    await page.setViewportSize({ width, height })
    await button(page, '调整附件顺序').click()
    await sortReady()
    await fits(`Photo ordering fits ${width} viewport`)
    const controls = await sheet.locator('[role="button"]:visible').evaluateAll((nodes) =>
      nodes.map((n) => {
        const b = n.getBoundingClientRect()
        return { width: b.width, height: b.height }
      })
    )
    check(
      controls.length === 7 && controls.every((b) => b.width >= 44 && b.height >= 44),
      `Photo ordering controls keep usable targets at ${width}`
    )
    await shot(`composition-order-${width}`, page, false)
    await closeSort()
  }
  await page.setViewportSize({ width: 320, height: 812 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await setH5TextScale(page, 24)
  await button(page, '调整附件顺序').click()
  await sortReady()
  await fits('Photo ordering fits dark 320 with enlarged text')
  await shot('composition-order-dark-large-320', page, false)
  await closeSort()
  await shot('composition-draft-dark-large-320')
  await setH5TextScale(page, 16)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ colorScheme: 'light' })
  for (const [skin, name] of [
    ['lake', '湖畔青'],
    ['ocean', '日出橙'],
    ['stone', '莓果红']
  ]) {
    await go(page, '/pages/settings/index')
    await button(page, name).click()
    await go(page, compose)
    await button(page, '调整附件顺序').waitFor()
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme })
      await button(page, '调整附件顺序').click()
      await sortReady()
      const colors = await sheet
        .getByRole('button', { name: '附件 1 前移', exact: true })
        .evaluate((n) => {
          const style = getComputedStyle(n)
          return { background: style.backgroundColor, foreground: style.color }
        })
      check(
        colors.background !== 'rgb(250, 250, 250)' && colors.background !== 'rgb(255, 255, 255)',
        `Ordering disabled surface follows ${skin} ${scheme}`
      )
      await shot(`composition-order-${skin}-${scheme}`, page, false)
      await closeSort()
    }
  }
  await go(page, '/pages/settings/index')
  await button(page, '湖畔青').click()
  await page.emulateMedia({ colorScheme: 'light' })
  await go(page, compose)
  await button(page, '调整附件顺序').waitFor()

  setPhase('composition-save-edit')
  const photoSaved = replyFor(page, 'save_post')
  await button(page, '保存并发布').click()
  const photoResponse = await photoSaved,
    photoPost = await photoResponse.json()
  check(
    photoResponse.status() === 200 && photoPost.title === '' && photoPost.body === '',
    'Photo-only post saves with both text fields empty'
  )
  assert.deepEqual(
    photoPost.media.map((m) => m.id),
    draftOrder
  )
  check(true, 'Persisted photo order matches the restored draft')
  await page.waitForURL(/#\/(?:pages\/home\/index)?\?tab=feed$/)
  await go(page, `/pages/post/detail?id=${photoPost.id}`)
  await button(page, '编辑这条鱼情').waitFor()
  await shot('composition-photo-only-375')
  check(
    (await rpc('post', { id: photoPost.id }, 'outsider')).status === 400,
    'Another account cannot read private photo-only content'
  )
  await button(page, '编辑这条鱼情').click()
  await button(page, '调整附件顺序').click()
  await button(page, '附件 1 后移').click()
  await closeSort()
  const edited = replyFor(page, 'update_content')
  await button(page, '保存修改').click()
  check(
    (await edited).status() === 200,
    'Reordered author edit reaches the existing revision-checked API'
  )
  const editedPost = await snapshot('post', photoPost.id)
  assert.deepEqual(
    editedPost.item.media.map((m) => m.id),
    [assets[2].id, assets[0].id, assets[1].id]
  )
  check(true, 'Reading the edited post recovers its new photo order')
  await button(page, '编辑这条鱼情').click()
  for (let i = 0; i < 3; i++) await button(page, '移除第 1 张图片').click()
  await button(page, '保存修改').click()
  await page.locator('#compose-errors').waitFor()
  check(
    (await snapshot('post', photoPost.id)).revision === editedPost.revision,
    'Removing every photo from an empty-text post never submits an empty edit'
  )
  await field(page, '今天的渔获').fill('照片移除后保留文字。')
  const changed = replyFor(page, 'update_content')
  await button(page, '保存修改').click()
  check(
    (await changed).status() === 200 &&
      (await snapshot('post', photoPost.id)).item.media.length === 0,
    'Photo-only post can be changed to text-only without leftover public media'
  )
  await page.waitForURL(`**/pages/post/detail?id=${photoPost.id}`)
  await button(page, '编辑这条鱼情').waitFor()

  setPhase('composition-trip')
  await go(page, '/pages/home/index?tab=mine')
  await button(page, '记一次出钓').click()
  await page.waitForURL('**/pages/post/compose?mode=trip')
  await button(page, '保存私人日志').click()
  await page.getByText('给这次记录起个名字', { exact: true }).first().waitFor()
  await field(page, '标题').fill('先记日期和标题的私人日志')
  const logSaved = replyFor(page, 'save_trip')
  await button(page, '保存私人日志').click()
  const logResponse = await logSaved,
    log = await logResponse.json()
  check(
    logResponse.status() === 200 && (await snapshot('trip', log.id)).item.body === '',
    'Private log keeps title and date requirements but allows no description'
  )
}
