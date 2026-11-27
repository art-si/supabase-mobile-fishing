import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('password state is authoritative, scoped to the caller, and never exposes credentials', async () => {
  const db = new PGlite()
  const a = '11111111-1111-4111-8111-111111111111'
  const b = '22222222-2222-4222-8222-222222222222'
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema fishing_private;
      create table auth.users(id uuid primary key, encrypted_password text);
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth,fishing_private to authenticated;
      grant execute on function auth.uid() to authenticated;
    `)
    await db.exec(
      await readFile(
        new URL(
          '../supabase/migrations/20261123012610_fishing_account_password_status.sql',
          import.meta.url
        ),
        'utf8'
      )
    )
    await db.query('insert into auth.users values ($1,null),($2,$3)', [
      a,
      b,
      'fixture-hash-never-returned'
    ])
    const configured = async (owner: string) => {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner])
      return (
        await db.query<{ value: boolean }>('select public.fishing_password_configured() as value')
      ).rows[0].value
    }
    await db.exec('set role anon')
    await assert.rejects(configured(a), /permission denied/)
    await db.exec('reset role; set role authenticated')
    await assert.rejects(configured(''), /NOT_AUTHENTICATED/)
    await assert.rejects(configured('33333333-3333-4333-8333-333333333333'), /NOT_AUTHENTICATED/)
    assert.equal(await configured(a), false, 'SMS registration has no password')
    assert.equal(await configured(b), true, 'existing password is preserved on another device')
    await assert.rejects(db.query('select encrypted_password from auth.users'), /permission denied/)
    await db.exec('reset role')
    await db.query('update auth.users set encrypted_password=$2 where id=$1', [a, ''])
    await db.exec('set role authenticated')
    assert.equal(await configured(a), false)
    await db.exec('reset role')
    await db.query('update auth.users set encrypted_password=$2 where id=$1', [
      a,
      'fixture-new-hash'
    ])
    await db.exec('set role authenticated')
    assert.equal(await configured(a), true, 'setting the password immediately changes the state')
    assert.equal(typeof (await configured(b)), 'boolean')
    await db.exec('reset role')
    const flags = (
      await db.query<{ proname: string; prosecdef: boolean }>(`
      select proname,prosecdef from pg_proc
      where oid in ('public.fishing_password_configured()'::regprocedure,'fishing_private.password_configured()'::regprocedure)
    `)
    ).rows
    assert.equal(flags.find((f) => f.proname === 'fishing_password_configured')?.prosecdef, false)
    assert.equal(flags.find((f) => f.proname === 'password_configured')?.prosecdef, true)
  } finally {
    await db.close()
  }
})
