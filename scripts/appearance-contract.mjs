import assert from 'node:assert/strict'

export async function appearanceContract({ page, go, visible, pass, overflow, screenshot }) {
  const skins = [
    { id: 'lake', name: '湖畔青', light: 'rgb(15, 107, 91)', dark: 'rgb(121, 206, 184)' },
    { id: 'ocean', name: '日出橙', light: 'rgb(193, 75, 19)', dark: 'rgb(255, 171, 112)' },
    { id: 'stone', name: '莓果红', light: 'rgb(198, 41, 89)', dark: 'rgb(255, 151, 181)' }
  ]
  await page.setViewportSize({ width: 440, height: 956 })
  await go('/pages/settings/index')
  await visible('主题皮肤')
  assert.equal(
    await page.locator('#service-status').count(),
    0,
    'technical status is absent from user settings'
  )
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme })
    for (const skin of skins) {
      await page.getByRole('button', { name: skin.name, exact: true }).click()
      assert.equal(
        await page
          .getByRole('button', { name: skin.name, exact: true })
          .getAttribute('aria-pressed'),
        'true'
      )
      await page.waitForFunction(
        ({ id, expected }) => {
          const shell = document.querySelector(`.fishing-skin-${id}`)
          return (
            shell &&
            getComputedStyle(shell.querySelector('.skin-choice--selected')).borderTopColor ===
              expected
          )
        },
        { id: skin.id, expected: skin[scheme] }
      )
      await screenshot(`skin-${skin.id}-${scheme}-440.png`)
    }
  }
  pass('all 3 skins have distinct live light/dark palettes and announced selection')
  await page.reload()
  await visible('主题皮肤')
  assert.equal(
    await page.getByRole('button', { name: '莓果红', exact: true }).getAttribute('aria-pressed'),
    'true'
  )
  await go('/pages/post/compose')
  await page.getByRole('button', { name: '分享范围', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '分享范围', exact: true })
  await dialog.waitFor({ state: 'visible' })
  assert.equal(
    await dialog.evaluate((el) =>
      getComputedStyle(el.closest('.wd-root-portal')).getPropertyValue('--lake').trim()
    ),
    '#FF97B5'
  )
  await page.getByRole('button', { name: '关闭选择', exact: true }).click()
  pass('skin survives reload/navigation and follows shared picker root portals')
  await go('/pages/settings/index')
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    window.__restoreAppearanceStorage = () => {
      Storage.prototype.setItem = original
    }
    Storage.prototype.setItem = function (key, value) {
      if (key.includes('dyj.appearance.skin'))
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      return original.call(this, key, value)
    }
  })
  await page.getByRole('button', { name: '日出橙', exact: true }).click()
  await visible('皮肤已应用，但未保存。')
  await page.evaluate(() => window.__restoreAppearanceStorage())
  await page.getByRole('button', { name: '重试保存', exact: true }).click()
  assert.equal(await page.getByText('皮肤已应用，但未保存。', { exact: true }).count(), 0)
  await page.reload()
  assert.equal(
    await page.getByRole('button', { name: '日出橙', exact: true }).getAttribute('aria-pressed'),
    'true'
  )
  pass('failed skin persistence is visible and retry actually survives reload')
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  for (const [width, height] of [
    [320, 812],
    [375, 812],
    [768, 450],
    [1024, 768]
  ]) {
    await page.setViewportSize({ width, height })
    await overflow(`appearance ${width}x${height}`)
    const boxes = await page.locator('.skin-choice').evaluateAll((elements) =>
      elements.map((el) => ({
        w: el.getBoundingClientRect().width,
        h: el.getBoundingClientRect().height
      }))
    )
    assert.ok(boxes.every((box) => box.w >= 44 && box.h >= 44))
  }
  await page.setViewportSize({ width: 320, height: 812 })
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '24px'
  })
  await overflow('appearance 150% type at 320px')
  await screenshot('skin-ocean-large-text-320.png')
  await page.evaluate(() => {
    document.documentElement.style.fontSize = ''
  })
  assert.equal(await page.getByRole('button', { name: '接入状态', exact: true }).count(), 0)
  assert.doesNotMatch(
    await page.locator('uni-page').last().innerText(),
    /Supabase|公开\s*Key|接入状态|数据环境|原生 SDK|开发预览/
  )
  await visible('联系与反馈')
  pass('user settings contain no developer status or configuration diagnostics')
  await page.getByRole('button', { name: '湖畔青', exact: true }).click()
  await page.setViewportSize({ width: 375, height: 812 })
}
