// Existing formal DevTools session, real entry location and report page lifecycle.
// Only the rendered navigation tab is activated; no prepareDraft/locate call,
// mocks, account injection, draft clearing, form edits, uploads or submissions.
// A DevTools observation is not a physical-phone acceptance result.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readBuildFiles } from './miniapp-package.mjs'
import { confirmedAppId, confirmedProjectUrl, isLiveConfig } from './miniapp-release-config.mjs'

const build = resolve(process.env.MINIAPP_BUILD_DIR || 'dist/build/mp-weixin')
const output = resolve(process.env.MINIAPP_REPORT_OUTPUT || 'artifacts/mini-report-entry-20261124/devtools-live')
const reportCode = await readFile(resolve(build, 'pages/water-report/index.js'), 'utf8')
assert.ok(reportCode.includes('reportLocationState'), 'Build the current read-only report lifecycle state before running')
const triggerTemplate = await readFile(resolve(build, '_mobile-core/components/MobilePickerTrigger.wxml'), 'utf8')
const valueBinding = triggerTemplate.match(/<text\b[^>]*mobile-picker-trigger__value[^>]*>\{\{(\w+)\}\}/)?.[1]
assert.ok(valueBinding, 'The compiled region picker text binding must be available')
const navTemplate = await readFile(resolve(build, '_mobile-core/components/MobileBottomNav.wxml'), 'utf8')
const tabTag = navTemplate.match(/<button\b[^>]*bottom-nav__item[^>]*>/)?.[0]
const navBindings = { items: tabTag?.match(/wx:for="\{\{(\w+)\}\}"/)?.[1],
  label: tabTag?.match(/aria-label="\{\{item\.(\w+)\}\}"/)?.[1],
  tap: tabTag?.match(/bindtap="\{\{item\.(\w+)\}\}"/)?.[1] }
assert.ok(Object.values(navBindings).every(Boolean), 'The rendered main navigation bindings must be available')
const code = [...readBuildFiles(build).entries()].filter(([path]) => path.endsWith('.js')).map(([, bytes]) => bytes.toString())
assert.ok(code.some(isLiveConfig))
assert.ok(code.some(source => source.includes(confirmedProjectUrl)))
const require = createRequire(resolve('artifacts/miniapp-tools/package.json'))
const client = await require('miniprogram-automator').connect({ wsEndpoint: process.env.WECHAT_AUTOMATOR_WS || 'ws://127.0.0.1:9440' })
await mkdir(output, { recursive: true })
const result = { checkedAt: new Date().toISOString(), passed: false, physicalPhone: false, timeline: [],
  boundary: 'Existing real formal DevTools session. The actual bottom navigation opens the report page. No mocks, direct initializer/location calls, account injection, storage clearing, form edits, uploads or business submissions. Existing drafts are compared privately in runtime; result omits account IDs, draft IDs, body, evidence, URLs, tokens and raw coordinates.' }
