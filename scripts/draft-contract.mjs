import assert from 'node:assert/strict'

// The local QA account owns the source trip; no hosted data is accessible.
export async function draftContract({ page, go, fill, visible, pass, screenshot, overflow, sourceDate }) {
  const sourceTitle = '空军也值得记下'
  const sourceCard = () => page.locator('.panel').filter({ hasText: sourceTitle }).first()
  const value = (label) =>
    page.locator(`input[aria-label="${label}"], textarea[aria-label="${label}"]`).inputValue()
  const choice = (label) =>
    page.getByRole('button', { name: label, exact: true }).getAttribute('aria-description')
  await sourceCard().getByRole('button', { name: '再记一次', exact: true }).click()
  await visible('已沿用鱼种、钓法和饵料。日期为今天，请记录本次鱼情。')
  assert.equal(await choice('选择鱼种'), '鲫鱼')
  assert.equal(await choice('选择饵料'), '蚯蚓')
  assert.equal(await value('标题'), '')
  assert.equal(await value('今天的渔获'), '')
  assert.equal(await value('尾数'), '')
  assert.equal(await value('总重量（kg）'), '')
  const today = await page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  assert.equal(await choice('选择出钓日期'), today)
  assert.ok(!decodeURIComponent(page.url()).includes(sourceTitle))
  assert.ok(!page.url().includes('body='))
  await screenshot('trip-repeat-375.png')
  pass('repeat action creates a post draft with saved fishing preferences and a fresh date')

  await fill('标题', '需要保留的出钓草稿')
  await fill('今天的渔获', '还没整理完，不能被覆盖。')
  await go('/pages/mine/library?type=trips')
  await sourceCard().getByRole('button', { name: '再记一次', exact: true }).click()
  await visible('已有未完成的草稿')
  await page.getByText('继续旧草稿', { exact: true }).click()
  assert.equal(await value('标题'), '需要保留的出钓草稿')
  await page.reload()
  await visible('已恢复这台设备上的草稿。')
  assert.equal(await value('今天的渔获'), '还没整理完，不能被覆盖。')
  pass('cancelling replacement preserves the original draft across reload')

  await go('/pages/mine/library?type=trips')
  await page.setViewportSize({ width: 320, height: 812 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await screenshot('trip-actions-dark-320.png')
  await overflow('trip actions dark 320')
  await sourceCard().getByRole('button', { name: '再记一次', exact: true }).click()
  await visible('已有未完成的草稿')
  await screenshot('trip-replace-dark-320.png')
  await page.getByText('替换草稿', { exact: true }).click()
  await visible('已沿用鱼种、钓法和饵料。日期为今天，请记录本次鱼情。')
  assert.equal(await value('标题'), '')
  assert.equal(await value('今天的渔获'), '')
  await go('/pages/mine/library?type=trips')
  await visible(sourceTitle)
  await visible('0 尾（空军） · 0 kg')
  pass('confirmed replacement clears the draft and leaves the private source log intact')

  await sourceCard().getByRole('button', { name: '生成分享草稿', exact: true }).click()
  const replacement = page.getByRole('alertdialog', { name: '已有未完成的草稿' })
  const sharing = page.getByText('已生成独立草稿。请检查正文，分享范围默认公开。照片和位置未带入。', { exact: true })
  await replacement.or(sharing).first().waitFor()
  if (await replacement.isVisible()) {
    await replacement.getByRole('button', { name: '替换草稿', exact: true }).click()
  }
  await sharing.waitFor()
  assert.equal(await value('标题'), sourceTitle)
  assert.equal(await choice('选择出钓日期'), sourceDate)
  assert.equal(await choice('选择所在位置'), '')
  assert.equal(await choice('分享范围'), '当前选项：公开')
  assert.ok(!page.url().includes('body='))
  await page.reload()
  await visible('已恢复这台设备上的草稿。')
  assert.equal(await value('标题'), sourceTitle)
  pass(
    'sharing transfers through one-use memory, defaults public, and persists without text in URL'
  )

  await go('/pages/post/compose?mode=trip')
  await fill('标题', '用于确认删除的出钓日志')
  await page.getByRole('button', { name: '保存私人日志', exact: true }).click()
  await visible('用于确认删除的出钓日志')
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ colorScheme: 'light' })
}
