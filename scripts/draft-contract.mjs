import assert from 'node:assert/strict'

// Uses the explicit, offline demo record created by smoke-h5; never touches hosted data.
export async function draftContract({ page, go, fill, visible, pass, screenshot, overflow }) {
  const sourceTitle = '空军也值得记下'
  const sourceCard = () => page.locator('.panel').filter({ hasText: sourceTitle }).first()
  const value = (label) =>
    page.locator(`input[aria-label="${label}"], textarea[aria-label="${label}"]`).inputValue()
  await sourceCard().getByRole('button', { name: '再记一次', exact: true }).click()
  await visible('已沿用鱼种、钓法和饵料。日期为今天，请记录本次鱼情。')
  assert.equal(await value('渔获 1 鱼种'), '鲫鱼')
  assert.equal(await value('饵料'), '蚯蚓')
  assert.equal(await value('标题'), '')
  assert.equal(await value('鱼情与心得'), '')
  assert.equal(await value('渔获 1 尾数'), '')
  assert.equal(await value('渔获 1 重量（kg）'), '')
  const today = await page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  assert.equal(await value('出钓日期'), today)
  assert.ok(!decodeURIComponent(page.url()).includes(sourceTitle))
  assert.ok(!page.url().includes('body='))
  await screenshot('trip-repeat-375.png')
  pass('repeat log reuses only fishing preferences, with a fresh date and empty catch')

  await fill('标题', '需要保留的出钓草稿')
  await fill('鱼情与心得', '还没整理完，不能被覆盖。')
  await go('/pages/mine/library?type=trips')
  await sourceCard().getByRole('button', { name: '再记一次', exact: true }).click()
  await visible('已有未完成的草稿')
  await page.getByText('继续旧草稿', { exact: true }).click()
  assert.equal(await value('标题'), '需要保留的出钓草稿')
  await page.reload()
  await visible('已恢复这台设备上的草稿。')
  assert.equal(await value('鱼情与心得'), '还没整理完，不能被覆盖。')
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
  await fill('标题', '再记一次的新出钓')
  await fill('鱼情与心得', '沿用钓法饵料，渔获未称重。')
  await page.getByRole('button', { name: '保存私人日志', exact: true }).click()
  await visible('再记一次的新出钓')
  await visible(sourceTitle)
  pass('confirmed replacement saves an independent private log without changing its source')

  await sourceCard().getByRole('button', { name: '生成分享草稿', exact: true }).click()
  await visible('已生成独立草稿。请检查正文，分享范围默认公开。照片和位置未带入。')
  assert.equal(await value('标题'), sourceTitle)
  assert.equal(await value('出钓日期'), '2020-03-10')
  assert.equal(await value('水域描述（可选）'), '')
  await visible('发布范围：仅自己。不附带精确坐标。体验内容仅存本机。')
  assert.ok(!page.url().includes('body='))
  await page.reload()
  await visible('已恢复这台设备上的草稿。')
  assert.equal(await value('标题'), sourceTitle)
  pass(
    'sharing transfers through one-use memory, defaults public, and persists without text in URL'
  )
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ colorScheme: 'light' })
}
