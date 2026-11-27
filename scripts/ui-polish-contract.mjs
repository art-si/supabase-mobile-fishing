import assert from 'node:assert/strict'
import { setH5TextScale } from './h5-text-scale.mjs'

// Layout stress cases in the isolated local API sandbox only.
export async function uiPolishContract({ page, go, screenshot, pass, overflow }) {
  await go('/pages/home/index')
  await page.getByRole('heading', { name: '钓友集', exact: true }).waitFor()
  const viewports = [
    ['320', 320, 740, 'light', 16], ['375', 375, 812, 'light', 16],
    ['440', 440, 956, 'light', 16], ['landscape', 844, 390, 'light', 16],
    ['wide', 1280, 900, 'light', 16], ['dark-150', 320, 740, 'dark', 24],
    ['dark-200', 320, 740, 'dark', 32]
  ]
  await go('/pages/post/compose')
  await page.locator('.compose-submit').click()
  assert.equal(await page.locator('.details-toggle').getAttribute('aria-expanded'), 'false', 'visible-field errors keep optional details collapsed')
  await page.waitForFunction(() => document.activeElement?.id === 'compose-errors')
  assert.ok(await page.locator('#compose-errors').evaluate(node => node === document.activeElement), 'validation focuses the error summary')
  await page.getByRole('button', { name: '鱼情详情', exact: true }).click()
  await page.locator('#count-input').fill('-1')
  await page.getByRole('button', { name: '鱼情详情', exact: true }).click()
  await page.locator('.compose-submit').click()
  assert.equal(await page.locator('.details-toggle').getAttribute('aria-expanded'), 'true', 'hidden measurement errors reveal their fields')
  await page.locator('#count-input').fill('')
  pass('publishing reveals only the sections needed to correct validation errors')
  await go('/pages/post/detail?id=a1111111-1111-4111-8111-111111111111')
  await page.locator('.discussion-comment__message').first().waitFor()
  const original = await page.locator('.discussion-comment__text').first().innerText()
  await page.locator('.discussion-comment__message').first().click()
  assert.equal(await page.locator('.post-comments__excerpt').innerText(), original, 'reply keeps the original comment in context')
  await page.locator('#comment-input').fill('取消回复后仍保留这段草稿。')
  await page.getByRole('button', { name: '取消回复', exact: true }).click()
  assert.equal(await page.locator('.post-comments__excerpt').count(), 0)
  assert.equal(await page.locator('#comment-input').inputValue(), '取消回复后仍保留这段草稿。')
  pass('reply shows its source and cancelling preserves the unsent draft')
  for (const [name, width, height, colorScheme, size] of viewports) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme })
    await go('/pages/home/index')
    await page.reload()
    await page.locator('.post-card').first().waitFor()
    await setH5TextScale(page, size)
    const metrics = await page.locator('.post-card').first().evaluate(node => {
      const avatar = node.querySelector('.post-card__author').getBoundingClientRect()
      const body = getComputedStyle(node.querySelector('.body'))
      return { avatar: { width: avatar.width, height: avatar.height }, bodySize: parseFloat(body.fontSize), family: body.fontFamily,
        pageWidth: document.querySelector('.fishing-page').getBoundingClientRect().width,
        targets: [...document.querySelectorAll('.mobile-segmented__option')].map(node => node.getBoundingClientRect().height) }
    })
    assert.ok(metrics.avatar.width >= 48 && metrics.avatar.height >= 48)
    assert.ok(metrics.bodySize >= 16 && !metrics.family.includes('TMS Sans SC'))
    assert.ok(metrics.targets.every(height => height >= 48))
    if (width <= 600) assert.equal(metrics.pageWidth, width, 'H5 mobile content uses the same available width as WeChat')
    // A reactive test post with long names, city and unbroken metadata.
    await page.locator('.post-card').first().evaluate(node => {
      let component = node.__vueParentComponent
      while (component && !component.props.post) component = component.parent
      const post = component.props.post
      post.author.nickname = '喜欢安静钓鱼的长昵称测试钓友'
      post.author.city = '内蒙古自治区呼和浩特市'
      post.species = 'LongSpeciesNameWithoutSpaces1234567890'
      post.bait = 'LongBaitNameWithoutSpaces1234567890'
      component.proxy.$forceUpdate()
    })
    await page.locator('.post-card .name').first().filter({ hasText: '喜欢安静钓鱼的长昵称测试钓友' }).waitFor()
    await overflow(`long feed metadata ${name}`)
    const header = await page.locator('.post-card__header').first().evaluate(node => {
      const name = node.querySelector('.name').getBoundingClientRect()
      const badge = node.querySelector('.badge').getBoundingClientRect()
      return { nameRight: name.right, badgeLeft: badge.left, right: node.getBoundingClientRect().right, badgeRight: badge.right }
    })
    assert.ok(header.nameRight <= header.badgeLeft && header.badgeRight <= header.right + 1, 'author and content type never overlap')
    await screenshot(`polish-feed-${name}.png`, name !== 'landscape')
    pass(`shared font, 48px controls and long feed metadata ${name}`)

    await go('/pages/post/detail?id=a1111111-1111-4111-8111-111111111111')
    await page.locator('.discussion-comment').first().waitFor()
    await setH5TextScale(page, size)
    await page.locator('.discussion-comment').first().evaluate(node => {
      let component = node.__vueParentComponent
      while (component && !component.props.item) component = component.parent
      component.props.item.author.nickname = '喜欢安静钓鱼的长昵称测试钓友'
      component.props.item.body = 'LongUnbrokenComment1234567890'.repeat(4) + '。长评论与举报入口应完整显示。'
    })
    await overflow(`long comment ${name}`)
    const boxes = await page.locator('.discussion-comment').first().evaluate(node => {
      const rect = target => { const b = node.querySelector(target).getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height } }
      return { header: rect('.discussion-comment__header'), identity: rect('.discussion-comment__identity'), management: rect('.discussion-comment__management'), message: rect('.discussion-comment__message') }
    })
    assert.ok(boxes.identity.right <= boxes.management.left && boxes.management.right <= boxes.header.right + 1)
    assert.ok(boxes.message.top >= boxes.header.bottom - 1 && boxes.message.height >= 48)
    const composer = await page.locator('#post-comment-composer').evaluate(node => ({ position: getComputedStyle(node).position, top: node.getBoundingClientRect().top }))
    assert.equal(composer.position, 'static', 'the editor does not cover preceding comments')
    assert.ok(composer.top >= boxes.message.bottom, 'editor follows all comment content')
    await page.locator('.discussion-comment__header').first().evaluate(node => node.scrollIntoView({ block: 'start' }))
    await screenshot(`polish-comments-${name}.png`, false)
    pass(`long comments, independent management target and unobscured editor ${name}`)
  }
  // Theme propagation must also work when the platform's CSS media query lags
  // behind its app theme event, as it can in the native renderer.
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ colorScheme: 'light' })
  await setH5TextScale(page, 16)
  await go('/pages/post/detail?id=a1111111-1111-4111-8111-111111111111')
  for (const skin of ['lake', 'ocean', 'stone']) {
    await page.locator('.discussion-comment').first().evaluate((node, skin) => {
      const theme = node.__vueParentComponent.proxy.$pinia._s.get('fishing-appearance')
      theme.skin = skin; theme.dark = true
    }, skin)
    await page.waitForTimeout(100)
    const contrasts = await page.evaluate(() => {
      const luminance = css => {
        const rgb = css.match(/[\d.]+/g).slice(0, 3).map(value => Number(value) / 255)
          .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
        return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]
      }
      return ['.discussion-comment__name', '.post-actions .mobile-action'].map(selector => {
        const node = document.querySelector(selector), foreground = getComputedStyle(node).color
        let parent = node, background
        do { parent = parent.parentElement; background = getComputedStyle(parent).backgroundColor } while (background === 'rgba(0, 0, 0, 0)' && parent.parentElement)
        const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
        return { selector, foreground, background, contrast: (values[0] + .05) / (values[1] + .05) }
      })
    })
    assert.ok(contrasts.every(item => item.contrast >= 4.5), JSON.stringify(contrasts))
    await page.locator('.discussion-comment__header').first().scrollIntoViewIfNeeded()
    await screenshot(`polish-theme-independent-dark-${skin}.png`, false)
    pass(`comment and interaction contrast follows app theme independently of CSS media: ${skin}`)
  }

  await page.setViewportSize({ width: 320, height: 740 })
  await setH5TextScale(page, 32)
  for (const route of ['/pages/post/compose', '/pages/water-report/index']) {
    await go(route)
    const count = await page.locator('.media-count').evaluate(node => ({
      height: node.getBoundingClientRect().height, line: parseFloat(getComputedStyle(node).lineHeight)
    }))
    assert.ok(count.height <= count.line + 1, 'attachment count stays on one line at 200% text')
    if (route.includes('water-report')) {
      const area = await page.locator('.report-channel__area').evaluate(node => ({
        height: node.getBoundingClientRect().height, line: parseFloat(getComputedStyle(node).lineHeight)
      }))
      assert.ok(area.height <= area.line + 1, 'the short area name is not squeezed between the heading and arrow')
    }
    await overflow(`media heading 200% ${route}`)
    await screenshot(`polish-media-${route.includes('water-report') ? 'report' : 'compose'}-200.png`)
    pass(`attachment heading and complete count at 200%: ${route}`)
  }
  await go('/pages/home/index')
  await page.locator('.post-card').first().evaluate(node => {
    let component = node.__vueParentComponent
    while (component && !component.props.post) component = component.parent
    Object.assign(component.props.post, { like_count: 1234567, comment_count: 2345678, saved: true })
    component.proxy.$forceUpdate()
  })
  await page.getByRole('button', { name: /^取消收藏：/ }).first().waitFor()
  const actionsFit = await page.locator('.post-card .post-actions .mobile-action').first().evaluate(node => {
    const box = node.getBoundingClientRect(), text = node.querySelector('uni-text').getBoundingClientRect()
    return text.left >= box.left && text.right <= box.right + 1 && node.scrollWidth <= node.clientWidth + 1
  })
  assert.ok(actionsFit, 'long interaction counts remain inside their own control')
  await screenshot('polish-long-action-counts-200.png')
  pass('large interaction counts reflow inside their controls')

  await setH5TextScale(page, 12)
  await go('/pages/post/detail?id=a1111111-1111-4111-8111-111111111111')
  assert.ok(await page.locator('.discussion-comment__text').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize) >= 16))
  pass('comment body retains the same 16px minimum as other content')

  await page.setViewportSize({ width: 375, height: 812 })
  await setH5TextScale(page, 16)
  await go('/pages/home/index?tab=spots')
  await page.reload()
  await page.locator('.spot-card').first().evaluate(node => {
    let component = node.__vueParentComponent
    while (component && !component.props.spot) component = component.parent
    component.props.spot = { ...component.props.spot, fishing_status: 'prohibited' }
    component.proxy.$forceUpdate()
  })
  await page.locator('.spot-card').first().getByRole('img', { name: '禁钓', exact: true }).waitFor()
  for (const skin of ['lake', 'ocean', 'stone']) for (const dark of [false, true]) {
    await page.emulateMedia({ colorScheme: dark ? 'light' : 'dark' })
    await page.waitForTimeout(100)
    await page.locator('.spot-card').first().evaluate((node, { skin, dark }) => {
      const theme = node.__vueParentComponent.proxy.$pinia._s.get('fishing-appearance')
      theme.skin = skin; theme.dark = dark
    }, { skin, dark })
    await page.waitForTimeout(100)
    const colors = await page.locator('.spot-card--prohibited').first().evaluate(node => {
      const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number)
      const gray = values => Array(3).fill(values.reduce((n, value, i) => n + value * [.2126, .7152, .0722][i], 0))
      const blend = (front, back, alpha) => front.map((value, i) => value * alpha + back[i] * (1 - alpha))
      const luminance = values => values.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((n, value, i) => n + value * [.2126, .7152, .0722][i], 0)
      const ink = getComputedStyle(node.querySelector('.heading')).color
      const expected = getComputedStyle(document.querySelector('.fishing-shell-title')).color
      const tint = getComputedStyle(node, '::before')
      const canvas = rgb(getComputedStyle(document.querySelector('.fishing-page')).backgroundColor)
      const background = blend(gray(rgb(tint.backgroundColor)), canvas, Number(tint.opacity))
      const text = blend(gray(rgb(ink)), background, Number(getComputedStyle(node.querySelector('.post-title')).opacity))
      const values = [luminance(text), luminance(background)].sort((a, b) => b - a)
      return { ink, expected, dark: node.__vueParentComponent.proxy.$pinia._s.get('fishing-appearance').dark,
        stampFilter: getComputedStyle(node.querySelector('.spot-status-stamp__icon')).filter,
        contrast: (values[0] + .05) / (values[1] + .05) }
    })
    assert.equal(colors.dark, dark, 'the opposite media theme has settled before measuring the application theme')
    assert.equal(colors.stampFilter !== 'none', dark, 'stamp visibility follows the app appearance even when CSS media disagrees')
    assert.equal(colors.ink, colors.expected, 'prohibited content follows the application palette when media queries disagree')
    assert.ok(colors.contrast >= 4.5, JSON.stringify({ skin, dark, ...colors }))
    await screenshot(`polish-prohibited-${skin}-${dark ? 'dark' : 'light'}.png`)
    pass(`prohibited card follows app ${dark ? 'dark' : 'light'} theme; composed contrast ${colors.contrast.toFixed(2)}:1: ${skin}`)
  }

  // Presentation fixtures only: long public labels, never backend writes.
  for (const [label, width, height, scheme, size] of viewports) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: scheme })
    for (const [kind, route] of [
      ['spot', '/pages/spot/detail?id=b1111111-1111-4111-8111-111111111111'],
      ['person', '/pages/people/detail?id=22222222-2222-4222-8222-222222222222'],
      ['feed', '/pages/home/index']
    ]) {
      await go(route); await page.reload(); await page.locator('.fishing-page').waitFor()
      await page.locator(kind === 'spot' ? '.spot-summary__title' : kind === 'person' ? '.people-profile__copy' : '.post-card').first().waitFor()
      await setH5TextScale(page, size)
      const fit = await page.evaluate(kind => {
        const replace = (selector, value) => { const node = document.querySelector(selector); node.textContent = value; return node }
        let labels = []
        if (kind === 'spot') labels = [
          replace('.spot-summary__meta .caption', 'InnerMongoliaHohhotCity'),
          replace('.spot-summary__title', '清晨芦苇湾的长名称钓位与安全步道'),
          replace('.spot-summary__author .name', '喜欢安静钓鱼的长昵称测试钓友')
        ]
        if (kind === 'person') labels = [
          replace('.people-profile__copy .heading', '喜欢安静钓鱼的长昵称测试钓友'),
          replace('.people-profile__copy .caption', 'DY123456789012345678901234'),
          replace('.people-profile__copy .muted', 'InnerMongoliaHohhotCity · LongMethodName1234567890')
        ]
        if (kind === 'feed') labels = [replace('.post-card .name', '喜欢安静钓鱼的长昵称测试钓友')]
        return labels.every(node => node.getBoundingClientRect().right <= innerWidth + 1 && node.scrollWidth <= node.clientWidth + 1)
      }, kind)
      assert.ok(fit, `${kind}: long metadata fits its own text boxes at ${label}`)
      if (kind === 'spot') assert.ok(await page.locator('.spot-summary__author').evaluate(node => node.getBoundingClientRect().height >= 48), 'the whole author row meets the shared touch target')
      if (kind !== 'spot') {
        const offset = await page.locator(kind === 'person' ? '.people-profile__header' : '.post-card__header').first().evaluate((node, kind) => {
          const avatar = node.querySelector(kind === 'person' ? '.mobile-avatar' : '.post-card__author')
          return Math.abs(avatar.getBoundingClientRect().top - node.getBoundingClientRect().top)
        }, kind)
        assert.ok(offset <= 1, 'the avatar stays beside the start of the identity as names grow')
      }
      await overflow(`detail metadata ${kind} ${label}`)
      await screenshot(`polish-detail-${kind}-${label}.png`, label !== 'landscape')
      pass(`long ${kind} identity and metadata reflow at ${label}`)
    }
  }
  await profileLayoutContract({ page, go, screenshot, pass, overflow }, viewports)
}

