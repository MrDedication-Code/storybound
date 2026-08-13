import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const url = process.env.STORYBOUND_SUPABASE_URL
const key = process.env.STORYBOUND_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) throw new Error('Set the local Supabase URL and publishable key first.')

const email = `storybound-sync-${randomUUID()}@example.test`
const password = `Storybound-${randomUUID()}!`
const first = createClient(url, key, { auth: { persistSession: false } })
const second = createClient(url, key, { auth: { persistSession: false } })
const vaultId = randomUUID()
const firstDeviceId = randomUUID()
const secondDeviceId = randomUUID()
const firstDeviceToken = Buffer.from(randomUUID()).toString('base64url')
const secondDeviceToken = Buffer.from(randomUUID()).toString('base64url')
const recoveryVerifier = Buffer.from(randomUUID()).toString('base64')

const signedUp = await first.auth.signUp({ email, password })
if (signedUp.error || !signedUp.data.session) throw signedUp.error ?? new Error('No first session')
const created = await first.rpc('create_storybound_vault', {
  p_vault_id: vaultId,
  p_device_id: firstDeviceId,
  p_device_name: 'Concurrency test A',
  p_device_token: firstDeviceToken,
  p_key_epoch: 1,
  p_recovery_verifier: recoveryVerifier,
  p_recovery_nonce: 'AAAAAAAAAAAAAAAA',
  p_recovery_ciphertext: 'BBBBBBBBBBBBBBBBBBBBBBBB'
})
if (created.error) throw created.error

const signedIn = await second.auth.signInWithPassword({ email, password })
if (signedIn.error || !signedIn.data.session) throw signedIn.error ?? new Error('No second session')
const registered = await second.rpc('register_storybound_device', {
  p_vault_id: vaultId,
  p_device_id: secondDeviceId,
  p_device_name: 'Concurrency test B',
  p_device_token: secondDeviceToken,
  p_recovery_verifier: recoveryVerifier
})
if (registered.error) throw registered.error

// This executable JavaScript runs directly under Node; TypeScript return annotations are invalid here.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function mutation(mutationId, ciphertext) {
  return {
    mutationId,
    entityType: 'chapter',
    entityId: 'same-new-entity',
    operation: 'upsert',
    baseRemoteRevision: null,
    protocolVersion: 1,
    rowVersion: 1,
    changeSetId: null,
    schemaVersion: 1,
    keyVersion: 1,
    encoding: 'aes-256-gcm-v1',
    nonce: 'AAAAAAAAAAAAAAAA',
    ciphertext,
    hash: Buffer.from(ciphertext).toString('base64'),
    changedAt: new Date().toISOString()
  }
}

const mutationA = mutation(randomUUID(), 'AAAAAAAAAAAAAAAAAAAAAAAA')
const mutationB = mutation(randomUUID(), 'BBBBBBBBBBBBBBBBBBBBBBBB')
const [pushA, pushB] = await Promise.all([
  first.rpc('push_storybound_mutations', {
    p_vault_id: vaultId,
    p_device_id: firstDeviceId,
    p_device_token: firstDeviceToken,
    p_mutations: [mutationA]
  }),
  second.rpc('push_storybound_mutations', {
    p_vault_id: vaultId,
    p_device_id: secondDeviceId,
    p_device_token: secondDeviceToken,
    p_mutations: [mutationB]
  })
])
if (pushA.error) throw pushA.error
if (pushB.error) throw pushB.error
const statuses = [pushA.data?.[0]?.status, pushB.data?.[0]?.status].sort()
if (statuses.join(',') !== 'accepted,conflict') {
  throw new Error(`Concurrent create CAS failed: ${statuses.join(',')}`)
}

const firstAccepted = pushA.data?.[0]?.status === 'accepted'
const acceptedClient = firstAccepted ? first : second
const acceptedDeviceId = firstAccepted ? firstDeviceId : secondDeviceId
const acceptedDeviceToken = firstAccepted ? firstDeviceToken : secondDeviceToken
const acceptedMutation = firstAccepted ? mutationA : mutationB

const mismatchedRetry = await acceptedClient.rpc('push_storybound_mutations', {
  p_vault_id: vaultId,
  p_device_id: acceptedDeviceId,
  p_device_token: acceptedDeviceToken,
  p_mutations: [
    {
      ...acceptedMutation,
      changedAt: new Date(Date.parse(acceptedMutation.changedAt) + 1000).toISOString(),
      rowVersion: 2,
      changeSetId: randomUUID()
    }
  ]
})
if (!mismatchedRetry.error) {
  throw new Error('A mutation retry with changed immutable metadata was incorrectly acknowledged.')
}

const unregistered = createClient(url, key, { auth: { persistSession: false } })
const thirdSignIn = await unregistered.auth.signInWithPassword({ email, password })
if (thirdSignIn.error) throw thirdSignIn.error
const unauthorizedRevoke = await unregistered.rpc('revoke_storybound_device', {
  p_actor_device_id: randomUUID(),
  p_actor_device_token: Buffer.from(randomUUID()).toString('base64url'),
  p_target_device_id: secondDeviceId
})
if (!unauthorizedRevoke.error) {
  throw new Error('An unregistered account session revoked a registered device.')
}

const staleSession = signedUp.data.session
const signedOut = await first.auth.signOut({ scope: 'local' })
if (signedOut.error) throw signedOut.error
const staleBootstrap = await fetch(`${url}/rest/v1/rpc/get_storybound_bootstrap`, {
  method: 'POST',
  headers: {
    apikey: key,
    Authorization: `Bearer ${staleSession.access_token}`,
    'Content-Type': 'application/json'
  },
  body: '{}'
})
if (staleBootstrap.ok) {
  throw new Error('A server-revoked authentication session could still access sync RPCs.')
}

const signedBackIn = await first.auth.signInWithPassword({ email, password })
if (signedBackIn.error) throw signedBackIn.error
const reboundPull = await first.rpc('pull_storybound_changes', {
  p_vault_id: vaultId,
  p_device_id: firstDeviceId,
  p_device_token: firstDeviceToken,
  p_cursor: '0',
  p_limit: 100
})
if (reboundPull.error) throw reboundPull.error

const revoked = await first.rpc('revoke_storybound_device', {
  p_actor_device_id: firstDeviceId,
  p_actor_device_token: firstDeviceToken,
  p_target_device_id: secondDeviceId
})
if (revoked.error) throw revoked.error
const revokedPull = await second.rpc('pull_storybound_changes', {
  p_vault_id: vaultId,
  p_device_id: secondDeviceId,
  p_device_token: secondDeviceToken,
  p_cursor: '0',
  p_limit: 100
})
if (!revokedPull.error) throw new Error('A revoked device could still pull encrypted changes.')

console.log('Encrypted sync concurrency, session, idempotency, and revocation checks passed.')
