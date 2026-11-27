import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pageManifest } from './miniapp-package.mjs'
import { setH5TextScale } from './h5-text-scale.mjs'

// This is a compiled H5 routing + system-font fallback check. It is NOT a
// WeChat renderer/device test and cannot certify Mini Program font metrics.
export async function packageRoutesContract({ page, go, overflow, pass, screenshot }) {
  const routes = pageManifest(JSON.parse(readFileSync('src/pages.json', 'utf8'))).routes
  const mpStyles = readFileSync('dist/build/mp-weixin/app.wxss', 'utf8')
  const systemStack = mpStyles.match(/--tms-font-family:([^;]+);/)?.[1]
  assert.ok(systemStack?.includes('-apple-system'), 'build the current mini program first')
  assert.ok(!systemStack.includes('TMS Sans SC'))
  const samples = new Set([
    'pages/home/index',
    'pages/map/search',
    'pages/post/compose',
    'pages/notifications/index',
    'pages/settings/index'
  ])
  async function singleLineTitle(expected) {
    const title = page.locator('.fishing-shell-title').last()
    assert.equal(await title.innerText(), expected)
    const metrics = await title.evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      size: parseFloat(getComputedStyle(el).fontSize)
    }))
    assert.ok(metrics.height < metrics.size * 2, 'short map title has no orphan line at large type')
  }
  for (const route of routes) {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.emulateMedia({ colorScheme: 'light' })
    await go(`/${route}`)
    await page.reload()
    const expected =
      {
        'pages/map/bridge': 'pages/map/index',
        'pages/spot/discover': 'pages/home/index',
        'pages/water-report/history': 'pages/water-report/index'
      }[route] || route
    await page.waitForFunction((path) => {
      const pages = [...document.querySelectorAll('uni-page')]
      return pages.at(-1)?.getAttribute('data-page') === path
    }, expected)
    await page.locator('.fishing-page').last().waitFor({ state: 'visible' })
    await page.addStyleTag({
      // Uni rewrites the page selector to uni-page-body in H5. Override that
      // scope too; changing only :root would leave its child variable intact.
      content: `:root,page,uni-page-body,.wd-root-portal{--tms-font-family:${systemStack}!important}`
    })
    await setH5TextScale(page, 16)
    await overflow(`package route ${route} system font 375`)
    const family = await page
      .locator('.fishing-page')
      .last()
      .evaluate((el) => getComputedStyle(el).fontFamily)
    assert.ok(!family.includes('TMS Sans SC'), 'fallback must be actually applied')
    if (samples.has(route)) await screenshot(`system-font-${route.replaceAll('/', '-')}-375.png`)
    await page.setViewportSize({ width: 320, height: 812 })
    await page.emulateMedia({ colorScheme: 'dark' })
    await setH5TextScale(page, 24)
    await overflow(`package route ${route} system font dark 320 large text`)
    if (expected === 'pages/map/search') await singleLineTitle('地点搜索')
    if (samples.has(route))
      await screenshot(`system-font-${route.replaceAll('/', '-')}-dark-320.png`)
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.documentElement).fontSize),
      '24px'
    )
  }
  pass(
    `all ${routes.length} original page URLs boot with route-level splitting; bridge opens the interactive map`
  )
  await go('/pages/map/search?pick=1&requestId=package-routing-only')
  await page.reload()
  await page.addStyleTag({
    content: `:root,page,uni-page-body,.wd-root-portal{--tms-font-family:${systemStack}!important}`
  })
  await setH5TextScale(page, 24)
  await singleLineTitle('选择地点')
  await screenshot('system-font-map-pick-dark-320.png')
  pass(
    'search and place-selection titles remain one line at 320px with 150 percent system-font text'
  )
}
