import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeReportEmailContact, validateReportEmailContact } from '../src/domain/report-email'
import { privateStorageKey } from '../src/domain/private-storage'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as contactRules from '../src/domain/report-email'

test('private email contact validates human name and a single reply mailbox', () => {
  assert.deepEqual(normalizeReportEmailContact({ name: ' 钓友 ', email: ' person+report@example.com ' }), { name: '钓友', email: 'person+report@example.com' })
  assert.deepEqual(validateReportEmailContact({ name: '钓友', email: 'person+report@example.com' }), {})
  assert.ok(validateReportEmailContact({ name: '', email: 'name@example.com' }).name)
  for (const email of ['', 'bad', 'a@host', 'a@example.com\r\nBcc: hidden@example.com', 'a@example.com,b@example.com', '.name@example.com', 'name..x@example.com', 'name.@example.com'])
    assert.ok(validateReportEmailContact({ name: '钓友', email }).email, email)
  assert.ok(validateReportEmailContact({ name: '钓友\n附加内容', email: 'name@example.com' }).name)
})
test('mailbox contact is removed with current account private drafts only', () => {
  assert.equal(privateStorageKey('dyj.live.draft.alice.report-email-contact', 'live', 'alice'), true)
  assert.equal(privateStorageKey('dyj.live.draft.bob.report-email-contact', 'live', 'alice'), false)
  assert.equal(privateStorageKey('dyj.demo.draft.alice.report-email-contact', 'live', 'alice'), false)
})
test('mailbox storage remains owner-scoped and reports storage failures without replacing contact', () => {
  const storage = new Map<string, unknown>(), exports: Record<string, any> = {}
  let fail = false
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/services/report-email-contact.ts', import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {
    exports,
    require:(id:string)=>id==='@/config'?{isDemo:false}:contactRules,
    uni:{getStorageSync:(key:string)=>storage.get(key),setStorageSync:(key:string,value:unknown)=>{if(fail)throw new Error('storage full');storage.set(key,value)},removeStorageSync:(key:string)=>storage.delete(key)}
  })
  exports.saveReportEmailContact('alice',{name:'钓友',email:'alice@example.com'})
  assert.equal(exports.readReportEmailContact('alice').email,'alice@example.com')
  assert.equal(exports.readReportEmailContact('bob'),null)
  assert.equal(exports.readReportEmailContact(''),null)
  fail=true
  assert.throws(()=>exports.saveReportEmailContact('alice',{name:'新称呼',email:'new@example.com'}),/storage full/)
  assert.equal(exports.readReportEmailContact('alice').email,'alice@example.com')
  exports.clearReportEmailContact('bob');assert.equal(exports.readReportEmailContact('alice').email,'alice@example.com')
  exports.clearReportEmailContact('alice');assert.equal(exports.readReportEmailContact('alice'),null)
})
