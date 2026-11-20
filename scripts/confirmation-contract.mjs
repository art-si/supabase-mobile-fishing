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
      ['ocean', '深海蓝'],
      ['stone', '岩石灰']
    ]) {
      await go('/pages/settings/index')
      await page.getByRole('button', { name, exact: true }).click()
      await go('/pages/people/detail?id=22222222-2222-4222-8222-222222222222')
      await page.getByRole('button', { name: '删除好友', exact: true }).click()
      const dialog = page.getByRole('alertdialog', { name: '删除好友？', exact: true })
      await dialog.waitFor()
      await checkColors(dialog)
      await page.waitForFunction(() =>
        document.activeElement?.classList.contains('mobile-confirm__cancel')
      )
      await screenshot(`confirm-${skin}-${scheme}-320.png`)
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      await page.getByRole('button', { name: '发消息', exact: true }).waitFor()
      pass(
        `${skin} ${scheme} destructive confirmation: readable, cancel-first focus, Escape leaves friend unchanged`
      )
    }
  }
  await page.getByRole('button', { name: '拉黑这位钓友', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '拉黑', exact: true }).click()
  await page.getByRole('button', { name: '解除拉黑', exact: true }).click()
  const unblocking = page.getByRole('dialog', { name: '解除拉黑？', exact: true })
  await checkColors(unblocking)
  await screenshot('confirm-unblock-dark-320.png')
  await unblocking.getByRole('button', { name: '解除', exact: true }).click()
  await page.getByRole('button', { name: '拉黑这位钓友', exact: true }).waitFor()
  await page.getByRole('button', { name: '加好友', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '发消息', exact: true }).count(), 0)
  pass('block/unblock confirms explicitly; removing a block never silently restores friendship')

  await go('/pages/mine/library?type=trips')
  const copy = page.locator('.panel').filter({ hasText: '再记一次的新出钓' })
  await copy.getByRole('button', { name: '删除日志', exact: true }).click()
  const deletion = page.getByRole('alertdialog', { name: '删除这条记录？', exact: true })
  await deletion.getByRole('button', { name: '取消', exact: true }).click()
  assert.ok(await copy.isVisible())
  await copy.getByRole('button', { name: '删除日志', exact: true }).click()
  await deletion.getByRole('button', { name: '删除记录', exact: true }).click()
  await copy.waitFor({ state: 'detached' })
  await visible('空军也值得记下')
  pass('log deletion respects cancellation and removes only the confirmed record')
  await go('/pages/settings/index')
  await page.getByRole('button', { name: '湖畔青', exact: true }).click()
  await page.emulateMedia({ colorScheme: 'light' })
}
