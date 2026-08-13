begin;
select plan(32);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'authenticated', 'authenticated', 'reader@example.test', 'not-used', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

set local role postgres;
insert into auth.sessions (id, user_id, created_at, updated_at)
values (
  '99999999-9999-4999-8999-999999999999',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', now(), now()
);
set local role authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select set_config('request.jwt.claim.session_id', '99999999-9999-4999-8999-999999999999', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","session_id":"99999999-9999-4999-8999-999999999999"}',
  true
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.storybound_vaults'::regclass),
  'vaults enforce RLS'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.storybound_vaults'::regclass
      and attname = 'recovery_verifier' and not attisdropped
  ),
  'the final schema includes recovery verification metadata'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.storybound_devices'::regclass
      and attname = 'session_id' and not attisdropped
  ),
  'the final schema includes authentication-session metadata'
);

select is(
  to_regprocedure('public.create_storybound_vault(uuid,uuid,text,integer,text,text,text)'),
  null,
  'the insecure legacy create-vault overload is removed'
);
select is(
  to_regprocedure('public.create_storybound_vault(uuid,uuid,text,integer,text,text)'),
  null,
  'the originally deployed create-vault overload is removed'
);
select is(
  to_regprocedure('public.register_storybound_device(uuid,uuid,text)'),
  null,
  'the originally deployed register-device overload is removed'
);
select is(
  to_regprocedure('public.register_storybound_device(uuid,uuid,text,text)'),
  null,
  'the interim register-device overload is removed'
);
select is(
  to_regprocedure('public.push_storybound_mutations(uuid,uuid,jsonb)'),
  null,
  'the tokenless push overload is removed'
);
select is(
  to_regprocedure('public.pull_storybound_changes(uuid,bigint,integer)'),
  null,
  'the originally deployed pull overload is removed'
);
select is(
  to_regprocedure('public.pull_storybound_changes(uuid,uuid,bigint,integer)'),
  null,
  'the interim pull overload is removed'
);
select is(
  to_regprocedure('public.revoke_storybound_device(uuid)'),
  null,
  'the insecure legacy revoke-device overload is removed'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.storybound_changes'::regclass),
  'encrypted changes enforce RLS'
);

select is(
  (public.create_storybound_vault(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'Test Mac', 'device-token-cccccccccccccccccccccccccccccccc',
    1, 'recovery-verifier-value-000000000000',
    'AAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBBBBBBBBBB'
  )->>'vaultId'),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'an authenticated owner can create a vault'
);

select is(
  (public.get_storybound_bootstrap()->'devices'->0->>'displayName'),
  'Test Mac',
  'bootstrap returns the owner device'
);

select is(
  (public.push_storybound_mutations(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'device-token-cccccccccccccccccccccccccccccccc',
    jsonb_build_array(jsonb_build_object(
      'mutationId', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'entityType', 'chapter', 'entityId', 'chapter-1', 'operation', 'upsert',
      'baseRemoteRevision', null, 'protocolVersion', 1, 'rowVersion', 1,
      'changeSetId', null, 'schemaVersion', 1, 'keyVersion', 1,
      'encoding', 'aes-256-gcm-v1', 'nonce', 'AAAAAAAAAAAAAAAA',
      'ciphertext', 'CCCCCCCCCCCCCCCCCCCCCCCC', 'hash', 'DDDDDDDD',
      'changedAt', '2026-08-06T20:00:00.000Z'
    ))
  )->0->>'status'),
  'accepted',
  'the first encrypted entity mutation is accepted'
);

select is(
  (public.push_storybound_mutations(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'device-token-cccccccccccccccccccccccccccccccc',
    jsonb_build_array(jsonb_build_object(
      'mutationId', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'entityType', 'chapter', 'entityId', 'chapter-1', 'operation', 'upsert',
      'baseRemoteRevision', null, 'protocolVersion', 1, 'rowVersion', 1,
      'changeSetId', null, 'schemaVersion', 1, 'keyVersion', 1,
      'encoding', 'aes-256-gcm-v1', 'nonce', 'AAAAAAAAAAAAAAAA',
      'ciphertext', 'CCCCCCCCCCCCCCCCCCCCCCCC', 'hash', 'DDDDDDDD',
      'changedAt', '2026-08-06T20:00:00.000Z'
    ))
  )->0->>'duplicate'),
  'true',
  'mutation identifiers are idempotent'
);

