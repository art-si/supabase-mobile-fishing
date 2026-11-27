import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { resolveMobileProRoot } from '../scripts/mobile-pro.mjs'

function harness() {
  class Button extends EventTarget {
    clicks = 0
    attributes = new Map<string, string>()
    click() { this.clicks++ }
    getAttribute(name: string) { return this.attributes.get(name) ?? null }
    hasAttribute(name: string) { return this.attributes.has(name) }
  }
  const button = new Button()
  const exports: Record<string, any> = {}
  const source = readFileSync(resolve(resolveMobileProRoot(), 'packages/mobile-core/src/action-keyboard.ts'), 'utf8')
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, { exports, EventTarget, HTMLElement: Button, document: { activeElement: button } })
  const event = (key: string, composing = false) => ({
    key, currentTarget: button, repeat: false, isComposing: composing,
    preventDefault() {}, stopPropagation() {}
  })
  return { button, event, down: exports.preventActionKey, up: exports.activateButtonKey }
}

test('native composite button uses its click handler exactly once for Enter and Space', () => {
  const h = harness()
  for (const key of ['Enter', ' ']) {
    h.down(h.event(key)); h.up(h.event(key)); h.up(h.event(key))
  }
  assert.equal(h.button.clicks, 2)
})

test('button key release does not activate after focus moves or without a key press', () => {
  const h = harness()
  h.up(h.event('Enter'))
  h.down(h.event(' ')); h.button.dispatchEvent(new Event('blur')); h.up(h.event(' '))
  assert.equal(h.button.clicks, 0)
})

test('disabled buttons and composing input cannot activate a native action', () => {
  const h = harness()
  h.button.attributes.set('aria-disabled', 'true')
  h.down(h.event('Enter')); h.up(h.event('Enter'))
  h.button.attributes.clear(); h.button.attributes.set('disabled', '')
  h.down(h.event(' ')); h.up(h.event(' '))
  h.button.attributes.clear()
  h.down(h.event('Enter', true)); h.up(h.event('Enter', true))
  h.down(h.event('Tab')); h.up(h.event('Tab'))
  assert.equal(h.button.clicks, 0)
})