const sleep = ms => new Promise(done => setTimeout(done, ms))
const status = () => client.evaluate(() => getApp().__reportEntryAudit.status())
let previousSignature = '', lastState
function remember(value) {
  lastState = value
  const signature = JSON.stringify(value)
  if (signature !== previousSignature) {
    previousSignature = signature
    result.timeline.push({ elapsedMs: Date.now() - result.startedAtMs, state: value })
  }
}
async function until(predicate, description, timeout = 60000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await status(); remember(value)
    assert.equal(value.requests.blockedWrites, 0, 'No remote business mutation may be attempted')
    if (predicate(value)) return value
    await sleep(250)
  }
  throw new Error(`Timed out: ${description}`)
}
async function tapTab(label) {
  const page = await client.currentPage()
  assert.ok(page, 'An existing page is required')
  const tab = await page.getElementByXpath(`//button[contains(@class,"bottom-nav__item") and @aria-label="${label}"]`)
  if (tab) { await tab.tap(); return 'SDK native Element.tap' }
  // Some DevTools releases cannot select through custom component boundaries.
  // This fallback delivers the actual rendered button's compiled bindtap event,
  // never the page controller, draft initializer or location function.
  await client.evaluate(label => getApp().__reportEntryAudit.tapRenderedTab(label), label)
  return 'Rendered native bottom-tab bindtap event (SDK selector unavailable)'
}
try {
  const identity = await client.evaluate(() => ({ platform: wx.getDeviceInfo().platform, appId: wx.getAccountInfoSync().miniProgram.appId }))
  assert.equal(identity.platform, 'devtools'); assert.equal(identity.appId, confirmedAppId)
  result.platform = identity.platform
  await client.evaluate(({ project, valueBinding, navBindings }) => {
    const app = getApp(), uniApi = require('_mobile-core/app.js').index
    app.__reportEntryAudit?.restore?.()
    if (typeof uniApi.addInterceptor !== 'function' || typeof uniApi.removeInterceptor !== 'function')
      throw new Error('Read-only native request observation is unavailable')
    const requests = { region: 0, reads: 0, tokenRefreshes: 0, blockedWrites: 0 }
    const guard = { invoke(options) {
      const url = String(options.url || ''), method = String(options.method || 'GET').toUpperCase()
      if (!url.startsWith(project + '/') || ['GET', 'HEAD'].includes(method)) return
      let data
      try { data = typeof options.data === 'string' ? JSON.parse(options.data) : options.data } catch {}
      if (method === 'POST' && url.startsWith(project + '/functions/v1/amap') &&
          ['search', 'region', 'shoreline', 'water-places', 'preview', 'weather'].includes(data?.action)) {
        if (data.action === 'region') requests.region++
        return
      }
      if (method === 'POST' && (url === project + '/rest/v1/rpc/fishing_read' || url.startsWith(project + '/storage/v1/object/sign/') ||
          (url === project + '/rest/v1/rpc/fishing_spot_community' && data?.action === 'summary') ||
          url === project + '/rest/v1/rpc/fishing_list_spot_leads' ||
          (url === project + '/rest/v1/rpc/fishing_zones_read' && data?.action === 'nearby'))) {
        requests.reads++; return
      }
      if (method === 'POST' && url.startsWith(project + '/auth/v1/token') &&
          (data?.grant_type === 'refresh_token' || /[?&]grant_type=refresh_token(?:&|$)/.test(url))) {
        requests.tokenRefreshes++; return
      }
      requests.blockedWrites++; return false
    } }
    const uploadGuard = { invoke() { requests.blockedWrites++; return false } }
    uniApi.addInterceptor('request', guard); uniApi.addInterceptor('uploadFile', uploadGuard)
    const pages = () => getCurrentPages(), page = () => pages().slice(-1)[0]
    function descendants(root) {
      const found = [], seen = new Set()
      function visit(vm) { if (!vm || seen.has(vm)) return; seen.add(vm); found.push(vm); (vm.$children || []).forEach(visit) }
      visit(root); return found
    }
    const name = vm => vm?.$options?.__name || vm?.$options?.name
    const auth = () => page()?.$vm?.$pinia?._s.get('fishing-auth')
    const copy = value => value == null ? value : JSON.parse(JSON.stringify(value))
    const draftKeys = () => wx.getStorageInfoSync().keys.filter(key => /^dyj\.live\.draft\..+\.water-report(?:\.edit\..+)?$/.test(key))
    const before = new Map(draftKeys().map(key => [key, copy(wx.getStorageSync(key))]))
    const ownerKey = `dyj.live.draft.${auth()?.userId || 'guest'}.water-report`
    const original = before.get(ownerKey)
    const meaningful = value => !!(value?.id && (value._edited || value.description?.trim() || value.media?.length))
    const hasRegion = value => ['province', 'city', 'district'].some(key => String(value?.[key] || '').trim())
    const evidenceIdentity = value => (value || []).map(item => ({ id: item.id, path: item.path, kind: item.kind || 'image' }))
    function unchangedOtherFields() {
      if (!meaningful(original)) return true
      const after = wx.getStorageSync(ownerKey)
      if (!after || !['id', 'category', 'description', 'location_label', 'longitude', 'latitude', 'observed_local']
        .every(key => JSON.stringify(after[key]) === JSON.stringify(original[key]))) return false
      return JSON.stringify(evidenceIdentity(after.media)) === JSON.stringify(evidenceIdentity(original.media))
    }
    function unchangedOtherDrafts() {
      return [...before].filter(([key]) => key !== ownerKey).every(([key, value]) =>
        JSON.stringify(wx.getStorageSync(key)) === JSON.stringify(value))
    }
    const summary = { exists: !!original, meaningful: meaningful(original),
      hasText: !!original?.description?.trim(), hasEvidence: !!original?.media?.length,
      evidenceCount: original?.media?.length || 0, hasRegion: meaningful(original) && hasRegion(original) }
    function refs() {
      const current = page(), all = descendants(current?.$vm), region = all.find(vm => name(vm) === 'ReportRegionFields')
      const trigger = descendants(region).find(vm => name(vm) === 'MobilePickerTrigger' && vm.$props.label === '选择事发地区')
      return { current, all, region, trigger }
    }
    app.__reportEntryAudit = {
      before() { return summary },
      tapRenderedTab(label) {
        const nav = descendants(page()?.$vm).find(vm => name(vm) === 'MobileBottomNav' && vm.$props.items?.some(item => item.label === label))
        const button = nav?.$scope?.data[navBindings.items]?.find(item => item[navBindings.label] === label)
        const handler = button && nav.$scope[button[navBindings.tap]]
        if (typeof handler !== 'function') throw new Error('The requested rendered navigation button is unavailable')
        handler({ type: 'tap', detail: {}, timeStamp: Date.now(), target: { dataset: {} }, currentTarget: { dataset: {} } })
      },
      status() {
        const { current, region, trigger } = refs(), fn = current?.$vm?.$?.exposed?.reportLocationState || current?.$vm?.reportLocationState
        const observed = typeof fn === 'function' ? fn() : undefined
        const safeName = value => typeof value === 'string' ? value.slice(0, 40) : ''
        const names = observed ? { province: safeName(observed.region?.province), city: safeName(observed.region?.city), district: safeName(observed.region?.district) } : undefined
        const expected = names && [...new Set(Object.values(names).filter(Boolean))].join(' · ')
        const nativeText = trigger?.$scope?.data[valueBinding]
        const nativeDisplay = typeof nativeText === 'string' && nativeText === expected ? nativeText : ''
        const existingRegionPreserved = !summary.hasRegion || ['province', 'city', 'district'].every(key => names?.[key] === (original[key] || ''))
        return { route: current?.route, pageStack: pages().map(item => item.route), signedIn: !!auth()?.signedIn,
          lifecycleExposed: !!observed, reportLocationState: observed && {
            mounted: !!observed.mounted, prepared: !!observed.prepared, initialized: !!observed.initialized, active: !!observed.active,
            locationAttempted: !!observed.locationAttempted, locating: !!observed.locating,
            locationError: /^[A-Z][A-Z0-9_]{1,63}$/.test(observed.locationError || '') ? observed.locationError : '',
            hasLocationMessage: !!observed.locationMessage, region: names, regionCached: !!observed.regionCached,
            hasLocationLabel: !!observed.hasLocationLabel, hasPoint: !!observed.hasPoint, ownerReady: !!observed.ownerReady,
            formVersion: Number(observed.formVersion) || 0 },
          regionFieldPresent: !!region, nativePickerPresent: !!trigger,
          nativeRegionDisplay: nativeDisplay, nativeDisplayMatchesRegion: !!expected && nativeText === expected,
          existingRegionPreserved, existingContentPreserved: unchangedOtherFields(), otherDraftsPreserved: unchangedOtherDrafts(),
          requests: { ...requests } }
      },
      async regionLayout() {
        const { trigger } = refs()
        if (!trigger) return null
        return new Promise(done => wx.createSelectorQuery().in(trigger.$scope).select('.mobile-picker-trigger')
          .boundingClientRect(value => done(value && { top: value.top, bottom: value.bottom, left: value.left, width: value.width,
            height: value.height, viewportHeight: wx.getWindowInfo().windowHeight })).exec())
      },
      restore() { uniApi.removeInterceptor('request', guard); uniApi.removeInterceptor('uploadFile', uploadGuard); before.clear(); delete app.__reportEntryAudit }
    }
    return true
  }, { project: confirmedProjectUrl, valueBinding, navBindings })
  result.startedAtMs = Date.now()
  const initial = await status(); remember(initial)
  assert.equal(initial.signedIn, true, 'Use the existing real signed-in session; this script never signs in')
  if (!['pages/home/index', 'pages/water-report/index'].includes(initial.route)) {
    const homeIndex = initial.pageStack.lastIndexOf('pages/home/index')
    assert.ok(homeIndex >= 0, 'An existing home page is required; this check never replaces the session by reLaunch')
    result.returnHomeDelivery = 'Native navigateBack to the existing home page'
    await client.callWxMethod('navigateBack', { delta: initial.pageStack.length - homeIndex - 1 })
    await until(value => value.route === 'pages/home/index', 'normally returning to the existing home page')
  } else if (initial.route !== 'pages/home/index') {
    result.returnHomeDelivery = await tapTab('钓友圈')
    await until(value => value.route === 'pages/home/index', 'returning through the existing home tab')
  }
  result.existingDraft = await client.evaluate(() => getApp().__reportEntryAudit.before())
  result.openReportDelivery = await tapTab('举报')
  const settled = await until(value => {
    const s = value.reportLocationState
    if (value.route !== 'pages/water-report/index' || !s?.mounted || !s.prepared || !s.active || s.locating) return false
    return (value.regionFieldPresent && value.nativeDisplayMatchesRegion) || (s.locationAttempted && s.hasLocationMessage)
  }, 'automatically preparing and filling the incident region on first report entry')
  result.report = settled
  assert.equal(settled.reportLocationState.ownerReady, true)
  assert.equal(settled.existingContentPreserved, true, 'Preserve text, evidence, water label, incident point, time and draft identity')
  assert.equal(settled.otherDraftsPreserved, true, 'Unrelated stored drafts must remain unchanged')
  assert.equal(settled.existingRegionPreserved, true, 'Preserve every previously selected nonempty incident region')
  assert.ok(settled.reportLocationState.region.province && settled.reportLocationState.region.city,
    `Incident region must be present after automatic entry; error=${settled.reportLocationState.locationError || 'none'}`)
  assert.equal(settled.nativeDisplayMatchesRegion, true, 'The actual compiled native picker must display the observed incident region')
  result.outcome = result.existingDraft.hasRegion ? 'Existing incident region preserved and rendered; no claim of new autofill' : 'Empty incident region automatically filled and rendered'
  await client.callWxMethod('pageScrollTo', { scrollTop: 0, duration: 0 })
  await sleep(250)
  const layout = await client.evaluate(() => getApp().__reportEntryAudit.regionLayout())
  assert.ok(layout && layout.width > 0 && layout.height > 0, 'The native region selector must have real visible geometry')
  // Place the region near the lower viewport, keeping subsequent incident
  // coordinates/evidence outside the first-entry screenshot.
  await client.callWxMethod('pageScrollTo', { scrollTop: Math.max(0, layout.top - Math.max(120, layout.viewportHeight - 170)), duration: 0 })
  await sleep(250)
  result.regionLayout = await client.evaluate(() => getApp().__reportEntryAudit.regionLayout())
  assert.ok(result.regionLayout.top >= 0 && result.regionLayout.bottom < result.regionLayout.viewportHeight - 60,
    'The complete region selector must be visible above the bottom navigation')
  await client.screenshot({ path: resolve(output, 'report-first-entry.png') })
  result.screenshot = 'report-first-entry.png'
  result.passed = true
} catch (error) {
  result.error = String(error.message || error).replace(/https?:\/\/\S+/g, '[URL omitted]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[ID omitted]')
    .replace(/-?\d{1,3}\.\d{4,}/g, '[coordinate omitted]')
  result.lastState = await status().catch(() => lastState || { unavailable: true })
  await client.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  delete result.startedAtMs
  await client.evaluate(() => getApp().__reportEntryAudit?.restore()).catch(() => {})
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
  await client.disconnect()
}
