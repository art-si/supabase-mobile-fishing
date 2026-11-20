import { randomUUID } from 'node:crypto'

export async function realtimeChecks({ db, as, read, write, check, rejects, alice, bob, eve }) {
  await db.exec('delete from fishing_private.rate_events; delete from public.blocks')
  await db.query(
    'insert into public.friendships(user_a,user_b) values($1,$2) on conflict do nothing',
    [alice, bob]
  )
  const conversation = await write(alice, 'conversation', { id: bob })
  await db.exec('delete from realtime.messages')
  const payload = {
    conversation_id: conversation,
    client_id: randomUUID(),
    body: '仅在数据库读取的文字'
  }
  const message = await write(alice, 'send_message', payload)
  const notices = () =>
    db.query('select topic,payload,event,private from realtime.messages').then((r) => r.rows)
  const rows = await notices()
  check(
    rows.length === 2 &&
      rows.every(
        (r) => r.private && r.event === 'invalidate' && JSON.stringify(r.payload) === '{"v":1}'
      ) &&
      rows
        .map((r) => r.topic)
        .sort()
        .join() ===
        [alice, bob]
          .map((u) => `fishing:user:${u}`)
          .sort()
          .join(),
    'message invalidates only both personal topics; no text, message ID, URL, coordinates or presence'
  )
  await write(alice, 'send_message', payload)
  check((await notices()).length === 2, 'idempotent send does not broadcast a duplicate insert')
  const peer = async (user) =>
    (await read(user, 'social')).conversations.find((c) => c.id === conversation)
  check(
    (await peer(alice)).peer_read_sequence < message.sequence,
    'delivery alone never means read'
  )
  await db.exec('delete from realtime.messages')
  await write(bob, 'read_conversation', { id: conversation, sequence: message.sequence })
  check(
    (await peer(alice)).peer_read_sequence === message.sequence,
    'peer sees authoritative read sequence while friends'
  )
  check((await notices()).length === 2, 'actual read advance notifies both accounts')
  await write(bob, 'read_conversation', { id: conversation, sequence: 0 })
  check(
    (await notices()).length === 2 && (await peer(alice)).peer_read_sequence === message.sequence,
    'read cursor never regresses and unchanged writes do not create notification loops'
  )
  await write(bob, 'read_conversation', { id: conversation, sequence: message.sequence + 1000 })
  check(
    (await peer(alice)).peer_read_sequence === message.sequence,
    'read cursor cannot exceed persisted messages'
  )
  const raw = await as(alice, () =>
    db.query('select user_id from public.conversation_members where conversation_id=$1', [
      conversation
    ])
  )
  check(
    raw.rows.length === 1 && raw.rows[0].user_id === alice,
    'direct member reads expose only self, not raw peer activity'
  )
  await rejects(
    () => write(eve, 'read_conversation', { id: conversation, sequence: message.sequence }),
    /FORBIDDEN/,
    'outsider cannot advance anyone’s read cursor'
  )
  check(
    !(await read(eve, 'social')).conversations.some((c) => c.id === conversation),
    'outsider cannot read receipt projection'
  )
  const topic = (u) => `fishing:user:${u}`
  const readTopic = async (user, requested) => {
    await db.query("select set_config('realtime.topic',$1,false)", [requested])
    return as(user, () => db.query('select topic from realtime.messages'))
  }
  check(
    (await readTopic(alice, topic(alice))).rows.every((r) => r.topic === topic(alice)) &&
      (await readTopic(alice, topic(alice))).rows.length > 0,
    'private broadcast read is restricted to exact own topic'
  )
  for (const [user, requested] of [
    [alice, topic(bob)],
    [eve, topic(alice)],
    [null, topic(alice)],
    [alice, topic(alice) + '-suffix']
  ]) {
    check(
      (await readTopic(user, requested)).rows.length === 0,
      'anonymous/other/suffix topics cannot read invalidations'
    )
  }
  await db.query(
    "insert into realtime.messages(topic,extension) values($1,'presence'),($1,'broadcast')",
    [topic(alice)]
  )
  check(
    (await readTopic(alice, topic(alice))).rows.length === 2,
    'own broadcast join probe is visible with managed private=false default; Presence remains denied'
  )
  await db.query("insert into realtime.messages(topic,extension) values($1,'broadcast')", [
    topic('44444444-4444-4444-8444-444444444444')
  ])
  check(
    (
      await readTopic(
        '44444444-4444-4444-8444-444444444444',
        topic('44444444-4444-4444-8444-444444444444')
      )
    ).rows.length === 0,
    'missing-profile identity cannot join an account topic'
  )
  await rejects(
    () =>
      as(alice, () => db.query("select realtime.send('{}','invalidate',$1,true)", [topic(alice)])),
    /row-level security/,
    'client cannot forge even an own-topic server broadcast'
  )
  await rejects(
    () => as(alice, () => db.query('select fishing_private.notify_social_user($1)', [bob])),
    /permission denied/,
    'client cannot call internal notification helper'
  )
  await write(alice, 'unfriend', { id: bob })
  check(
    (await peer(alice)).peer_read_sequence === null && !(await peer(alice)).can_send,
    'unfriend hides receipt and stops new messages'
  )
  await db.exec('delete from realtime.messages')
  await db.query(
    'update public.conversation_members set last_read_sequence=0 where conversation_id=$1 and user_id=$2',
    [conversation, bob]
  )
  check(
    (await notices()).every((r) => r.topic === topic(bob)),
    'ex-friend receives no new reading activity invalidation'
  )
  await write(bob, 'read_conversation', { id: conversation, sequence: message.sequence })
  check(
    (await notices()).every((r) => r.topic === topic(bob)),
    'own devices still update history read state after unfriend'
  )
  await db.query('insert into public.friendships(user_a,user_b) values($1,$2)', [alice, bob])
  await write(alice, 'block', { id: bob, enabled: true })
  check((await peer(bob)).peer_read_sequence === null, 'block hides current peer receipt')
  await rejects(
    () => write(bob, 'send_message', { ...payload, client_id: randomUUID() }),
    /NOT_FRIENDS/,
    'block is enforced for writes independently of channel connection'
  )
  await db.exec('delete from public.blocks; delete from fishing_private.rate_events')
}
