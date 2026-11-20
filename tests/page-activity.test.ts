import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as Vue from 'vue'

// Run the real shared composable with only the framework's route hooks injected.
function fixture(foreground = Vue.ref(false)) {
  const hooks: Record<string, () => void> = {}
  const module = { exports: {} as { usePageActivity: (...args: unknown[]) => void } }
  const source = ts.transpileModule(readFileSync('src/_mobile-core/page-activity.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  vm.runInNewContext(source, {
    exports: module.exports,
    require: (name: string) =>
      name === 'vue'
        ? Vue
        : {
            onShow: (callback: () => void) => {
              hooks.show = callback
            },
            onHide: (callback: () => void) => {
              hooks.hide = callback
            },
            onUnload: (callback: () => void) => {
              hooks.unload = callback
            }
          }
  })
  let starts = 0,
    stops = 0
  const scope = Vue.effectScope()
  scope.run(() =>
    module.exports.usePageActivity(
      foreground,
      () => starts++,
      () => stops++
    )
  )
  return { hooks, scope, foreground, counts: () => [starts, stops] }
}
test('page activity requires both app foreground and visible route, deduplicating either event order', () => {
  const f = fixture()
  f.hooks.show()
  assert.deepEqual(f.counts(), [0, 0])
  f.foreground.value = true
  f.hooks.show()
  assert.deepEqual(f.counts(), [1, 0])
  f.foreground.value = false
  f.hooks.hide()
  assert.deepEqual(f.counts(), [1, 1])
  f.foreground.value = true
  assert.deepEqual(f.counts(), [1, 1])
  f.hooks.show()
  f.hooks.hide()
  f.foreground.value = false
  f.hooks.show()
  assert.deepEqual(f.counts(), [2, 2])
  f.foreground.value = true
  f.scope.stop()
  f.hooks.unload()
  f.hooks.show()
  assert.deepEqual(f.counts(), [3, 3])
})
test('switching routes while app is inactive resumes only the new route', () => {
  const foreground = Vue.ref(true),
    old = fixture(foreground),
    next = fixture(foreground)
  old.hooks.show()
  foreground.value = false
  old.hooks.hide()
  next.hooks.show()
  foreground.value = true
  assert.deepEqual(old.counts(), [1, 1])
  assert.deepEqual(next.counts(), [1, 0])
  next.hooks.unload()
  next.scope.stop()
  foreground.value = false
  foreground.value = true
  assert.deepEqual(next.counts(), [1, 1])
  old.scope.stop()
})
