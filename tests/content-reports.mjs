import { randomUUID } from 'node:crypto'

export async function contentReportChecks({
  db,
  as,
  rpc,
  read,
  write,
  check,
  rejects,
  alice,
  bob,
  eve,
  base
}) {
  const api = (u, a, p = {}) => as(u, () => rpc('reports', a, p))
  await db.query(
    'insert into fishing_private.moderators(user_id) values($1) on conflict do nothing',
    [eve]
  )
  await db.exec('delete from fishing_private.rate_events')
  const publish = async (type = 'post') => {
    const id = randomUUID()
    if (type === 'post') await write(alice, 'save_post', { ...base, id, audience: 'public' })
    else
      await write(alice, 'save_spot', {
        id,
        name: '举报测试水域',
        city: '苏州',
        water_type: '水库',
        species: '',
        description: '核实信息',
        fee_note: '未核实',
        observed_on: '2026-11-19',
        audience: 'public',
        precision: 'area',
        longitude: 120.51234,
        latitude: 31.25678,
        access_note: '私密入口'
      })
    await as(eve, () =>
      rpc('moderation', 'decide', {
        id,
        type,
        revision: 1,
        decision: 'published',
        reason: '测试审核',
        request_id: randomUUID()
      })
    )
    return id
  }
  const id = await publish(),
    report = await api(bob, 'submit', { id, type: 'post', reason: '内容信息不实' })
  await rejects(
    () => api(null, 'mine'),
    /permission denied/,
    'reports RPC denies anonymous sessions'
  )
  await rejects(
    () => api(bob, 'queue'),
    /FORBIDDEN/,
    'reporter cannot enumerate moderation reports'
  )
  await rejects(
    () => api(bob, 'item', { id: report.id }),
    /FORBIDDEN/,
    'reporter cannot read privileged content through a report id'
  )
  check(
    (await api(alice, 'mine')).items.length === 0,
    'target author cannot see another user report or identity'
  )
  check(
    (await as(alice, () => db.query('select * from public.content_reports'))).rows.length === 0,
    'raw report table preserves reporter-only RLS'
  )
  const duplicate = await write(bob, 'report', { id, type: 'post', reason: '重复请求' })
  check(
    duplicate.id === report.id &&
      duplicate.duplicate &&
      (await api(bob, 'mine')).items[0].reason === '内容信息不实',
    'legacy report command and new endpoint deduplicate without overwriting evidence'
  )
  await rejects(
    () => api(alice, 'submit', { id, type: 'post', reason: '我的内容' }),
    /INVALID_INPUT/,
    'author cannot report own content'
  )
  await rejects(
    () => api(bob, 'submit', { id, type: 'post', reason: ' ' }),
    /INVALID_INPUT/,
    'empty report reasons are rejected'
  )
  const item = await api(eve, 'item', { id: report.id })
  check(
    item.can_hide &&
      !item.needs_other_reviewer &&
      !JSON.stringify(item).includes(bob) &&
      !JSON.stringify(await api(eve, 'queue')).includes(bob),
    'moderation projections exclude reporter identity'
  )
  const decide = {
    id: report.id,
    revision: item.report.revision,
    content_revision: item.content_revision,
    decision: 'hide',
    reason: '信息有误，暂时隐藏，请核实后修正',
    request_id: randomUUID()
  }
  await rejects(
    () => api(eve, 'decide', { ...decide, content_revision: 1 }),
    /REVIEW_CONFLICT/,
    'report resolution rejects stale target revision'
  )
  const resolved = await api(eve, 'decide', decide)
  check(
    resolved.status === 'actioned' && resolved.revision === 2,
    'hiding content and resolving report happen together'
  )
  await rejects(
    () => read(null, 'post', { id }),
    /NOT_FOUND/,
    'resolved report revokes public detail access'
  )
  check(
    !(await read(null, 'feed')).items.some((p) => p.id === id),
    'reported hidden content disappears from feed'
  )
  check(
    (await as(alice, () => rpc('moderation', 'own_status', { id, type: 'post' }))).reason ===
      decide.reason,
    'author receives the content handling reason without reporter information'
  )
  const mine = (await api(bob, 'mine')).items[0]
  check(
    mine.status === 'actioned' &&
      mine.resolution === decide.reason &&
      mine.resolved_at &&
      !JSON.stringify(mine).includes(eve),
    'reporter sees outcome and timestamp, not moderator identity'
  )
  check(
    JSON.stringify(await api(eve, 'decide', decide)) === JSON.stringify(resolved),
    'resolution retries return the exact saved response'
  )
  check(
    (
      await db.query(
        'select count(*)::int n from fishing_private.content_report_actions where report_id=$1',
        [report.id]
      )
    ).rows[0].n === 1,
    'one report has exactly one resolution audit'
  )
  await rejects(
    () => api(eve, 'decide', { ...decide, reason: 'changed' }),
    /REVIEW_CONFLICT/,
    'request id cannot change resolution reason'
  )
  await rejects(
    () => api(eve, 'decide', { ...decide, request_id: randomUUID() }),
    /REVIEW_CONFLICT/,
    'closed reports cannot be processed twice'
  )
  check(
    (await api(bob, 'submit', { id, type: 'post', reason: '重试' })).id === report.id,
    'lost submit response can be recovered even after target hidden'
  )
  await rejects(
    () => as(eve, () => db.query('select * from fishing_private.content_report_actions')),
    /permission denied/,
    'audit table is not exposed to app moderators'
  )

  const spot = await publish('spot'),
    spotReport = await api(bob, 'submit', { id: spot, type: 'spot', reason: '费用说明不符' })
  const s = await api(eve, 'item', { id: spotReport.id })
  check(
    !JSON.stringify(s).includes('120.51234') && !JSON.stringify(s).includes('私密入口'),
    'report review does not disclose hidden coordinates or private access notes'
  )
  await api(eve, 'decide', {
    ...decide,
    id: spotReport.id,
    content_revision: s.content_revision,
    decision: 'dismiss',
    request_id: randomUUID(),
    reason: '现有信息不足以确认问题，暂不处理内容'
  })
  check(
    (await read(null, 'spot', { id: spot })).status === 'published',
    'dismissal leaves target content unchanged'
  )
  const withdrawal = await publish(),
    withdrawnReport = await api(bob, 'submit', {
      id: withdrawal,
      type: 'post',
      reason: '原内容可能有误'
    })
  await write(alice, 'withdraw_content', {
    id: withdrawal,
    type: 'post',
    revision: 2,
    request_id: randomUUID()
  })
  const gone = await api(eve, 'item', { id: withdrawnReport.id })
  check(
    gone.content === null && gone.content_revision === 0 && gone.report.title === '内容已不可用',
    'withdrawal clears target details and original title from review'
  )
  await rejects(
    () =>
      api(eve, 'decide', {
        ...decide,
        id: withdrawnReport.id,
        content_revision: 0,
        request_id: randomUUID()
      }),
    /INVALID_TRANSITION/,
    'review cannot hide or restore a withdrawn private target'
  )
  await api(eve, 'decide', {
    ...decide,
    id: withdrawnReport.id,
    content_revision: 0,
    decision: 'unavailable',
    request_id: randomUUID(),
    reason: '原内容已撤回，无需进一步处理'
  })
  check(
    (await api(bob, 'mine')).items.some(
      (r) => r.id === withdrawnReport.id && r.status === 'unavailable'
    ),
    'unavailable content can be closed without restoring it'
  )
  const self = await publish(),
    selfReport = await api(eve, 'submit', { id: self, type: 'post', reason: '审核员本人举报' })
  check(
    (await api(eve, 'item', { id: selfReport.id })).needs_other_reviewer,
    'own report requires another reviewer'
  )
  await rejects(
    () => api(eve, 'decide', { ...decide, id: selfReport.id, request_id: randomUUID() }),
    /SELF_REPORT_REVIEW/,
    'reviewer cannot decide their own report'
  )
  await db.query('insert into fishing_private.moderators(user_id) values($1)', [alice])
  await rejects(
    () => api(alice, 'decide', { ...decide, id: selfReport.id, request_id: randomUUID() }),
    /SELF_REPORT_REVIEW/,
    'reviewer cannot decide reports about their own content'
  )
  await db.query('delete from fishing_private.moderators where user_id=$1', [alice])
  for (let i = 0; i < 13; i++) {
    await db.exec('delete from fishing_private.rate_events')
    const target = await publish()
    await api(bob, 'submit', { id: target, type: 'post', reason: '分页测试' })
  }
  for (const action of ['mine', 'queue']) {
    const actor = action === 'mine' ? bob : eve
    const a = await api(actor, action),
      b = await api(actor, action, { cursor: a.next })
    check(
      a.items.length === 12 &&
        a.next &&
        b.items.length > 0 &&
        !b.next &&
        !a.items.some((r) => b.items.some((s) => s.id === r.id)),
      `${action} pagination is bounded, stable on tied timestamps, and terminates`
    )
  }
  check(
    (await api(eve, 'queue', { section: 'closed' })).items.length === 3,
    'closed report history remains available'
  )
  await rejects(
    () => api(eve, 'queue', { cursor: { id: report.id } }),
    /INVALID_INPUT/,
    'invalid report cursor is rejected'
  )
  const audit = (
    await db.query('select result from fishing_private.content_report_actions where report_id=$1', [
      report.id
    ])
  ).rows[0].result
  check(
    !('reason' in audit) && !('title' in audit) && !('reporter_id' in audit),
    'audit receipt does not retain the reporter evidence or original target title'
  )
  await write(alice, 'withdraw_content', {
    id,
    type: 'post',
    revision: 3,
    request_id: randomUUID()
  })
  check(
    (await api(eve, 'decide', decide)).title === '内容已不可用',
    'idempotent receipt also respects later target privacy tightening'
  )
  for (let i = 0; i < 4; i++) {
    await db.exec('delete from fishing_private.rate_events')
    const target = await publish()
    await api(bob, 'submit', { id: target, type: 'post', reason: '达到每日限额' })
  }
  const excess = await publish()
  await rejects(
    () => api(bob, 'submit', { id: excess, type: 'post', reason: '超出每日限额' }),
    /RATE_LIMIT/,
    'new reports have a per-user rolling daily cap'
  )
  check(
    (await api(bob, 'submit', { id, type: 'post', reason: '限额后的重试' })).duplicate,
    'daily cap does not prevent recovery of an existing report receipt'
  )
  await rejects(
    () => as(eve, () => db.query('select fishing_private.report_target($1,$2)', ['post', id])),
    /permission denied/,
    'private report target helper cannot be invoked directly'
  )
  await db.query('delete from fishing_private.moderators where user_id=$1', [eve])
  await rejects(
    () => api(eve, 'item', { id: selfReport.id }),
    /FORBIDDEN/,
    'revocation immediately removes report review capability'
  )
  await db.exec('delete from fishing_private.rate_events')
}
