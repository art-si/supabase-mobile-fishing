import assert from 'node:assert/strict'
import { setH5TextScale } from './h5-text-scale.mjs'

// H5 regression for the controls adapted to WeChat style isolation. Native
// screenshots are reviewed separately; the local API sandbox never contacts production.
export async function miniappAlignmentContract({ page, go, screenshot, pass }) {
  await go('/pages/home/index')
  await page.getByRole('heading', { name: '钓友集', exact: true }).waitFor()
  const cases = [
    ['feed', '/pages/home/index', '.post-content'],
    ['mine', '/pages/home/index?tab=mine', '.mine-profile'],
    ['settings', '/pages/settings/index', '.skin-choice'],
    ['compose', '/pages/post/compose', '.compose-submit'],
    ['post', '/pages/post/detail?id=a1111111-1111-4111-8111-111111111111', '.fishing-place-link'],
    ['report', '/pages/water-report/index?tabbed=1', '#report-region']
  ]
  for (const [name, route, ready] of cases) {
    await go(route)
    await page.reload()
    await page.locator(ready).first().waitFor()
    for (const [mode, width, height, dark, scale] of [
      ['375', 375, 812, false, 16], ['320', 320, 740, false, 16],
      ['440', 440, 956, false, 16], ['landscape', 844, 390, false, 16],
      ['wide', 1280, 900, false, 16], ['dark-large', 320, 812, true, 24]
    ]) {
      await page.setViewportSize({ width, height })
      await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
      await setH5TextScale(page, scale)
      await page.evaluate(() => document.fonts.ready)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}/${mode}: no horizontal overflow`)
      const pairs = await page.locator('.fishing-place-link, .skin-choice__state, .mine-profile__edit').evaluateAll(nodes => nodes.map(node => {
        const icon = node.querySelector('.mobile-icon')?.getBoundingClientRect()
        const label = node.querySelector('uni-text')?.getBoundingClientRect()
        return icon && label ? Math.abs((icon.top + icon.bottom - label.top - label.bottom) / 2) : 0
      }))
      assert.ok(pairs.every(delta => delta <= 1), `${name}/${mode}: icon boxes and label line boxes share their vertical center`)
      await screenshot(`alignment-${name}-${mode}.png`)
      pass(`alignment ${name} ${mode}`)
    }
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ colorScheme: 'light' })
  await setH5TextScale(page, 16)
  await go('/pages/settings/index')
  const skin = page.getByRole('button', { name: '日出橙', exact: true })
  await skin.focus()
  assert.ok(await skin.evaluate(node => getComputedStyle(node).outlineStyle !== 'none'))
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('.skin-choice[aria-label="日出橙"]')?.getAttribute('aria-pressed') === 'true')
  await screenshot('alignment-settings-focus.png')
  await page.getByRole('button', { name: '湖畔青', exact: true }).click()
  await go('/pages/home/index')
  const place = page.getByRole('button', { name: '在地图中查看：苏州 · 大致水域', exact: true }).first()
  await place.click()
  await page.getByRole('dialog', { name: '在地图中查看', exact: true }).waitFor()
  const copy = page.getByRole('button', { name: '复制地点', exact: true })
  assert.ok(await copy.evaluate(node => {
    const rect = node.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return node === hit || node.contains(hit)
  }), 'bottom navigation must not cover the map sheet copy action')
  await screenshot('alignment-map-sheet.png', false)
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: '在地图中查看', exact: true }).waitFor({ state: 'hidden' })
  assert.ok(await place.evaluate(node => document.activeElement === node), 'map sheet restores focus to its place row')
  pass('skin keyboard selection, visible focus and map sheet focus recovery')
}