select is(
  (public.push_storybound_mutations(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'device-token-cccccccccccccccccccccccccccccccc',
    jsonb_build_array(jsonb_build_object(
      'mutationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'entityType', 'chapter', 'entityId', 'chapter-1', 'operation', 'upsert',
      'baseRemoteRevision', null, 'protocolVersion', 1, 'rowVersion', 2,
      'changeSetId', null, 'schemaVersion', 1, 'keyVersion', 1,
      'encoding', 'aes-256-gcm-v1', 'nonce', 'EEEEEEEEEEEEEEEE',
      'ciphertext', 'FFFFFFFFFFFFFFFFFFFFFFFF', 'hash', 'GGGGGGGG',
      'changedAt', '2026-08-06T20:01:00.000Z'
    ))
  )->0->>'status'),
  'conflict',
  'stale base revisions produce a conflict'
);

select is(
  result->>'nextCursor',
  result->'changes'->0->>'remoteRevision',
  'pull returns the newest opaque monotonic cursor'
)
from (
  select public.pull_storybound_changes(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'device-token-cccccccccccccccccccccccccccccccc', 0, 100
  ) as result
) pulled;

select is(
  (public.pull_storybound_changes(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'device-token-cccccccccccccccccccccccccccccccc', 0, 100
  )->'changes'->0->'payload'->>'ciphertext'),
  'CCCCCCCCCCCCCCCCCCCCCCCC',
  'pull returns the encrypted payload unchanged'
);

select throws_ok(
  $$select public.push_storybound_mutations(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'device-token-cccccccccccccccccccccccccccccccc',
    jsonb_build_array(jsonb_build_object(
      'mutationId', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'entityType', 'chapter', 'entityId', 'chapter-1', 'operation', 'upsert',
      'baseRemoteRevision', null, 'protocolVersion', 1, 'rowVersion', 1,
      'changeSetId', null, 'schemaVersion', 1, 'keyVersion', 1,
      'encoding', 'aes-256-gcm-v1', 'nonce', 'AAAAAAAAAAAAAAAA',
      'ciphertext', 'A-DIFFERENT-CIPHERTEXT', 'hash', 'DIFFERENT',
      'changedAt', '2026-08-06T20:00:00.000Z'
    ))
  )$$,
  'P0001',
  'Mutation identifier reused with different content',
  'a mutation ID cannot acknowledge different ciphertext'
);

select throws_ok(
  $$select public.push_storybound_mutations(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'device-token-cccccccccccccccccccccccccccccccc',
    jsonb_build_array(jsonb_build_object(
      'mutationId', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'entityType', 'chapter', 'entityId', 'chapter-1', 'operation', 'upsert',
      'baseRemoteRevision', null, 'protocolVersion', 1, 'rowVersion', 2,
      'changeSetId', 'changed-set', 'schemaVersion', 1, 'keyVersion', 1,
      'encoding', 'aes-256-gcm-v1', 'nonce', 'AAAAAAAAAAAAAAAA',
      'ciphertext', 'CCCCCCCCCCCCCCCCCCCCCCCC', 'hash', 'DDDDDDDD',
      'changedAt', '2026-08-06T20:00:01.000Z'
    ))
  )$$,
  'P0001',
  'Mutation identifier reused with different content',
  'a mutation ID cannot acknowledge changed immutable metadata'
);

select throws_ok(
  $$select public.register_storybound_device(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'Unproved phone', 'device-token-ffffffffffffffffffffffffffffffff',
    'wrong-recovery-proof'
  )$$,
  'P0001',
  'Vault not found',
  'a new device must prove knowledge of the recovery code'
);

select throws_ok(
  $$select public.revoke_storybound_device(
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'device-token-ffffffffffffffffffffffffffffffff',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  )$$,
  'P0001',
  'Active device not found',
  'an unregistered account session cannot revoke a device'
);

