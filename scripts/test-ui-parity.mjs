// Compare actual compiled H5 and WeChat renderer measurements against local Supabase.
// The simulator must be opened on MINIAPP_UI_BUILD_DIR with automation enabled.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { readBuildFiles } from './miniapp-package.mjs'
import { assertLocalConfig, loginLocalH5, requireLocalWechat } from './ui-contract-target.mjs'

const root = resolve(process.env.H5_BUILD_DIR || 'dist/ui-local/h5')
const nativeRoot = resolve(process.env.MINIAPP_UI_BUILD_DIR || 'dist/ui-local/mp-weixin')
const output = resolve(process.env.UI_OUTPUT_DIR || 'artifacts/ui-polish/paired')
const config = [...readBuildFiles(nativeRoot)]
  .filter(([name]) => name.endsWith('.js'))
  .map(([, data]) => data.toString())
  .find((text) => text.includes('supabaseUrl:') && text.includes('phoneAuth:'))
assertLocalConfig(config || '')
await mkdir(output, { recursive: true })
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
}
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname
    const file = resolve(
      root,
      '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname))
    )
    if (!file.startsWith(root + sep)) throw Error('Outside build')
    const data = await readFile(file)
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' })
    response.end(data)
  } catch {
    response.writeHead(404)
    response.end()
  }
})
await new Promise((done) => server.listen(0, '0.0.0.0', done))
const base = `http://127.0.0.1:${server.address().port}`
const require = createRequire(resolve('artifacts/miniapp-tools/package.json'))
console.log('Connecting to WeChat automation')
const native = await require('miniprogram-automator').connect({
  wsEndpoint: process.env.MINIAPP_ENDPOINT || 'ws://127.0.0.1:9423'
})
console.log('Connected; opening the local QA page')
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  await native.reLaunch('/pages/home/index')
  await new Promise((done) => setTimeout(done, 1000))
  const info = await native.evaluate(() => wx.getWindowInfo())
  console.log(`Measuring both renderers at ${info.windowWidth}px`)
  const page = await browser.newPage({
    viewport: { width: info.windowWidth, height: info.windowHeight },
    locale: 'zh-CN', permissions: ['geolocation'], geolocation: { longitude: 114.19, latitude: 30.51 },
    reducedMotion: 'reduce'
  })
  const errors = [],
    results = []
  page.on('pageerror', (error) => errors.push(error.message))
  native.on('exception', (error) => errors.push(String(error.message || error.text)))
  const pause = (ms) => new Promise((done) => setTimeout(done, ms))
  const styles = [
    'font-size',
    'font-family',
    'line-height',
    'color',
    'background-color',
    'border-radius',
    'padding-left',
    'padding-right'
  ]
  const selectedPages =
    process.argv
      .find((arg) => arg.startsWith('--only='))
      ?.slice(7)
      .split(',') || []
  const scenarios = [
    [
      'feed',
      '/pages/home/index',
      [
        ['MobileSegmented', '.mobile-segmented__option'],
        ['PostCard', '.post-card'],
        ['PostCard', '.post-card__author'],
        ['PostCard', '.name'],
        ['PostCard', '.body'],
        ['PostCard', '.badge'],
        ['FishingPlaceLink', '.fishing-place-link'],
        ['DiscussionActions', '.post-actions'],
        ['MobileBottomNav', '.bottom-nav__label']
      ]
    ],
    [
      'mine',
      '/pages/home/index?tab=mine',
      [
        ['MineView', '.mine-profile'],
        ['MineView', '.mine-profile__name'],
        ['MineView', '.mine-profile__bio'],
        ['MineView', '.mine-profile__edit'],
        ['MineView', '.fishing-menu']
      ]
    ],
    [
      'profile',
      '/pages/mine/profile',
      [
        ['ProfileAvatarEditor', '.profile-avatar-field'],
        ['ProfileAvatarEditor', '.caption'],
        ['MobileAvatarEditor', '.mobile-avatar-editor__row'],
        ['MobileField', '.mobile-field__control', 'nickname'],
        ['MobileField', '.mobile-field__control', 'bio']
      ]
    ],
    [
      'settings',
      '/pages/settings/index',
      [
        ['FishingThemePicker', '.skin-choice'],
        ['FishingThemePicker', '.skin-choice__state'],
        ['page', '.settings-nav-copy']
      ]
    ],
    [
      'compose',
      '/pages/post/compose',
      [
        ['MobileField', '.mobile-field__control', 'title'],
        ['MobileField', '.mobile-field__control', 'body'],
        ['MobilePickerTrigger', '.mobile-picker-trigger'],
        ['page', '.media-count'],
        ['page', '.details-toggle'],
        ['page', '.details-toggle__label']
      ]
    ],
    [
      'report',
      '/pages/water-report/index',
      [
        ['page', '.media-count'],
        ['ReportChannels', '.report-channel__toggle'],
        ['ReportChannels', '.report-channel__area']
      ]
    ],
    [
      'spot',
      '/pages/spot/detail?id=b1111111-1111-4111-8111-111111111111',
      [
        ['page', '.spot-summary'],
        ['page', '.spot-summary__author'],
        ['page', '.spot-summary__facts'],
        ['ContentDetailTools', '.content-detail-tools']
      ]
    ],
    [
      'person',
      '/pages/people/detail?id=22222222-2222-4222-8222-222222222222',
      [
        ['page', '.panel'],
        ['page', '.panel .row']
      ]
    ],
    [
      'post',
      '/pages/post/detail?id=a1111111-1111-4111-8111-111111111111',
      [
        ['DiscussionComment', '.discussion-comment__header'],
        ['DiscussionComment', '.discussion-comment__text'],
        ['MobileField', '.mobile-field', 'comment'],
        ['MobileField', '.mobile-field__control', 'comment'],
        ['MobileCommentComposer', '.mobile-comment-composer'],
        ['MobileCommentComposer', '.mobile-comment-composer__input'],
        ['PostComments', '#post-comment-composer'],
        ['MobileCommentComposer', '.mobile-comment-composer__send']
      ]
    ]
  ]
  await requireLocalWechat(native, config)
  await loginLocalH5(page, base)
  for (const [name, route, defaults] of scenarios) {
    if (selectedPages.length && !selectedPages.includes(name)) continue
    const replyState = name === 'post' && process.argv.includes('--reply')
    const detailsState = name === 'compose' && process.argv.includes('--details')
    const samples = replyState
      ? [
          ['PostComments', '.post-comments__replying'],
          ['PostComments', '.post-comments__reply'],
          ['PostComments', '.post-comments__excerpt']
        ]
      : detailsState
        ? [
            ['page', '.details-toggle__label'],
            ['MobileField', '.mobile-field__control', 'count'],
            ['MobileField', '.mobile-field__hint', 'count'],
            ['MobileField', '.mobile-field__hint', 'length'],
            ['CatchWeightField', '.catch-weight'],
            ['MobileField', '.mobile-field__hint', 'weight']
          ]
        : defaults
    console.log(`OPEN ${name}`)
    await page.goto(`${base}/#${route}`)
    await page.reload()
    await page.locator(defaults[0][1]).first().waitFor()
    await native.reLaunch(route)
    const expected = route.split('?')[0].slice(1)
    for (let i = 0; i < 40; i++) {
      await pause(250)
      if (
        await native.evaluate(
          (path) => getCurrentPages().at(-1)?.route === path && !!getCurrentPages().at(-1)?.$vm,
          expected
        )
      )
        break
    }
    await pause(500)
    if (detailsState) {
      await page.getByRole('button', { name: '鱼情详情', exact: true }).click()
      await (await (await native.currentPage()).$('.details-toggle')).tap()
      await pause(300)
    }
    if (replyState) {
      await page.locator('.discussion-comment__message').first().click()
      await page.locator('#comment-input').blur()
      await native.evaluate(() => {
        const all = [],
          seen = new Set()
        const visit = (vm) => {
          if (!vm || seen.has(vm)) return
          seen.add(vm)
          all.push(vm)
          for (const child of vm.$children || []) visit(child)
        }
        visit(getCurrentPages().at(-1)?.$vm)
        all.find((vm) => vm.$options?.__name === 'DiscussionComment').$emit('reply')
        return true
      })
      await native.callWxMethod('hideKeyboard')
      await pause(300)
    }
    for (const [component, selector, field] of samples) {
      console.log(`MEASURE ${component} ${selector}${field ? ` (${field})` : ''}`)
      const h5Scope = field
        ? page
            .locator('.mobile-field')
            .filter({ has: page.locator(`[id="${field}-input"]`) })
            .first()
        : page
      const h5Node =
        field && selector === '.mobile-field' ? h5Scope : h5Scope.locator(selector).first()
      const h5 = await h5Node.evaluate((node, properties) => {
        const box = node.getBoundingClientRect(),
          style = getComputedStyle(node)
        return {
          width: box.width,
          height: box.height,
          ...Object.fromEntries(properties.map((key) => [key, style.getPropertyValue(key)]))
        }
      }, styles)
      const weixin = await native.evaluate(
        ({ component, selector, field }) => {
          const all = [],
            seen = new Set()
          const visit = (vm) => {
            if (!vm || seen.has(vm)) return
            seen.add(vm)
            all.push(vm)
            for (const child of vm.$children || []) visit(child)
          }
          visit(getCurrentPages().at(-1)?.$vm)
          const vm =
            component === 'page'
              ? getCurrentPages().at(-1)?.$vm
              : all.find(
                  (vm) => vm.$options?.__name === component && (!field || vm.$props.field === field)
                )
          if (!vm) throw Error(`Missing component ${component}`)
          return new Promise((done) => {
            const timer = setTimeout(() => done(null), 2000)
            // DevTools 2.02 supports rects here, but computedStyle cannot cross its automation context.
            const query = wx.createSelectorQuery().in(vm.$scope)
            query.selectAll(selector).boundingClientRect()
            query.exec((items) => {
              clearTimeout(timer)
              const item = items?.[0]?.[0]
              done(item ? { width: Number(item.width), height: Number(item.height) } : null)
            })
          })
        },
        { component, selector, field }
      )
      const differences = []
      // This normal-flow container keeps the actual device's bottom safe area.
      const safeAreaDelta =
        selector === '#post-comment-composer'
          ? Math.max(8, info.screenHeight - info.safeArea.bottom) - 8
          : 0
      if (!weixin) differences.push('No native measurement')
      else {
        for (const key of ['width', 'height']) {
          const a = parseFloat(h5[key]),
            b = parseFloat(weixin[key]) - (key === 'height' ? safeAreaDelta : 0)
          if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > 1)
            differences.push(`${key}: ${h5[key]} / ${weixin[key]}`)
        }
      }
      results.push({ page: name, component, selector, field, h5, weixin, safeAreaDelta, differences })
      console.log(
        `${differences.length ? 'DIFF' : 'PASS'} ${name} ${selector}${differences.length ? ': ' + differences.join('; ') : ''}`
      )
    }
    await writeFile(
      resolve(output, 'measurements.json'),
      JSON.stringify({ info, results, errors }, null, 2)
    )
    if (replyState) {
      await page.locator('#post-comment-composer').scrollIntoViewIfNeeded()
      await native.callWxMethod('pageScrollTo', { scrollTop: 100000, duration: 0 })
      await pause(200)
    } else if (detailsState) {
      await native.callWxMethod('pageScrollTo', { selector: '.details-toggle', duration: 0 })
      await pause(200)
    }
    await page.screenshot({ path: resolve(output, `${name}-h5.png`), fullPage: true })
    try {
      await native.screenshot({ path: resolve(output, `${name}-weixin.png`) })
    } catch (error) {
      console.log(`Retrying simulator screenshot for ${name}: ${error.message}`)
      await pause(700)
      await native.screenshot({ path: resolve(output, `${name}-weixin.png`) })
    }
  }
  assert.deepEqual(errors, [])
  assert.equal(
    results.filter((result) => result.differences.length).length,
    0,
    'Review renderer differences in measurements.json'
  )
} finally {
  await native.disconnect()
  await browser.close()
  await new Promise((done) => server.close(done))
}