export async function profileLayoutContract({ page, go, screenshot, pass, overflow }, viewports) {
  const nickname = '🎣芦苇湾FishingRiverProfile2026'
  const bio = '清早沿河找钓位，记下水色和风向。'.repeat(7)
  const button = name => page.getByRole('button', { name, exact: true })
  await go('/pages/mine/profile')
  await page.reload()
  await page.locator('#nickname-input').fill(nickname)
  await page.locator('#bio-input').fill(bio)
  await button('保存资料').click()
  await page.locator('.mine-profile__name').getByText(nickname, { exact: true }).waitFor()
  pass('saving a directly opened profile returns to Mine with the local changes')

  for (const [label, width, height, scheme, size] of viewports) {
    if (width) await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: scheme })
    await setH5TextScale(page, size)
    const card = button('编辑钓友资料')
    assert.equal(await card.locator('.mobile-avatar').innerText(), '🎣')
    assert.equal(await card.locator('.mine-profile__bio').innerText(), bio)
    assert.ok(await card.evaluate(node => {
      const box = selector => node.querySelector(selector).getBoundingClientRect()
      const avatar = box('.mobile-avatar'), copy = box('.mine-profile__copy'), preview = box('.mine-profile__bio')
      const line = parseFloat(getComputedStyle(node.querySelector('.mine-profile__bio')).lineHeight)
      return avatar.right <= copy.left && Math.abs(avatar.top - copy.top) <= 1 && preview.height <= 2 * line + 1
    }), 'avatar stays with the nickname; the intro preview occupies at most two lines')
    await overflow(`profile summary ${label}`)
    await screenshot(`profile-summary-${label}.png`, false)
    await card.click()
    assert.equal(await page.locator('.profile-avatar-field .mobile-avatar').innerText(), '🎣')
    assert.equal(await page.locator('#bio-input').inputValue(), bio)
    assert.ok(await page.locator('#bio-input').evaluate(node => {
      const control = node.closest('.mobile-field__control'), style = getComputedStyle(control)
      const inside = control.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      return Math.abs(node.clientHeight - inside) <= 1 && inside >= 3 * parseFloat(style.lineHeight) - 1
    }), 'at least three complete editable lines, with no overflow of the input wrapper')
    await overflow(`profile editor ${label}`)
    await screenshot(`profile-editor-${label}.png`, true)
    await button('返回上一页').click()
    await card.waitFor()
    pass(`profile preview and full editor ${label}`)
  }

  await button('编辑钓友资料').press('Enter')
  await page.locator('#nickname-input').fill('')
  await button('保存资料').click()
  await page.waitForFunction(() => document.activeElement?.id === 'nickname-input')
  await page.getByText('请填写昵称', { exact: true }).waitFor()
  await button('返回上一页').click()
  const dialog = page.getByRole('alertdialog', { name: '放弃这次修改？' })
  await dialog.waitFor()
  await screenshot('profile-discard.png', false)
  await dialog.getByRole('button', { name: '继续编辑' }).click()
  assert.equal(await page.locator('#bio-input').inputValue(), bio)
  assert.equal(await page.locator('#nickname-input').inputValue(), '')
  pass('keyboard edit, inline validation and discard cancellation preserve the draft')
}