select throws_ok(
  $$select public.rotate_storybound_recovery_envelope(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'device-token-cccccccccccccccccccccccccccccccc',
    'short',
    'GGGGGGGGGGGGGGGG', 'HHHHHHHHHHHHHHHHHHHHHHHH'
  )$$,
  'P0001',
  'Invalid recovery verifier',
  'rotation rejects an undersized recovery verifier'
);

select is(
  (public.rotate_storybound_recovery_envelope(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'device-token-cccccccccccccccccccccccccccccccc',
    'rotated-recovery-verifier-value-0000',
    'GGGGGGGGGGGGGGGG', 'HHHHHHHHHHHHHHHHHHHHHHHH'
  )->>'vaultId'),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'an unlocked device can rotate the recovery envelope'
);

select throws_ok(
  $$select public.register_storybound_device(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'Stale phone', 'device-token-ffffffffffffffffffffffffffffffff',
    'recovery-verifier-value-000000000000'
  )$$,
  'P0001',
  'Vault not found',
  'the old recovery code stops working once the envelope is rotated'
);

select is(
  (public.register_storybound_device(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'Fresh phone', 'device-token-ffffffffffffffffffffffffffffffff',
    'rotated-recovery-verifier-value-0000'
  )->'recoveryEnvelope'->>'ciphertext'),
  'HHHHHHHHHHHHHHHHHHHHHHHH',
  'the new recovery code unlocks the vault with the rotated envelope'
);

select throws_ok(
  $$select public.rotate_storybound_recovery_envelope(
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'wrong-device-token-value-000000000000',
    'another-verifier-value-0000000000000',
    'IIIIIIIIIIIIIIII', 'JJJJJJJJJJJJJJJJJJJJJJJJ'
  )$$,
  'P0001',
  'Active device not found',
  'rotation requires proof of possession of an active device token'
);

set local role postgres;
insert into auth.sessions (id, user_id, created_at, updated_at)
values (
  '88888888-8888-4888-8888-888888888888',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', now(), now()
);
set local role authenticated;
select set_config('request.jwt.claim.session_id', '88888888-8888-4888-8888-888888888888', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","session_id":"88888888-8888-4888-8888-888888888888"}',
  true
);

select is(
  (public.pull_storybound_changes(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'device-token-cccccccccccccccccccccccccccccccc', 0, 100
  )->'changes'->0->>'mutationId'),
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'a device possession token safely rebinds after a normal new sign-in'
);

set local role postgres;
delete from auth.sessions where id = '88888888-8888-4888-8888-888888888888';
set local role authenticated;
select throws_ok(
  $$select public.get_storybound_bootstrap()$$,
  'P0001',
  'Authentication session is not active',
  'a deleted authentication session cannot reuse its unexpired access token'
);

set local role postgres;
insert into auth.sessions (id, user_id, created_at, updated_at)
values (
  '77777777-7777-4777-8777-777777777777',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', now(), now()
);
set local role authenticated;
select set_config('request.jwt.claim.session_id', '77777777-7777-4777-8777-777777777777', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","session_id":"77777777-7777-4777-8777-777777777777"}',
  true
);

select throws_ok(
  $$select public.revoke_storybound_device(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'device-token-cccccccccccccccccccccccccccccccc',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  )$$,
  'P0001',
  'The active device cannot revoke itself',
  'the server rejects self-revocation'
);

set local role postgres;
insert into public.storybound_devices (
  id, vault_id, owner_id, display_name, session_id, device_auth_hash
) values (
  '66666666-6666-4666-8666-666666666666',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Test phone', '77777777-7777-4777-8777-777777777777',
  encode(extensions.digest('device-token-66666666666666666666666666666666', 'sha256'), 'hex')
);
set local role authenticated;

select public.revoke_storybound_device(
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'device-token-cccccccccccccccccccccccccccccccc',
  '66666666-6666-4666-8666-666666666666'
);
select throws_ok(
  $$select public.pull_storybound_changes(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '66666666-6666-4666-8666-666666666666',
    'device-token-66666666666666666666666666666666', 0, 100
  )$$,
  'P0001',
  'Active device not found',
  'a revoked device cannot pull later ciphertext'
);

select * from finish();
rollback;
