import { randomUUID } from 'node:crypto'

export async function commentChecks({
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
  await db.exec('delete from fishing_private.rate_events; delete from public.blocks')
  const post = randomUUID(),
    other = randomUUID(),
    root = randomUUID(),
    reply = randomUUID()
  await write(alice, 'save_post', { ...base, id: post, audience: 'public' })
  await write(alice, 'save_post', { ...base, id: other, audience: 'public' })
  await db.query("update public.posts set status='published' where id in ($1,$2)", [post, other])
  const comment = { id: root, post_id: post, body: '  草边轻口，试试小漂。  ' }
  await write(bob, 'comment', comment)
  await write(bob, 'comment', comment)
  check(
    (await read(alice, 'comments', { id: post })).total === 1,
    'identical comment retry inserts once'
  )
  await rejects(
    () => write(bob, 'comment', { ...comment, body: 'changed' }),
    /COMMENT_REQUEST_REUSED/,
    'changed body cannot reuse comment identity'
  )
  await rejects(
    () => write(eve, 'comment', comment),
    /FORBIDDEN/,
    'another author cannot claim comment identity'
  )
  await write(alice, 'comment', {
    id: reply,
    post_id: post,
    body: '谢谢，我再试试。',
    reply_to_id: root
  })
  let page = await read(eve, 'comments', { id: post })
  const quoted = page.items.find((c) => c.id === reply)
  check(
    quoted.reply_to.id === root &&
      quoted.reply_to.body === comment.body.trim() &&
      quoted.reply_to.author.id === bob,
    'reply projection resolves current original author and trimmed body'
  )
  await rejects(
    () =>
      write(alice, 'comment', {
        id: randomUUID(),
        post_id: other,
        body: '跨贴',
        reply_to_id: root
      }),
    /COMMENT_REPLY_UNAVAILABLE/,
    'cannot reply to a comment on another post'
  )
  await rejects(
    () =>
      write(alice, 'comment', {
        id: randomUUID(),
        post_id: post,
        body: '空引用',
        reply_to_id: randomUUID()
      }),
    /COMMENT_REPLY_UNAVAILABLE/,
    'unknown reply target is rejected'
  )
  for (const body of ['', '   ', 'x'.repeat(501), 100, null]) {
    await rejects(
      () => write(bob, 'comment', { id: randomUUID(), post_id: post, body }),
      /INVALID_INPUT/,
      'comment validates nonempty bounded string on server'
    )
  }
  await rejects(
    () => write(null, 'comment', comment),
    /permission denied/,
    'anonymous visitor cannot post comments'
  )
  await rejects(
    () => write(alice, 'delete_comment', { id: root, post_id: post }),
    /NOT_FOUND/,
    'post owner cannot erase another author comment'
  )
  await rejects(
    () => write(eve, 'delete_comment', { id: root, post_id: post }),
    /NOT_FOUND/,
    'moderator role grants no implicit arbitrary comment deletion'
  )
  await rejects(
    () => as(bob, () => db.query("update public.comments set body='bypass' where id=$1", [root])),
    /permission denied/,
    'comment writes cannot bypass RPC'
  )
  await rejects(
    () => as(alice, () => db.query('select fishing_private.comments_page($1)', [post])),
    /permission denied/,
    'private projection is not directly callable'
  )
  await rejects(
    () =>
      as(bob, () =>
        db.query("select fishing_private.comment_write('comment',$1)", [JSON.stringify(comment)])
      ),
    /permission denied/,
    'private mutation cannot bypass rate limit'
  )
  await write(eve, 'block', { id: bob, enabled: true })
  page = await read(eve, 'comments', { id: post })
  check(
    page.total === 1 &&
      page.items[0].reply_to === null &&
      !JSON.stringify(page).includes(comment.body.trim()),
    'blocking hides original, count and quoted body'
  )
  check(
    (await as(eve, () => db.query('select * from public.comments where id=$1', [root]))).rows
      .length === 0,
    'direct comment RLS also hides blocked original'
  )
  await rejects(
    () =>
      write(eve, 'comment', {
        id: randomUUID(),
        post_id: post,
        body: '不可回复',
        reply_to_id: root
      }),
    /COMMENT_REPLY_UNAVAILABLE/,
    'cannot newly reply to a blocked author'
  )
  check(
    (await read(bob, 'comments', { id: post })).total === 2,
    'blocking an outsider does not hide unrelated authors'
  )
  await write(eve, 'block', { id: bob, enabled: false })
  await write(bob, 'delete_comment', { id: root, post_id: post })
  await write(bob, 'delete_comment', { id: root, post_id: post })
  page = await read(alice, 'comments', { id: post })
  check(
    page.total === 1 && page.items[0].reply_to === null && page.items[0].reply_to_id === root,
    'deleted original disappears but reply remains with unavailable quote'
  )
  check(
    (await read(alice, 'post', { id: post })).post.comment_count === 1,
    'post count excludes erased comments'
  )
  check(
    (await as(bob, () => db.query('select * from public.comments where id=$1', [root]))).rows
      .length === 0,
    'even owner cannot read erased body from direct table'
  )
  const erased = (await db.query('select body,deleted_at from public.comments where id=$1', [root]))
    .rows[0]
  check(
    erased.body === '' && erased.deleted_at,
    'soft deletion erases body physically, retains only retry tombstone'
  )
  await rejects(
    () => write(bob, 'comment', comment),
    /NOT_FOUND/,
    'delayed create cannot resurrect deleted comment'
  )
  await rejects(
    () =>
      write(alice, 'comment', {
        id: randomUUID(),
        post_id: post,
        body: '已删除',
        reply_to_id: root
      }),
    /COMMENT_REPLY_UNAVAILABLE/,
    'deleted original cannot receive new replies'
  )

  // Equal timestamps exercise the ID tie-breaker; SQL setup avoids spending client rate quota.
  await db.query(
    "insert into public.comments(id,post_id,author_id,body,created_at) select gen_random_uuid(),$1,$2,'分页 '||n,'2026-01-01' from generate_series(1,65) n",
    [post, bob]
  )
  let next = null,
    all = [],
    totals = []
  do {
    page = await read(alice, 'comments', { id: post, cursor: next })
    check(page.items.length <= 30, 'comment page is bounded to 30')
    all.push(...page.items)
    totals.push(page.total)
    next = page.next
  } while (next)
  check(
    all.length === 66 && new Set(all.map((c) => c.id)).size === 66 && totals.every((n) => n === 66),
    'stable composite cursor reaches every comment exactly once'
  )
  for (const cursor of ['bad', 'infinity|' + root, '2026-01-01|bad', 'x'.repeat(101)]) {
    await rejects(
      () => read(alice, 'comments', { id: post, cursor }),
      /INVALID_INPUT/,
      'malformed comment cursor is rejected'
    )
  }
  const first = await read(eve, 'comments', { id: post })
  await db.query("update public.posts set audience='private' where id=$1", [post])
  await rejects(
    () => read(eve, 'comments', { id: post, cursor: first.next }),
    /NOT_FOUND/,
    'saved cursor cannot bypass post withdrawal'
  )
  await rejects(
    () => write(bob, 'comment', { id: randomUUID(), post_id: post, body: 'late' }),
    /NOT_FOUND/,
    'withdrawn post rejects new comments'
  )
  check(
    (await as(eve, () => db.query('select * from public.comments where post_id=$1', [post]))).rows
      .length === 0,
    'post withdrawal revokes direct comments too'
  )
  check(
    (await read(alice, 'comments', { id: post })).total === 66,
    'post owner retains authorized discussion after withdrawal'
  )
  await db.query("update public.posts set status='deleted' where id=$1", [post])
  await rejects(
    () => read(alice, 'comments', { id: post }),
    /NOT_FOUND/,
    'deleted post hides comments even from its owner'
  )
  await db.query('delete from public.posts where id in ($1,$2)', [post, other])
  check(
    (await db.query('select id from public.comments where post_id=$1', [post])).rows.length === 0,
    'hard post cleanup cascades replies and tombstones'
  )
}
