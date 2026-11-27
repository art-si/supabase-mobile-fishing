import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function miniDomain() {
  class FixedDate extends Date {
    constructor(value: string | number = '2026-11-23T08:05:00.000Z') { super(value) }
  }
  const modules: Record<string, any> = {
    './user-errors': { userErrorText: String },
    './composition': { compositionLimits: {} },
    './catch-measurements': {},
    './trip-catches': {}
  }
  function load(name: string) {
    const exports: any = {}
    const source = readFileSync(new URL(`../src/domain/${name}.ts`, import.meta.url), 'utf8')
    runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      exports, Date: FixedDate, Intl: undefined,
      require: (id: string) => { assert.ok(id in modules, `known domain dependency ${id}`); return modules[id] }
    })
    modules[`./${name}`] = exports
    return exports
  }
  const presets = load('fishing-presets'), rules = load('rules'), edit = load('content-edit')
  return { presets, rules, edit }
}

test('Mini Program without Intl creates a complete new fish post before first render', () => {
  const { rules } = miniDomain(), draft = rules.freshDraft()
  assert.equal(draft.occurred_time, '16:05')
  assert.equal(draft.kind, 'catch')
  assert.equal(draft.title, '')
  assert.equal(draft.body, '')
  assert.equal(draft.media.length, 0)
  assert.match(draft.id, /^[0-9a-f-]{36}$/)
})

test('fixed +08:00 time pads clock values and crosses UTC midnight without Intl or device timezone', () => {
  const { presets } = miniDomain()
  assert.equal(presets.currentChinaTime(new Date('2026-11-23T00:07:00Z')), '08:07')
  assert.equal(presets.currentChinaTime(new Date('2026-11-23T16:05:00Z')), '00:05')
  assert.equal(presets.currentChinaTime(new Date('2026-11-23T23:59:00Z')), '07:59')
  assert.equal(presets.currentChinaTime(new Date('invalid')), '')
})

test('Mini Program edit restoration uses the same compatible clock conversion', () => {
  const { edit } = miniDomain()
  const draft = edit.postEditDraft({
    id: '11111111-1111-4111-8111-111111111111', kind: 'catch', title: '原来的记录', body: '保留正文',
    species: '鲫鱼', method: '台钓', bait: '', weight_kg: null, count: 1,
    occurred_on: '2026-11-24', occurred_at: '2026-11-23T16:05:00Z', audience: 'public', media: []
  })
  assert.equal(draft.occurred_time, '00:05')
  assert.equal(draft.title, '原来的记录')
  assert.equal(draft.body, '保留正文')
})
