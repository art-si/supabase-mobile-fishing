import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setH5TextScale } from './h5-text-scale.mjs'

const home = '/pages/home/index'
const post = '/pages/post/detail?id=a1111111-1111-4111-8111-111111111111'
const reportTab = '/pages/water-report/index?tabbed=1'
const settings = '/pages/settings/index'

const variants = [
  home + '?tab=spots',
  reportTab,
  home + '?tab=mine',
  '/pages/post/compose?mode=trip',
  '/pages/settings/legal?type=terms',
  '/pages/mine/library?type=saved',
  '/pages/map/search?pick=1&requestId=visual-audit'
]

const samples = {
  '/pages/post/detail': post,
  '/pages/spot/detail': '/pages/spot/detail?id=b1111111-1111-4111-8111-111111111111',
  '/pages/people/detail': '/pages/people/detail?id=22222222-2222-4222-8222-222222222222',
  '/pages/moderation/detail':
    '/pages/moderation/detail?type=post&id=a1111111-1111-4111-8111-111111111111'
}

const redirects = {
  '/pages/map/bridge': '/pages/map/search',
  '/pages/spot/discover': home,
  '/pages/water-report/history': '/pages/water-report/index'
}

const viewports = [
  ['375', 375, 812, 'light', 16],
  ['320-dark-150', 320, 740, 'dark', 24],
  ['440', 440, 956, 'light', 16],
  ['landscape', 844, 390, 'light', 16],
  ['wide', 1280, 900, 'light', 16],
  ['320-dark-200', 320, 740, 'dark', 32]
]

function placeholderContrast(placeholder, field) {
  return placeholder.evaluate((el, surface) => {
    const luminance = (color) =>
      color
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map((component) => Number(component) / 255)
        .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
        .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0)
    const fg = luminance(getComputedStyle(el).color)
    const bg = luminance(getComputedStyle(el.closest(surface)).backgroundColor)
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)
  }, field)
}

