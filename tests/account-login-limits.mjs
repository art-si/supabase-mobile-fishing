export async function accountLoginLimitChecks({ db, check, rejects, alice }) {
  const ticket = async (handle) => {
    await db.exec('set role service_role')
    try {
      return (await db.query('select public.fishing_account_login_ticket($1) as result', [handle]))
        .rows[0].result
    } finally {
      await db.exec('reset role')
    }
  }
  await db.exec('set role anon')
  await rejects(
    () => db.query("select public.fishing_account_login_ticket('DY000000000001')"),
    /permission denied/,
    'anonymous cannot resolve a login handle or spend the server ticket'
  )
  await db.exec('reset role; set role authenticated')
  await rejects(
    () => db.query('select * from fishing_private.account_login_limits'),
    /permission denied/,
    'signed-in client cannot read or reset login counters'
  )
  await rejects(
    () => db.query("select public.fishing_account_login_ticket('DY000000000001')"),
    /permission denied/,
    'signed-in client cannot enumerate login resolution'
  )
  await db.exec('reset role')
  const handle = (await db.query('select handle from public.profiles where id=$1', [alice])).rows[0]
    .handle
  check(
    (await ticket(handle.toLowerCase())).user_id === alice,
    'server handle resolution preserves the authoritative profile UUID'
  )
  await db.exec('delete from fishing_private.account_login_limits')
  for (let i = 0; i < 5; i++)
    check((await ticket(handle)).allowed, 'account login attempt within minute budget ' + i)
  const limited = await ticket(handle)
  check(
    !limited.allowed && limited.retry_after > 0 && limited.retry_after <= 60,
    'sixth handle attempt is limited with a bounded retry time'
  )
  check(
    (await ticket('DY000000000002')).allowed,
    'another handle has an independent account budget'
  )
  await db.exec('delete from fishing_private.account_login_limits')
  const hash = (await db.query('select md5($1) as hash', [handle])).rows[0].hash
  await db.query(
    "insert into fishing_private.account_login_limits values($1,date_trunc('hour',clock_timestamp()),20)",
    [hash + ':h']
  )
  check(!(await ticket(handle)).allowed, 'hour budget survives a new minute window')
  await db.exec('delete from fishing_private.account_login_limits')
  await db.exec(
    "insert into fishing_private.account_login_limits values('global:m',date_trunc('minute',clock_timestamp()),60)"
  )
  check(
    !(await ticket('DY000000000003')).allowed,
    'rotating handles cannot bypass the project minute cap'
  )
  await db.exec(
    "update fishing_private.account_login_limits set window_start=window_start-interval '3 hours'"
  )
  check(
    (await ticket('DY000000000004')).allowed,
    'expired limits recover without changing an account'
  )
  check(
    (
      await db.query(
        "select count(*)::int as n from fishing_private.account_login_limits where window_start < clock_timestamp()-interval '2 hours'"
      )
    ).rows[0].n === 0,
    'expired handle limits are cleaned'
  )
  const absent = await ticket('DY000000000005')
  check(
    absent.allowed && absent.user_id === null && !JSON.stringify(absent).includes('phone'),
    'missing handle returns no private phone'
  )
  await db.exec('delete from fishing_private.account_login_limits')
}
