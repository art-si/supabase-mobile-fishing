import assert from 'node:assert/strict'

async function checkColors(dialog) {
  const pairs = await dialog.evaluate((panel) => {
    const bg = getComputedStyle(panel).backgroundColor
    return [
      ...panel.querySelectorAll('button,.mobile-confirm__title,.mobile-confirm__message')
    ].map((el) => {
      const style = getComputedStyle(el)
      return [style.color, el.matches('button') ? style.backgroundColor : bg]
    })
  })
  const luminance = (rgb) =>
    rgb
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map((x) => Number(x) / 255)
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
      .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0)
  for (const [fg, bg] of pairs) {
    const values = [luminance(fg), luminance(bg)].sort((a, b) => b - a)
    assert.ok(
      (values[0] + 0.05) / (values[1] + 0.05) >= 4.5,
      `confirmation contrast: ${fg} on ${bg}`
    )
  }
}

export async function confirmationContract({ page, go, visible, pass, screenshot }) {
  await page.setViewportSize({ width: 320, height: 812 })
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme })
    for (const [skin, name] of [
      ['lake', '湖畔青'],
      ['ocean', '日出橙'],
      ['stone', '莓果红']
    ]) {
      await go('/pages/settings/index')
      await page.getByRole('button', { name, exact: true }).click()
      await go('/pages/people/detail?id=22222222-2222-4222-8222-222222222222')
      const trigger = page.getByRole('button', { name: '拉黑这位钓友', exact: true })
      await trigger.click()
      const dialog = page.getByRole('alertdialog', { name: '拉黑这位钓友？', exact: true })
      await dialog.waitFor()
      await checkColors(dialog)
      await page.waitForFunction(() =>
        document.activeElement?.classList.contains('mobile-confirm__cancel')
      )
      await screenshot(`confirm-${skin}-${scheme}-320.png`)
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      assert.ok(await trigger.evaluate((node) => node === document.activeElement))
      assert.equal(await page.getByRole('button', { name: '关注鱼情', exact: true }).isEnabled(), true)
      pass(
        `${skin} ${scheme} destructive confirmation: readable, cancel-first focus and Escape restores the trigger`
      )
    }
  }
  await page.getByRole('button', { name: '关注鱼情', exact: true }).click()
  await page.getByRole('button', { name: '已关注', exact: true }).waitFor()
  await page.getByRole('button', { name: '拉黑这位钓友', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '拉黑', exact: true }).click()
  await page.getByRole('button', { name: '解除拉黑', exact: true }).click()
  const unblocking = page.getByRole('dialog', { name: '解除拉黑？', exact: true })
  await checkColors(unblocking)
  await screenshot('confirm-unblock-dark-320.png')
  await unblocking.getByRole('button', { name: '解除', exact: true }).click()
  await page.getByRole('button', { name: '拉黑这位钓友', exact: true }).waitFor()
  const follow = page.getByRole('button', { name: '关注鱼情', exact: true })
  assert.equal(await follow.getAttribute('aria-pressed'), 'false')
  pass('block/unblock confirms explicitly and unblocking leaves follow turned off')

  await go('/pages/mine/library?type=trips')
  const copy = page.locator('.panel').filter({ hasText: '用于确认删除的出钓日志' })
  await copy.click({ button: 'right', position: { x: 24, y: 24 } })
  const deletion = page.getByRole('alertdialog', { name: '删除这条日志？', exact: true })
  await deletion.getByRole('button', { name: '保留日志', exact: true }).click()
  await deletion.waitFor({ state: 'hidden' })
  // A long press keeps a 500ms release-click guard; start a fresh gesture after it.
  await page.waitForTimeout(550)
  assert.ok(await copy.isVisible())
  await copy.click({ button: 'right', position: { x: 24, y: 24 } })
  await deletion.getByRole('button', { name: '删除日志', exact: true }).click()
  await copy.waitFor({ state: 'detached' })
  await visible('空军也值得记下')
  pass('log deletion respects cancellation and removes only the confirmed record')
  await go('/pages/settings/index')
  await page.getByRole('button', { name: '湖畔青', exact: true }).click()
  await page.emulateMedia({ colorScheme: 'light' })
}
