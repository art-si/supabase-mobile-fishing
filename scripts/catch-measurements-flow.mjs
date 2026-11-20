import assert from 'node:assert/strict'
import { setH5TextScale } from './h5-text-scale.mjs'

// Runs against the local PostgreSQL HTTP contract or temporary real hosted accounts.
export async function catchMeasurementsFlow({
  page,
  button,
  field,
  replyFor,
  snapshot,
  check,
  shot,
  id,
  visual = true
}) {
  await button(page, '编辑这条鱼情').click()
  assert.equal(await field(page, '尾数').inputValue(), '0')
  assert.equal(await field(page, '鱼长（cm）').inputValue(), '38.5')
  assert.equal(await field(page, '总重量（kg）').inputValue(), '1.2')
  check(true, 'Editing restores zero tails and canonical kg and cm')
  await field(page, '尾数').fill('1.5')
  await button(page, '保存修改').click()
  await page.locator('#compose-errors').waitFor()
  check(
    (await page.locator('#compose-errors').innerText()).includes('尾数请输入 0–10000 的整数'),
    'Fractional tails produce an actionable error without saving'
  )
  await field(page, '尾数').fill('0')
  await page.locator('#compose-errors').waitFor({ state: 'hidden' })
  if (visual) {
    for (const [width, height, skin, scheme, size] of [
      [320, 812, 'lake', 'light', 16],
      [375, 812, 'lake', 'light', 16],
      [440, 956, 'ocean', 'light', 16],
      [812, 375, 'stone', 'light', 16],
      [1280, 900, 'lake', 'dark', 16],
      [320, 812, 'ocean', 'dark', 24],
      [375, 812, 'stone', 'dark', 32]
    ]) {
      await page.evaluate(
        (skin) =>
          localStorage.setItem(
            'dyj.appearance.skin.v1',
            JSON.stringify({ type: 'string', data: skin })
          ),
        skin
      )
      await page.setViewportSize({ width, height })
      await page.emulateMedia({ colorScheme: scheme })
      await page.reload()
      await field(page, '总重量（kg）').waitFor()
      await setH5TextScale(page, size)
      await field(page, '总重量（kg）').focus()
      await page.evaluate(() => document.fonts.ready)
      const geometry = await page.locator('#catch-details').evaluate((node) => ({
        fits:
          Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <=
          innerWidth + 1,
        controls: [...node.querySelectorAll('input,[role="button"]')].map((el) => {
          const b = el.getBoundingClientRect()
          return [b.width, b.height]
        })
      }))
      check(
        geometry.fits && geometry.controls.every(([w, h]) => w >= 44 && h >= 44),
        `Catch fields fit ${width} ${skin} ${scheme} text ${size} with usable targets`
      )
      await shot(`catch-fields-${width}-${skin}-${scheme}-${size}`)
      await button(page, '总重量单位').focus()
      await page.keyboard.press('Enter')
      const sheet = page.getByRole('dialog', { name: '总重量单位', exact: true })
      await sheet.waitFor()
      await page.waitForTimeout(350)
      check(
        await sheet.evaluate((n) => {
          const b = n.getBoundingClientRect()
          return b.top >= -1 && b.bottom <= innerHeight + 1
        }),
        `Weight unit sheet fits ${width} ${skin} ${scheme} text ${size}`
      )
      await shot(`catch-units-${width}-${skin}-${scheme}-${size}`, page, false)
      await page.keyboard.press('Escape')
      await sheet.waitFor({ state: 'hidden' })
      check(
        await button(page, '总重量单位').evaluate((n) => n === document.activeElement),
        'Closing weight units returns focus to its trigger'
      )
    }
    await page.setViewportSize({ width: 375, height: 812 })
    await page.emulateMedia({ colorScheme: 'light' })
    await setH5TextScale(page, 16)
  }
  await button(page, '总重量单位').click()
  await button(page, '斤').click()
  assert.equal(await field(page, '总重量（斤）').inputValue(), '2.4')
  await field(page, '总重量（斤）').fill('3.2')
  await field(page, '尾数').fill('5')
  await field(page, '鱼长（cm）').fill('42.25')
  const saved = replyFor(page, 'update_content')
  await button(page, '保存修改').click()
  assert.equal((await saved).status(), 200)
  const record = (await snapshot('post', id)).item
  check(
    record.weight_kg === 1.6 && record.count === 5 && record.length_cm === 42.25,
    'Jin input saves as kg together with integer tails and cm'
  )
  await page.locator('.fish-facts').filter({ hasText: '5 尾' }).waitFor()
  check(
    (await page.locator('.fish-facts').innerText()).includes('最长 42.25 cm'),
    'Catch detail displays saved tails weight and longest fish'
  )
  await shot('catch-facts-375')
  await button(page, '编辑这条鱼情').click()
  for (const name of ['尾数', '鱼长（cm）', '总重量（kg）']) await field(page, name).fill('')
  const cleared = replyFor(page, 'update_content')
  await button(page, '保存修改').click()
  assert.equal((await cleared).status(), 200)
  const empty = (await snapshot('post', id)).item
  check(
    empty.count === null && empty.weight_kg === null && empty.length_cm === null,
    'Clearing optional catch facts restores unknown rather than zero'
  )
}
