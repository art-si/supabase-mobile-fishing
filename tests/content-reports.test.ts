import assert from 'node:assert/strict'
import test from 'node:test'
import { reportDecisions, type ContentReportReview } from '../src/domain/content-reports'
const item = {
  report: { status: 'pending' },
  content: { status: 'published' },
  can_hide: true,
  needs_other_reviewer: false
} as ContentReportReview
test('report decisions do not confuse approving content with approving a report', () => {
  assert.deepEqual(reportDecisions(item), ['hide', 'dismiss'])
  assert.deepEqual(reportDecisions({ ...item, can_hide: false }), ['dismiss'])
})
test('private, deleted or pending replacement content can only be closed without restoration', () => {
  assert.deepEqual(reportDecisions({ ...item, content: null }), ['unavailable'])
  assert.deepEqual(reportDecisions({ ...item, content: { ...item.content!, status: 'pending' } }), [
    'unavailable'
  ])
})
test('resolved and conflicted reports do not offer another resolution action', () => {
  for (const status of ['actioned', 'dismissed', 'unavailable'] as const)
    assert.deepEqual(reportDecisions({ ...item, report: { ...item.report, status } }), [])
  assert.deepEqual(reportDecisions({ ...item, needs_other_reviewer: true }), [])
})
