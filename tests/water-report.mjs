import { randomUUID } from 'node:crypto'
export async function waterReportChecks({
  db,
  as,
  read,
  write,
  check,
  rejects,
  alice,
  bob,
  eve,
  base
}) {
  await db.exec('delete from fishing_private.rate_events')
  const id = randomUUID(),
    mediaId = randomUUID()
  await db.query(
    'insert into public.media_assets(id,owner_id,path,width,height) values($1,$2,$3,40,40)',
    [mediaId, alice, `test/${mediaId}.jpg`]
  )
  const draft = {
    id,
    category: 'electric',
    province: '湖北省',
    city: '黄石市',
    district: '阳新县',
    location_label: '私密事发水域',
    longitude: 120.123456,
    latitude: 31.123456,
    observed_at: '2026-11-18T10:00:00+08:00',
    description: '目击疑似电鱼工具，需要核实',
    media: [{ id: mediaId }]
  }
  await rejects(
    () => write(alice, 'save_water_report', { ...draft, latitude:null, longitude:null }),
    /water_reports_saved_coordinates_required/,
    'report requires water coordinates'
  )
  const result = await write(alice, 'save_water_report', { ...draft, status: 'delivered' })
  check(result.longitude===draft.longitude && result.latitude===draft.latitude &&
    (await db.query('select consent_version from public.water_reports where id=$1',[id])).rows[0].consent_version===null,
    'the selected coordinates are stored exactly without recording a separate consent')
  check(
    result.status === 'saved' && !result.owner_id && !result.signature,
    'report save never claims delivery and strips internal fields'
  )
  await write(alice, 'save_water_report', { ...draft, status: 'delivered' })
  check((await read(alice, 'water_reports')).items.length === 1, 'report retry is idempotent')
  await rejects(
    () => write(alice, 'save_water_report', { ...draft, description: 'changed' }),
    /EDIT_REQUEST_REUSED/,
    'report retry cannot replace stored evidence with changed input'
  )
  await rejects(
    () => read(null, 'water_reports'),
    /AUTH_REQUIRED/,
    'anonymous cannot enumerate water reports'
  )
  await rejects(
    () => read(bob, 'water_reports', { id }),
    /NOT_FOUND/,
    'another member cannot read report details'
  )
  await db.query(
    'insert into fishing_private.moderators(user_id) values($1) on conflict do nothing',
    [eve]
  )
  check(
    (await as(eve, () => db.query('select id from public.water_reports'))).rows.length === 0,
    'ordinary community moderator cannot read private water reports'
  )
  check(
    (await as(eve, () => db.query('select id from public.media_assets where id=$1', [mediaId])))
      .rows.length === 0,
    'community moderation never unlocks report photos'
  )
  await rejects(
    () => write(alice, 'save_post', { ...base, id: randomUUID(), media: [{ id: mediaId }] }),
    /FORBIDDEN/,
    'report photo cannot be republished via post creation'
  )
  const post = randomUUID()
  await write(alice, 'save_post', { ...base, id: post })
  await rejects(
    () =>
      write(alice, 'update_content', {
        ...base,
        id: post,
        type: 'post',
        revision: 1,
        request_id: randomUUID(),
        media: [{ id: mediaId }]
      }),
    /FORBIDDEN/,
    'report photo cannot be stolen via author editing'
  )
  await rejects(
    () => write(bob, 'delete_water_report', { id }),
    /NOT_FOUND/,
    'another member cannot delete a report'
  )
  await write(alice, 'delete_water_report', { id })
  await write(alice, 'delete_water_report', { id })
  check(
    (await read(alice, 'water_reports')).items.length === 0,
    'deletion retry is safe and removes report from owner history'
  )
  check(
    (await db.query('select longitude,description from public.water_reports where id=$1', [id]))
      .rows[0].longitude === null,
    'deletion clears precise coordinates and descriptive fields'
  )
  check(
    (await as(alice, () => db.query('select id from public.media_assets where id=$1', [mediaId])))
      .rows.length === 0,
    'deleting a report revokes new photo signatures'
  )
  await rejects(
    () => write(alice, 'save_water_report', draft),
    /NOT_FOUND/,
    'a delayed save cannot resurrect a deleted report'
  )
  const image = randomUUID(), video = randomUUID(), mixedReport = randomUUID()
  for (const [asset, kind] of [[image, 'image'], [video, 'video']]) {
    await db.query('insert into public.media_assets(id,owner_id,path,width,height,kind,size,duration) values($1,$2,$3,960,540,$4,100,$5)', [asset, alice, `${alice}/${asset}.${kind === 'video' ? 'mp4' : 'jpg'}`, kind, kind === 'video' ? 5 : null])
  }
  const mixed = await write(alice, 'save_water_report', { ...draft, id: mixedReport, media: [{ id: video }, { id: image }] })
  check(mixed.media.map(m => m.id).join(',') === `${video},${image}` && mixed.media[0].kind === 'video' && mixed.media[0].duration === 5 && mixed.media[0].size === 100, 'private report preserves mixed image/video order and complete playback metadata')
  check((await read(alice, 'water_reports', { id: mixedReport })).media[0].id === video, 'saved evidence order survives a fresh owner read')
  await rejects(() => read(bob, 'water_reports', { id: mixedReport }), /NOT_FOUND/, 'mixed private evidence remains inaccessible to another member')
  const edit = { ...draft, id: mixedReport, expected_revision: mixed.revision, request_id: randomUUID(), description: '补充记录现场情况，供主管单位核实', media: [{ id: image }, { id: video }] }
  check(mixed.revision === 1 && Boolean(mixed.updated_at), 'private report includes an initial revision and update timestamp')
  await rejects(() => write(null, 'update_water_report', edit), /AUTH_REQUIRED|permission denied for function fishing_write/, 'anonymous cannot edit a private report')
  await rejects(() => write(bob, 'update_water_report', edit), /NOT_FOUND/, 'another member cannot edit a private report')
  await rejects(() => write(eve, 'update_water_report', edit), /NOT_FOUND/, 'community moderator cannot edit private reports')
  await rejects(() => write(alice, 'update_water_report', { ...edit, longitude:null,latitude:null }), /water_reports_saved_coordinates_required/, 'private report editing requires a water point')
  await rejects(() => write(alice, 'update_water_report', { ...edit, request_id: null }), /INVALID_INPUT/, 'report edit requires a request identity')
  await rejects(() => write(alice, 'update_water_report', { ...edit, media: [{ id: image }, { id: image }] }), /INVALID_INPUT/, 'report edit rejects duplicate media before mutation')
  await rejects(() => write(alice, 'update_water_report', { ...edit, media: [{ id: randomUUID() }] }), /FORBIDDEN/, 'report edit cannot attach missing evidence')
  await rejects(() => write(alice, 'update_water_report', { ...edit, observed_at: '2099-01-01T00:00:00Z' }), /INVALID_INPUT/, 'report edit rejects future incident time')
  check((await read(alice, 'water_reports', { id: mixedReport })).revision === 1, 'failed edit preserves all existing report fields and revision')
  const updated = await write(alice, 'update_water_report', edit)
  check(updated.id === mixedReport && updated.revision === 2 && updated.description === edit.description && updated.created_at === mixed.created_at, 'report edits same id and preserves original creation time')
  check(updated.media.map(m => m.id).join(',') === `${image},${video}` && updated.status === 'saved', 'report edit preserves mixed media order without implying external delivery')
  check((await write(alice, 'update_water_report', edit)).revision === 2, 'identical edit retry is idempotent even after expected revision becomes stale')
  await rejects(() => write(alice, 'update_water_report', { ...edit, description: '相同请求不能修改内容' }), /EDIT_REQUEST_REUSED/, 'report edit request cannot be reused for changed content')
  await rejects(() => write(alice, 'update_water_report', { ...edit, request_id: randomUUID() }), /EDIT_CONFLICT/, 'stale report edit cannot overwrite newer saved version')
  const foreign = randomUUID(), orphan = randomUUID()
  for (const [asset, owner] of [[foreign, bob], [orphan, alice]]) await db.query('insert into public.media_assets(id,owner_id,path,width,height) values($1,$2,$3,40,40)', [asset, owner, `${owner}/${asset}.jpg`])
  await rejects(() => write(alice, 'update_water_report', { ...edit, request_id: randomUUID(), expected_revision: 2, media: [{ id: foreign }] }), /FORBIDDEN/, 'report editing cannot steal another owner attachment')
  const next = { ...edit, request_id: randomUUID(), expected_revision: 2, media: [{ id: video }, { id: orphan }] }
  const removed = await write(alice, 'update_water_report', next)
  check(removed.revision === 3 && removed.media.map(m => m.id).join(',') === `${video},${orphan}`, 'report editing can keep a video and replace an image with an owned orphan')
  check((await db.query('select id from public.media_assets where id=$1', [image])).rows.length === 0, 'removed private evidence immediately loses its asset/signing index')
  check((await as(alice, () => db.query('select id from public.water_reports where id=$1', [mixedReport]))).rows.length === 1, 'owner RLS still permits own report read after edit')
  await rejects(() => as(alice, () => db.query("update public.water_reports set description='bypassing the edit RPC' where id=$1", [mixedReport])), /permission denied/, 'report edit cannot bypass private RPC through direct table update')
  await write(alice, 'delete_water_report', { id: mixedReport })
  await rejects(() => write(alice, 'update_water_report', next), /NOT_FOUND/, 'late edit retry cannot resurrect or disclose a deleted report')
  check((await db.query('select report_id from fishing_private.water_report_edit_receipts where report_id=$1', [mixedReport])).rows.length === 0, 'deleting report also removes private edit receipts')
  check((await db.query('select id from public.media_assets where id=any($1::uuid[])', [[image, video]])).rows.length === 0, 'deleting private evidence revokes both image and video assets')
}