// Isolated demo build. A redirect is checked by its destination and never counted as a new page state.
export async function visualAudit({ page, go, visible, overflow, screenshot, pass }) {
  const manifest = JSON.parse(readFileSync('src/pages.json', 'utf8'))
  const routes = [
    ...manifest.pages.map(({ path }) => '/' + path),
    ...manifest.subPackages.flatMap(({ root, pages }) =>
      pages.map(({ path }) => '/' + root + '/' + path)
    )
  ]
  const expanded = new Set([
    home,
    ...variants.slice(0, 3),
    settings,
    '/pages/post/compose',
    '/pages/spot/create',
    '/pages/map/index',
    '/pages/water-report/index',
    '/pages/account/password'
  ])

  async function setView([, width, height, colorScheme, text]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme })
    await setH5TextScale(page, text)
  }

  for (const route of [...routes, ...variants]) {
    await setView(viewports[0])
    await go(samples[route] ?? route)
    await page.reload()
    const path = route.split('?')[0]
    const expected = (redirects[path] ?? path).slice(1)
    await page.waitForFunction(
      (value) =>
        [...document.querySelectorAll('uni-page')].at(-1)?.getAttribute('data-page') === value,
      expected
    )
    await page.locator('uni-page').last().locator('.fishing-page').waitFor()
    for (const viewport of expanded.has(route) ? viewports : viewports.slice(0, 2)) {
      await setView(viewport)
      const name = route.slice(1).replace(/[^a-z\d-]+/gi, '-')
      await overflow('visual ' + name + ' ' + viewport[0])
      await screenshot('visual-' + name + '-' + viewport[0] + '.png', viewport[0] !== 'landscape')
    }
  }

  await setView(viewports[0])
  for (const skin of ['湖畔青', '深海蓝', '岩石灰']) {
    await go(settings)
    await page.getByRole('button', { name: skin, exact: true }).click()
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme })
      await go(home)
      const search = page.locator('.mobile-search__placeholder').first()
      assert.ok((await placeholderContrast(search, '.mobile-search')) >= 4.5, skin + ' search')
      await go('/pages/post/compose')
      const body = page.locator('.mobile-field__control--textarea .mobile-field__placeholder').first()
      assert.ok((await placeholderContrast(body, '.mobile-field__control')) >= 4.5, skin + ' composer')
      pass(skin + ' ' + colorScheme + ' placeholders meet 4.5:1')
    }
  }

  await setView(['short', 375, 480, 'light', 16])
  await go(home)
  // Start the tab flow from a mounted home route after the palette page visits.
  await page.reload()
  await page.locator('.fishing-page').waitFor()
  const following = page.getByRole('button', { name: '关注', exact: true })
  await following.click()
  const nav = page.getByRole('navigation', { name: '主导航' })
  await nav.getByRole('link', { name: '我的', exact: true }).click()
  await nav.getByRole('link', { name: '钓友圈', exact: true }).click()
  assert.equal(await following.getAttribute('aria-pressed'), 'true')
  await page.getByRole('button', { name: '推荐', exact: true }).click()
  await visible('秋天的鲫鱼，藏在这片芦苇边')
  const before = await page.evaluate(async () => {
    window.scrollTo(0, 240)
    await new Promise((done) => requestAnimationFrame(done))
    return window.scrollY
  })
  assert.ok(before > 0)
  await nav.getByRole('link', { name: '找钓位', exact: true }).click()
  await nav.getByRole('link', { name: '钓友圈', exact: true }).click()
  await page.waitForFunction((value) => Math.abs(window.scrollY - value) < 3, before)

  await nav.getByRole('link', { name: '举报', exact: true }).click()
  await page.waitForURL((url) => url.hash === '#' + reportTab)
  await nav.getByRole('link', { name: '举报', exact: true })
    .and(page.locator('[aria-current="page"]')).waitFor()
  await nav.getByRole('link', { name: '钓友圈', exact: true }).click()
  await nav.getByRole('link', { name: '钓友圈', exact: true })
    .and(page.locator('[aria-current="page"]')).waitFor()
  try {
    await page.waitForFunction((value) => Math.abs(window.scrollY - value) < 3, before)
  } catch (error) {
    const current = await page.evaluate(() => window.scrollY)
    throw new Error(`Returning from reports restored scroll ${current}; expected ${before}`, { cause: error })
  }
  await following.click()
  await nav.getByRole('link', { name: '举报', exact: true }).click()
  await page.waitForURL((url) => url.hash === '#' + reportTab)
  await nav.getByRole('link', { name: '我的', exact: true }).click()
  await nav.getByRole('link', { name: '我的', exact: true })
    .and(page.locator('[aria-current="page"]')).waitFor()
  await nav.getByRole('link', { name: '钓友圈', exact: true }).click()
  assert.equal(await following.getAttribute('aria-pressed'), 'true')
  pass('top-level navigation restores the selected filter and scroll position')

  await go(post)
  const comment = page.getByRole('button', { name: /^查看评论：/ })
  await comment.scrollIntoViewIfNeeded()
  await page.evaluate(() => {
    window.__commentScroll = []
    function record() {
      window.__commentScroll.push(window.scrollY)
      if (window.__commentScroll.length < 25) requestAnimationFrame(record)
    }
    requestAnimationFrame(record)
  })
  await comment.click()
  await page.waitForFunction(() => document.activeElement?.id === 'comments-heading')
  await page.waitForFunction(() => window.__commentScroll?.length === 25)
  assert.ok(await page.evaluate(() => new Set(window.__commentScroll).size <= 2))
  await screenshot('visual-comment-focus-reduced-motion.png', false)
  pass('reduced motion jumps directly to the comment heading and focuses it')

  await setView(viewports[1])
  await go(settings)
  const email = page.getByRole('button', { name: /我的邮箱资料/ })
  await email.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: '我的邮箱资料' })
  await dialog.waitFor()
  await dialog.locator('#report-email-name-input').waitFor()
  await page.waitForFunction(() => document.activeElement?.id === 'report-email-name-input')
  await screenshot('visual-email-overlay-dark-320.png', false)
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert.ok(await email.evaluate((el) => el === document.activeElement))
  pass('small dark overlay keeps keyboard focus and returns it on Escape')

  await go('/pages/content-report/detail')
  await visible('缺少举报编号')
  await page.getByRole('button', { name: '返回举报列表', exact: true }).click()
  await page.waitForURL((url) => url.hash === '#/pages/content-report/index?review=1')
  await go('/pages/map/index')
  await page.getByRole('button', { name: '浏览示例钓位', exact: true }).click()
  await page.getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '找钓位', exact: true })
    .and(page.locator('[aria-current="page"]'))
    .waitFor()
  await visible('芦苇湾 · 示例水域')
  pass('missing report and offline map states provide a working next action')
}
