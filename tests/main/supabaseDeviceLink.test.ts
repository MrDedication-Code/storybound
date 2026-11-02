import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { createHash, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

// Applies every Supabase migration to an in-memory Postgres with minimal stand-ins for
// Supabase's auth schema, then calls the device-link RPCs as the `authenticated` role, the way
// the apps do. Unlike supabase/tests (pgTAP), this needs no Docker.

interface User {
  id: string
  session: string
}

const migrationsPath = resolve(__dirname, '../../supabase/migrations')
let db: PGlite

async function as<Row = Record<string, unknown>>(
  user: User,
  sql: string,
  parameters: unknown[] = []
): Promise<Row[]> {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user.id])
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: user.id, session_id: user.session })
  ])
  await db.exec('set role authenticated')
  try {
    return (await db.query<Row>(sql, parameters)).rows
  } finally {
    await db.exec('reset role')
  }
}

async function result<T>(user: User, sql: string, parameters: unknown[] = []): Promise<T> {
  const [row] = await as<{ r: T }>(user, `${sql} r`, parameters)
  return row.r
}

async function newUser(): Promise<User> {
  const user = { id: randomUUID(), session: randomUUID() }
  await db.query('insert into auth.users (id) values ($1)', [user.id])
  await db.query('insert into auth.sessions (id, user_id) values ($1, $2)', [user.session, user.id])
  return user
}

const token = (): string => randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')
const publicKey = (): string =>
  Buffer.from(randomUUID() + randomUUID())
    .subarray(0, 32)
    .toString('base64')

const REQUEST = 'select public.request_storybound_device_link($1,$2,$3,$4,$5)'
const LIST = 'select public.list_storybound_link_requests($1,$2)'
const ACKNOWLEDGE = 'select public.acknowledge_storybound_device_link($1,$2,$3,$4)'
const APPROVE = 'select public.approve_storybound_device_link($1,$2,$3,$4,$5,$6)'
const GET = 'select public.get_storybound_device_link($1,$2)'

