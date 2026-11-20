import assert from 'node:assert/strict'
import { setH5TextScale } from './h5-text-scale.mjs'

// Run after the demo workflow signs in. These are actual routed app screens,
// not mockups, and do not imply WeChat/native device or hosted service verification.
export async function visualAudit({ page, go, visible, overflow, screenshot, pass }) {
  const cases = [
    ['feed', '/pages/home/index', '秋天的鲫鱼，藏在这片芦苇边'],
    ['spots', '/pages/home/index?tab=spots', '收藏好钓位，下次接着钓。'],
    ['messages', '/pages/home/index?tab=messages', '好友申请'],
    ['mine', '/pages/home/index?tab=mine', '我的出钓日志'],
    ['post', '/pages/post/detail?id=a1111111-1111-4111-8111-111111111111', '鱼情详情'],
    ['spot', '/pages/spot/detail?id=b1111111-1111-4111-8111-111111111111', '钓位详情'],
    ['compose', '/pages/post/compose', '保存并发布'],
    ['trip', '/pages/post/compose?mode=trip', '保存私人日志'],
    ['spot-create', '/pages/spot/create', '保存钓位'],
    ['water-report', '/pages/water-report/index', '私密保存，选择官方渠道'],
    ['water-report-history', '/pages/water-report/history', '记录新的水域线索'],
    ['people', '/pages/people/index', '认识钓友'],
    ['person', '/pages/people/detail?id=22222222-2222-4222-8222-222222222222', '钓友主页'],
    ['profile', '/pages/mine/profile', '编辑资料'],
    ['saved', '/pages/mine/library?type=saved', '我的收藏'],
    ['trips', '/pages/mine/library?type=trips', '出钓日志'],
    ['settings', '/pages/settings/index', '主题皮肤'],
    ['privacy', '/pages/settings/legal?type=privacy', '隐私说明'],
    ['terms', '/pages/settings/legal?type=terms', '用户协议'],
    ['login', '/pages/login/index', '进入本机体验'],
    ['map-error', '/pages/map/index', '地图暂不可用'],
    ['map-search', '/pages/map/search', '先找到那片水']
  ]
  for (const [name, route, expected] of cases) {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.emulateMedia({ colorScheme: 'light' })
    await go(route)
    // These independent URL-entry screenshots aren't same-component query navigation tests.
    // Reload runs each page's Uni onLoad just as an externally opened deep link does.
    await page.reload()
    await visible(expected)
    await setH5TextScale(page, 16)
    if (name === 'water-report') {
      await visible('本机体验 · 材料只保存在本机，不上传云端、不联系官方。')
      await page.getByRole('button', { name: '先查看官方举报渠道', exact: true }).click()
      assert.equal(
        await page
          .getByRole('button', { name: '拨打中国渔政举报受理平台', exact: true })
          .isDisabled(),
        true
      )
      await page.getByRole('button', { name: '收起官方渠道', exact: true }).click()
      pass('demo report is explicitly local and cannot dial a real reporting agency')
    }
    if (name === 'map-error') {
      assert.equal(await page.locator('#amap-canvas').isVisible(), false)
      assert.equal(await page.getByRole('button', { name: '定位到附近', exact: true }).count(), 0)
      assert.ok(await page.getByRole('button', { name: '改用地点搜索与静态预览' }).isVisible())
    }
    await screenshot(`audit-${name}-375.png`)
    await page.setViewportSize({ width: 320, height: 812 })
    await page.emulateMedia({ colorScheme: 'dark' })
    await setH5TextScale(page, 24)
    if (name === 'messages') {
      assert.equal(
        await page.getByRole('button', { name: '找钓友', exact: true }).evaluate((el) => {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT),
            rows = new Set()
          while (walker.nextNode()) {
            if (!walker.currentNode.textContent.trim()) continue
            const range = document.createRange()
            range.selectNodeContents(walker.currentNode)
            for (const rect of range.getClientRects()) rows.add(Math.round(rect.y))
          }
          return rows.size
        }),
        1,
        'find-friends label stays on one readable line at 150%'
      )
    }
    if (name === 'profile' || name === 'water-report') {
      assert.ok(
        await page
          .locator('.top-bar__title')
          .evaluate(
            (el) =>
              el.getBoundingClientRect().height < parseFloat(getComputedStyle(el).fontSize) * 2
          ),
        'shortened page title has no orphan line'
      )
    }
    await overflow(`audit ${name} dark 320`)
    await screenshot(`audit-${name}-dark-320.png`)
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.documentElement).fontSize),
      '24px'
    )
  }
  await go('/pages/settings/index')
  await page.getByRole('button', { name: '湖畔青', exact: true }).focus()
  await page.keyboard.press('Tab')
  const focused = page.getByRole('button', { name: '深海蓝', exact: true })
  assert.ok(await focused.evaluate((el) => document.activeElement === el))
  assert.ok(await focused.evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth) >= 2))
  pass('skin keyboard order and visible focus verified')
  await page.keyboard.press('Enter')
  assert.equal(await focused.getAttribute('aria-pressed'), 'true')
  pass('skin selection works with keyboard, not just pointer')
}
