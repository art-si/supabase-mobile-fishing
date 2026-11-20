import { randomUUID } from 'node:crypto'

export async function commentModerationChecks({ db, as, rpc, read, write, check, rejects, base }) {
  // Fresh, isolated actors avoid consuming/clearing anyone else's report quota.
  const author = randomUUID(),
    reporter = randomUUID(),
    reviewer = randomUUID()
  await db.query('insert into auth.users(id) values($1),($2),($3)', [author, reporter, reviewer])
  await db.query('insert into fishing_private.moderators(user_id) values($1)', [reviewer])
  const review = (user, action, payload) => as(user, () => rpc('moderation', action, payload))
  const reports = (user, action, payload) => as(user, () => rpc('reports', action, payload))
  const post = randomUUID(),
    root = randomUUID(),
    reply = randomUUID()
  await write(reporter, 'save_post', { ...base, id: post, audience: 'public' })
  await review(reviewer, 'decide', {
    id: post,
    type: 'post',
    revision: 1,
    decision: 'published',
    reason: '测试动态',
    request_id: randomUUID()
  })
  const create = { id: root, post_id: post, body: '待核实的评论原文' }
  await write(author, 'comment', create)
  await write(reporter, 'comment', {
    id: reply,
    post_id: post,
    body: '保留的回复',
    reply_to_id: root
  })
  const submit = { id: root, type: 'comment', reason: '评论中有广告骚扰' }
  await rejects(
    () => reports(null, 'submit', submit),
    /permission denied/,
    'comment reports deny anonymous submission'
  )
  await rejects(
    () => reports(author, 'submit', submit),
    /INVALID_INPUT/,
    'comment author cannot report themselves'
  )
  const receipt = await reports(reporter, 'submit', submit)
  check(
    (await write(reporter, 'report', submit)).id === receipt.id,
    'legacy and current comment report paths deduplicate'
  )
  check(
    (await reports(reporter, 'mine')).items[0].title === '评论',
    'report does not retain a copy of comment body or author name'
  )
  await rejects(
    () => reports(author, 'item', { id: receipt.id }),
    /FORBIDDEN/,
    'comment author cannot read privileged report evidence'
  )
  await rejects(
    () => review(author, 'item', { type: 'comment', id: root }),
    /FORBIDDEN/,
    'ordinary comment author cannot impersonate a reviewer'
  )
  await rejects(
    () =>
      as(author, () =>
        db.query("update public.comments set status='published' where id=$1", [root])
      ),
    /permission denied/,
    'comment status cannot be self-approved through raw table writes'
  )
  await rejects(
    () => as(author, () => db.query('select fishing_private.comment_json($1)', [root])),
    /permission denied/,
    'comment projection remains an internal-only function'
  )
  const item = await reports(reviewer, 'item', { id: receipt.id })
  check(
    item.can_hide &&
      item.content.type === 'comment' &&
      item.content.revision === 1 &&
      item.content.body === create.body,
    'reviewer reads current comment with revision and hide capability'
  )
  check(
    !JSON.stringify(item).includes(reporter) && !JSON.stringify(item).includes('reply_to'),
    'comment review exposes neither reporter identity nor copied reply context'
  )
  check(
    !(await review(reviewer, 'queue', {})).items.some((x) => x.type === 'comment'),
    'published comments do not appear as pending pre-publication reviews'
  )
  const decision = {
    id: receipt.id,
    revision: 1,
    content_revision: 1,
    decision: 'hide',
    reason: '存在广告骚扰，暂时隐藏评论',
    request_id: randomUUID()
  }
  await rejects(
    () => reports(reviewer, 'decide', { ...decision, content_revision: 2 }),
    /REVIEW_CONFLICT/,
    'comment report rejects an incorrect content revision'
  )
  await db.query('insert into fishing_private.moderators(user_id) values($1),($2)', [
    author,
    reporter
  ])
  await rejects(
    () => reports(author, 'decide', decision),
    /SELF_REPORT_REVIEW/,
    'moderator cannot decide a report against their own comment'
  )
  await rejects(
    () => reports(reporter, 'decide', decision),
    /SELF_REPORT_REVIEW/,
    'moderator cannot decide their own comment report'
  )
  await rejects(
    () =>
      review(author, 'decide', {
        id: root,
        type: 'comment',
        revision: 1,
        decision: 'hidden',
        reason: '自审',
        request_id: randomUUID()
      }),
    /SELF_REVIEW/,
    'direct comment moderation also forbids self-review'
  )
  await db.query('delete from fishing_private.moderators where user_id in ($1,$2)', [
    author,
    reporter
  ])
  const resolved = await reports(reviewer, 'decide', decision)
  check(
    resolved.status === 'actioned' &&
      (await review(reviewer, 'item', { type: 'comment', id: root })).revision === 2,
    'comment hide and report closure commit together with one revision bump'
  )
  for (const user of [null, reporter]) {
    const page = await read(user, 'comments', { id: post })
    check(
      page.total === 1 &&
        page.items.length === 1 &&
        page.items[0].reply_to === null &&
        !JSON.stringify(page).includes(create.body),
      'hidden comment and quoted original disappear from non-author page and count'
    )
    check(
      (await read(user, 'post', { id: post })).post.comment_count === 1,
      'post card comment count matches authorized visible comments'
    )
    check(
      (await as(user, () => db.query('select body from public.comments where id=$1', [root]))).rows
        .length === 0,
      'raw comment RLS also hides moderated text from non-author'
    )
  }
  const own = await read(author, 'comments', { id: post })
  check(
    own.total === 2 &&
      own.items.find((x) => x.id === root).status === 'hidden' &&
      own.items.find((x) => x.id === reply).reply_to === null,
    'author retains hidden comment status but even their quoted original is hidden'
  )
  const explanation = await review(author, 'own_status', { type: 'comment', id: root })
  check(
    explanation.status === 'hidden' &&
      explanation.reason === decision.reason &&
      !JSON.stringify(explanation).includes(reporter),
    'author receives handling reason without reporter identity'
  )
  await rejects(
    () => review(reporter, 'own_status', { type: 'comment', id: root }),
    /NOT_FOUND/,
    'handling explanation is comment-author-only'
  )
  check(
    (await reports(reporter, 'mine')).items[0].resolution === decision.reason,
    'comment reporter can read the recorded outcome'
  )
  for (const user of [author, reporter])
    await rejects(
      () =>
        write(user, 'comment', {
          id: randomUUID(),
          post_id: post,
          reply_to_id: root,
          body: '隐藏后继续引用'
        }),
      /COMMENT_REPLY_UNAVAILABLE/,
      'hidden comment cannot receive new replies even from its author'
    )
  await write(author, 'comment', create)
  check(
    (await review(reviewer, 'item', { type: 'comment', id: root })).status === 'hidden',
    'late successful create retry cannot republish a hidden comment'
  )
  check(
    JSON.stringify(await reports(reviewer, 'decide', decision)) === JSON.stringify(resolved),
    'comment report decision retry is idempotent'
  )
  check(
    (await reports(reporter, 'submit', submit)).duplicate,
    'lost comment report receipt is recoverable after hiding'
  )
  const restore = {
    id: root,
    type: 'comment',
    revision: 2,
    decision: 'published',
    reason: '复核后恢复展示',
    request_id: randomUUID()
  }
  await rejects(
    () => review(reviewer, 'decide', { ...restore, revision: 1 }),
    /REVIEW_CONFLICT/,
    'comment restoration rejects stale revision'
  )
  await review(reviewer, 'decide', restore)
  const restored = await read(reporter, 'comments', { id: post })
  check(
    restored.total === 2 &&
      restored.items.find((x) => x.id === reply).reply_to.body === create.body,
    'restored comment and live quote return in original audience'
  )
  await review(reviewer, 'decide', restore)
  check(
    (await review(reviewer, 'item', { type: 'comment', id: root })).revision === 3,
    'restoration retry does not produce another revision'
  )
  await rejects(
    () =>
      review(reviewer, 'decide', {
        ...restore,
        revision: 3,
        decision: 'rejected',
        request_id: randomUUID()
      }),
    /INVALID_TRANSITION/,
    'comments only support hide or restore, not pending-post rejection'
  )
  await write(author, 'delete_comment', { id: root, post_id: post })
  await rejects(
    () => review(reviewer, 'decide', { ...restore, revision: 4, request_id: randomUUID() }),
    /NOT_FOUND/,
    'deleted comment can never be restored by moderation'
  )
  const unavailable = await reports(reviewer, 'item', { id: receipt.id })
  check(
    unavailable.content === null && unavailable.report.title === '内容已不可用',
    'deleted comment text is removed from report review'
  )
  check(
    (await reports(reviewer, 'decide', decision)).title === '内容已不可用',
    'old decision receipt rechecks deletion instead of retaining old content'
  )

  const second = randomUUID()
  await write(author, 'comment', { id: second, post_id: post, body: '父动态权限变化测试' })
  await write(reporter, 'block', { id: author, enabled: true })
  await rejects(
    () => reports(reporter, 'submit', { ...submit, id: second }),
    /NOT_FOUND/,
    'blocked comment author cannot be reached through report submit'
  )
  await write(reporter, 'block', { id: author, enabled: false })
  const withdrawn = await reports(reporter, 'submit', { ...submit, id: second })
  await write(reporter, 'withdraw_content', {
    type: 'post',
    id: post,
    revision: 2,
    request_id: randomUUID()
  })
  let queued, cursor
  do {
    const page = await reports(reviewer, 'queue', { cursor })
    queued = page.items.find((x) => x.id === withdrawn.id)
    cursor = page.next
  } while (!queued && cursor)
  check(
    (await reports(reviewer, 'item', { id: withdrawn.id })).content === null &&
      queued?.title === '内容已不可用',
    'parent withdrawal removes comment body and title from review and queue'
  )
  await rejects(
    () => review(reviewer, 'item', { id: second, type: 'comment' }),
    /NOT_FOUND/,
    'moderator cannot inspect comment inside a now-private parent'
  )
  await rejects(
    () => review(author, 'own_status', { id: second, type: 'comment' }),
    /NOT_FOUND/,
    'comment authorship does not override parent post permission'
  )
  await rejects(
    () =>
      review(reviewer, 'decide', {
        ...restore,
        id: second,
        revision: 1,
        decision: 'hidden',
        request_id: randomUUID()
      }),
    /NOT_FOUND/,
    'moderator cannot mutate comment inside a private parent'
  )
  const closed = await reports(reviewer, 'decide', {
    ...decision,
    id: withdrawn.id,
    content_revision: 0,
    decision: 'unavailable',
    reason: '动态已转为私密',
    request_id: randomUUID()
  })
  check(
    closed.status === 'unavailable',
    'unavailable comment report closes without restoring the parent'
  )

  // Pagination/count must filter hidden rows before taking 31 candidates.
  await db.query("update public.posts set audience='public',status='published' where id=$1", [post])
  await db.query(
    "insert into public.comments(id,post_id,author_id,body,status) select gen_random_uuid(),$1,$2,'分页评论',case when n%2=0 then 'hidden' else 'published' end from generate_series(1,65) n",
    [post, author]
  )
  const first = await read(null, 'comments', { id: post }),
    next = await read(null, 'comments', { id: post, cursor: first.next })
  check(
    first.items.length === 30 &&
      first.total === 35 &&
      next.items.length === 5 &&
      !next.next &&
      !first.items.some((x) => next.items.some((y) => x.id === y.id)) &&
      [...first.items, ...next.items].every((x) => x.status === 'published'),
    'hidden comments do not consume page slots, duplicate rows or inflate public counts'
  )
  const separate = randomUUID(),
    nested = randomUUID()
  await write(reporter, 'save_post', { ...base, id: separate, audience: 'public' })
  await db.query("update public.posts set status='published' where id=$1", [separate])
  await write(author, 'comment', { id: nested, post_id: separate, body: '父状态独立测试' })
  const dismissible = await reports(reporter, 'submit', {
    id: nested,
    type: 'comment',
    reason: '需要核查'
  })
  const dismissed = await reports(reviewer, 'decide', {
    ...decision,
    id: dismissible.id,
    decision: 'dismiss',
    reason: '证据不足，不隐藏评论',
    request_id: randomUUID()
  })
  check(
    dismissed.status === 'dismissed' &&
      (await read(reporter, 'comments', { id: separate })).items[0].status === 'published',
    'dismissing a comment report leaves the comment published'
  )
  let nestedRevision = 1
  for (const parentStatus of ['hidden', 'pending']) {
    await db.query('update public.posts set status=$1 where id=$2', [parentStatus, separate])
    await review(reviewer, 'decide', {
      ...restore,
      id: nested,
      revision: nestedRevision++,
      decision: 'hidden',
      request_id: randomUUID()
    })
    await review(reviewer, 'decide', {
      ...restore,
      id: nested,
      revision: nestedRevision++,
      request_id: randomUUID()
    })
    check(
      (await db.query('select status from public.posts where id=$1', [separate])).rows[0].status ===
        parentStatus,
      `restoring a comment never changes a ${parentStatus} parent status`
    )
    await rejects(
      () => read(author, 'comments', { id: separate }),
      /NOT_FOUND/,
      'restored comment does not grant access to an unpublished parent'
    )
  }
  await db.query("update public.posts set status='published' where id=$1", [separate])
  await review(reviewer, 'decide', {
    ...restore,
    id: nested,
    revision: nestedRevision,
    decision: 'hidden',
    request_id: randomUUID()
  })
  await write(author, 'delete_comment', { id: nested, post_id: separate })
  check(
    (await db.query('select body,deleted_at from public.comments where id=$1', [nested])).rows[0]
      .body === '' && (await read(author, 'comments', { id: separate })).total === 0,
    'author can erase their own hidden comment without restoring it'
  )
  await db.query('delete from fishing_private.moderators where user_id=$1', [reviewer])
  await rejects(
    () => review(reviewer, 'decide', restore),
    /FORBIDDEN/,
    'revoked moderator cannot replay a comment restoration receipt'
  )
  await db.query('delete from auth.users where id in ($1,$2,$3)', [author, reporter, reviewer])
  check(
    (await db.query('select id from public.comments where post_id=$1', [post])).rows.length === 0,
    'isolated account cleanup removes comment rows and tombstones'
  )
}