describe('device-link RPCs', () => {
  let alice: User
  let bob: User
  const vault = randomUUID()
  const mac = { id: randomUUID(), token: token() }
  const phone = { id: randomUUID(), token: token(), key: publicKey() }
  const request = randomUUID()
  const approverKey = publicKey()

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } })
    await db.exec(`
      create role anon nologin; create role authenticated nologin;
      create schema extensions; create schema auth;
      create table auth.users (id uuid primary key);
      create table auth.sessions (id uuid primary key, user_id uuid, created_at timestamptz,
        updated_at timestamptz, not_after timestamptz);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as
        $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      grant usage on schema public, auth, extensions to authenticated, anon;
      grant execute on all functions in schema auth to authenticated, anon;
    `)
    for (const file of readdirSync(migrationsPath).sort()) {
      await db.exec(readFileSync(join(migrationsPath, file), 'utf8'))
    }
    alice = await newUser()
    bob = await newUser()
    await as(alice, 'select public.create_storybound_vault($1,$2,$3,$4,$5,$6,$7,$8)', [
      vault,
      mac.id,
      'Mac',
      mac.token,
      1,
      'recovery-verifier-value-000000000000',
      'AAAAAAAAAAAAAAAA',
      'BBBBBBBBBBBBBBBBBBBBBBBB'
    ])
    await as(alice, 'select public.push_storybound_mutations($1,$2,$3,$4)', [
      vault,
      mac.id,
      mac.token,
      JSON.stringify([
        {
          mutationId: randomUUID(),
          entityType: 'library',
          entityId: 'library-1',
          operation: 'upsert',
          baseRemoteRevision: null,
          protocolVersion: 1,
          rowVersion: 1,
          changeSetId: null,
          schemaVersion: 1,
          keyVersion: 1,
          encoding: 'aes-256-gcm-v1',
          nonce: 'AAAAAAAAAAAAAAAA',
          ciphertext: 'CCCCCCCCCCCCCCCCCCCCCCCC',
          hash: 'DDDDDDDD',
          changedAt: new Date().toISOString()
        }
      ])
    ])
  })

  it('lets a signed-in device request a link to its account’s vault only', async () => {
    const response = await result<Record<string, unknown>>(alice, REQUEST, [
      request,
      phone.id,
      'Jack’s phone',
      phone.token,
      phone.key
    ])
    expect(response).toMatchObject({ vaultId: vault, keyEpoch: 1 })
    await expect(
      as(bob, REQUEST, [randomUUID(), randomUUID(), 'x', token(), publicKey()])
    ).rejects.toThrow(/Vault not found/)
  })

  it('lists pending requests only for a device holding its possession token', async () => {
    const requests = await result<Array<Record<string, unknown>>>(alice, LIST, [mac.id, mac.token])
    expect(requests).toEqual([
      expect.objectContaining({ requestId: request, requesterPublicKey: phone.key })
    ])
    await expect(as(alice, LIST, [mac.id, token()])).rejects.toThrow(/Active device not found/)
  })

  it('requires acknowledgement first, and fixes the approver key once acknowledged', async () => {
    const envelope = [1, 'NNNNNNNNNNNNNNNN', 'EEEEEEEEEEEEEEEEEEEEEEEE']
    await expect(as(alice, APPROVE, [mac.id, mac.token, request, ...envelope])).rejects.toThrow(
      /Acknowledge/
    )
    await as(alice, ACKNOWLEDGE, [mac.id, mac.token, request, approverKey])
    await as(alice, ACKNOWLEDGE, [mac.id, mac.token, request, approverKey])
    await expect(as(alice, ACKNOWLEDGE, [mac.id, mac.token, request, publicKey()])).rejects.toThrow(
      /already acknowledged/
    )
  })

  it('lets only the requesting device read its request', async () => {
    expect(await result(alice, GET, [request, phone.token])).toMatchObject({
      status: 'pending',
      approverPublicKey: approverKey,
      envelope: null
    })
    await expect(as(alice, GET, [request, token()])).rejects.toThrow(/Link request not found/)
    await expect(as(bob, GET, [request, phone.token])).rejects.toThrow(/Link request not found/)
  })

  it('registers the device and its sealed envelope on approval', async () => {
    await expect(
      as(alice, APPROVE, [mac.id, mac.token, request, 2, 'NNNNNNNNNNNNNNNN', 'EEEEEEEEEEEEEEEE'])
    ).rejects.toThrow(/Invalid key epoch/)
    expect(
      await result(alice, APPROVE, [
        mac.id,
        mac.token,
        request,
        1,
        'NNNNNNNNNNNNNNNN',
        'EEEEEEEEEEEEEEEEEEEEEEEE'
      ])
    ).toMatchObject({ deviceId: phone.id })

    const device = (
      await db.query<Record<string, unknown>>(
        'select state, display_name, device_auth_hash from public.storybound_devices where id = $1',
        [phone.id]
      )
    ).rows[0]
    expect(device).toEqual({
      state: 'active',
      display_name: 'Jack’s phone',
      device_auth_hash: createHash('sha256').update(phone.token).digest('hex')
    })
    expect(await result(alice, GET, [request, phone.token])).toMatchObject({
      status: 'approved',
      envelope: {
        kind: 'device',
        ciphertext: 'EEEEEEEEEEEEEEEEEEEEEEEE',
        recipientPublicKey: phone.key
      }
    })
    const pulled = await result<{ changes: unknown[] }>(
      alice,
      'select public.pull_storybound_changes($1,$2,$3,0,100)',
      [vault, phone.id, phone.token]
    )
    expect(pulled.changes).toHaveLength(1)
    await expect(
      as(alice, APPROVE, [mac.id, mac.token, request, 1, 'NNNNNNNNNNNNNNNN', 'EEEEEEEEEEEEEEEE'])
    ).rejects.toThrow(/Link request not found/)
    await expect(
      as(alice, REQUEST, [randomUUID(), phone.id, 'dup', token(), publicKey()])
    ).rejects.toThrow(/Device already registered/)
  })

  it('closes expired, declined, and cancelled requests', async () => {
    const expired = { request: randomUUID(), token: token() }
    const declined = { request: randomUUID(), token: token() }
    const cancelled = { request: randomUUID(), token: token() }
    for (const item of [expired, declined, cancelled]) {
      await as(alice, REQUEST, [item.request, randomUUID(), 'Phone', item.token, publicKey()])
    }
    await as(alice, ACKNOWLEDGE, [mac.id, mac.token, expired.request, publicKey()])
    await db.query(
      `update public.storybound_link_requests set expires_at = now() - interval '1 second'
       where id = $1`,
      [expired.request]
    )
    await as(alice, 'select public.decline_storybound_device_link($1,$2,$3)', [
      mac.id,
      mac.token,
      declined.request
    ])
    await as(alice, 'select public.cancel_storybound_device_link($1,$2)', [
      cancelled.request,
      cancelled.token
    ])

    const listed = await result<Array<{ requestId: string }>>(alice, LIST, [mac.id, mac.token])
    expect(listed.map((item) => item.requestId)).toEqual([])
    expect(await result(alice, GET, [expired.request, expired.token])).toMatchObject({
      status: 'expired'
    })
    expect(await result(alice, GET, [declined.request, declined.token])).toMatchObject({
      status: 'declined'
    })
    expect(await result(alice, GET, [cancelled.request, cancelled.token])).toMatchObject({
      status: 'cancelled'
    })
    await expect(
      as(alice, APPROVE, [
        mac.id,
        mac.token,
        expired.request,
        1,
        'NNNNNNNNNNNNNNNN',
        'EEEEEEEEEEEEEEEE'
      ])
    ).rejects.toThrow(/Link request not found/)
  })

  it('limits pending requests and refuses signed-out callers and direct access', async () => {
    for (let index = 0; index < 3; index += 1) {
      await as(alice, REQUEST, [randomUUID(), randomUUID(), `P${index}`, token(), publicKey()])
    }
    await expect(
      as(alice, REQUEST, [randomUUID(), randomUUID(), 'Too many', token(), publicKey()])
    ).rejects.toThrow(/Too many pending/)
    await expect(
      as({ id: alice.id, session: randomUUID() }, LIST, [mac.id, mac.token])
    ).rejects.toThrow(/session is not active/)
    await expect(as(alice, 'select * from public.storybound_link_requests')).rejects.toThrow(
      /permission denied/
    )
    await expect(
      as(alice, 'select public.storybound_require_active_device($1,$2)', [mac.id, mac.token])
    ).rejects.toThrow(/permission denied/)
  })
})
