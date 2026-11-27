import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { resolveMobileProRoot } from '../scripts/mobile-pro.mjs'

function harness(refresh: () => unknown | Promise<unknown>, enabled = () => true) {
  const events: Record<string, () => unknown> = {}
  let stops = 0
  const exports: Record<string, any> = {}
  const source = readFileSync(resolve(resolveMobileProRoot(), 'packages/mobile-core/src/pull-down-refresh.ts'), 'utf8')
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, { exports, require: (id: string) => id === 'vue'
    ? { onScopeDispose: (fn: () => void) => { events.dispose = fn } }
    : { onHide: (fn: () => void) => { events.hide = fn }, onShow: (fn: () => void) => { events.show = fn },
      onPullDownRefresh: (fn: () => void) => { events.pull = fn } },
    uni: { stopPullDownRefresh: () => { stops++ } }
  })
  const api = exports.usePullDownRefresh(refresh, enabled)
  return { api, events, stops: () => stops }
}

test('native page pull joins one refresh and stops only after its loader completes', async () => {
  let finish!: () => void, calls = 0
  const h = harness(() => { calls++; return new Promise<void>(resolve => { finish = resolve }) })
  const first = h.api.refresh(), duplicate = h.api.refresh()
  assert.equal(first, duplicate)
  await Promise.resolve(); assert.equal(calls, 1); assert.equal(h.stops(), 0)
  finish(); await first; assert.equal(h.stops(), 1)
})

test('loader failure stops the spinner and later pulls can retry', async () => {
  let calls = 0
  const h = harness(async () => { if (++calls === 1) throw new Error('offline') })
  await assert.rejects(h.api.refresh(), /offline/); assert.equal(h.stops(), 1)
  await h.api.refresh(); assert.equal(calls, 2); assert.equal(h.stops(), 2)
})

test('leaving the route releases its spinner without a late result stopping a new page', async () => {
  let finish!: () => void
  const h = harness(() => new Promise<void>(resolve => { finish = resolve }))
  const task = h.api.refresh(); await Promise.resolve()
  h.events.hide(); assert.equal(h.stops(), 1)
  finish(); await task; assert.equal(h.stops(), 1)
  h.events.dispose(); await h.api.refresh(); assert.equal(h.stops(), 1)
})

test('temporarily disabled refresh never invokes a loader or leaves native animation running', async () => {
  let calls = 0
  const h = harness(() => { calls++ }, () => false)
  await h.api.refresh(); assert.equal(calls, 0); assert.equal(h.stops(), 1)
})

test('fishing list refresh waits for both real entry location and restored session before invoking its loader', async () => {
  const entry = { value: false }, session = { value: false }
  let localEnabled = true, calls = 0
  let pendingLoad: Promise<void> | undefined, indicator: { value: boolean } | undefined
  const theme = { dark: false, palette: { mist: '#f5f7f3' } }
  const events: Record<string, () => void> = {}, paints: Record<string, unknown>[] = []
  const exports: Record<string, any> = {}
  const source = readFileSync(new URL('../src/composables/useListRefresh.ts', import.meta.url), 'utf8')
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, { exports, require: (id: string) => {
    if (id === '@/services/entry-location') return { entryLocationReady: entry }
    if (id === '@/services/session') return { sessionReady: session }
    if (id === '@/stores/appearance') return { useAppearanceStore: () => theme }
    if (id === 'vue') return { watch: (_: unknown, fn: () => void) => { events.theme = fn }, ref: (value: boolean) => ({ value }), readonly: (value: unknown) => value,
      provide: (_: unknown, value: { value: boolean }) => { indicator = value }, onScopeDispose() {}, nextTick: () => Promise.resolve() }
    if (id === './list-refresh-state') return { listRefreshingKey: Symbol() }
    if (id === '@dcloudio/uni-app') return { onShow: (fn: () => void) => { events.show = fn }, onHide: (fn: () => void) => { events.hide = fn } }
    return { usePullDownRefresh: (refresh: () => unknown, enabled: () => boolean) => harness(refresh, enabled).api }
  }, uni: { setBackgroundColor: (value: Record<string, unknown>) => paints.push(value), setBackgroundTextStyle: (value: Record<string, unknown>) => paints.push(value) } })
  const api = exports.useListRefresh(() => { calls++; return pendingLoad }, () => localEnabled)
  await api.refresh(); assert.equal(calls, 0)
  entry.value = true; await api.refresh(); assert.equal(calls, 0)
  session.value = true; await api.refresh(); assert.equal(calls, 1)
  localEnabled = false; await api.refresh(); assert.equal(calls, 1)
  entry.value = false; localEnabled = true; await api.refresh(); assert.equal(calls, 1)
  events.show(); assert.equal(paints[0].backgroundColor, '#f5f7f3'); assert.equal(paints[1].textStyle, 'dark')
  theme.dark = true; theme.palette.mist = '#111d1b'; events.theme()
  assert.equal(paints[2].backgroundColor, '#111d1b'); assert.equal(paints[3].textStyle, 'light')
  events.hide(); events.theme(); assert.equal(paints.length, 4, 'hidden page must not repaint another page background')
  entry.value = true; events.show()
  let finish!: () => void
  pendingLoad = new Promise<void>(resolve => { finish = resolve })
  const task = api.refresh(); await Promise.resolve(); await Promise.resolve()
  assert.equal(indicator?.value, true, 'custom MP indicator remains visible while the real loader is pending')
  finish(); await task; assert.equal(indicator?.value, false)
  pendingLoad = new Promise<void>(resolve => { finish = resolve })
  const hiddenTask = api.refresh(); await Promise.resolve(); await Promise.resolve()
  assert.equal(indicator?.value, true)
  events.hide(); assert.equal(indicator?.value, false, 'leaving the page immediately hides its own indicator')
  finish(); await hiddenTask; assert.equal(indicator?.value, false)
})
