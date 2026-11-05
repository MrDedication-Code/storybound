begin;
select plan(17);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'authenticated', 'authenticated', 'jack@example.test', 'not-used', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'authenticated', 'authenticated', 'adam@example.test', 'not-used', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   'authenticated', 'authenticated', 'stranger@example.test', 'not-used', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now());

insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('a1111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', now(), now()),
  ('b1111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', now(), now()),
  ('c1111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', now(), now());

insert into public.storybound_vaults (id, owner_id, key_epoch, recovery_verifier) values
  ('a2222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1, repeat('a', 32)),
  ('b2222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 1, repeat('b', 32)),
  ('c2222222-2222-4222-8222-222222222222', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 1, repeat('c', 32));

insert into public.storybound_devices (
  id, vault_id, owner_id, display_name, session_id, device_auth_hash
) values
  ('a3333333-3333-4333-8333-333333333333', 'a2222222-2222-4222-8222-222222222222',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Jack Mac', 'a1111111-1111-4111-8111-111111111111',
   encode(extensions.digest('token-a', 'sha256'), 'hex')),
  ('b3333333-3333-4333-8333-333333333333', 'b2222222-2222-4222-8222-222222222222',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Adam PC', 'b1111111-1111-4111-8111-111111111111',
   encode(extensions.digest('token-b', 'sha256'), 'hex')),
  ('c3333333-3333-4333-8333-333333333333', 'c2222222-2222-4222-8222-222222222222',
   'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Stranger', 'c1111111-1111-4111-8111-111111111111',
   encode(extensions.digest('token-c', 'sha256'), 'hex'));

create function pg_temp.act_as(user_id uuid, session_id uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', user_id::text, true);
  perform set_config('request.jwt.claim.session_id', session_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', user_id, 'session_id', session_id)::text,
    true
  );
end;
$$;
grant execute on function pg_temp.act_as(uuid, uuid) to authenticated;

set local role authenticated;

select ok(
  (select relrowsecurity from pg_class where oid = 'public.storybound_parcels'::regclass),
  'parcels enforce RLS'
);
select throws_ok(
  $$select * from public.storybound_parcels$$,
  '42501', null, 'nobody can read the parcels table directly'
);
select throws_ok(
  $$select * from public.storybound_share_addresses$$,
  '42501', null, 'nobody can browse addresses'
);

select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b1111111-1111-4111-8111-111111111111');
select lives_ok(
  $$select public.publish_storybound_address(
    'b3333333-3333-4333-8333-333333333333', 'token-b', 'BBBBCCCCDDDDEEEE',
    repeat('e', 44), repeat('s', 44)
  )$$,
  'a device publishes its address'
);
select lives_ok(
  $$select public.publish_storybound_address(
    'b3333333-3333-4333-8333-333333333333', 'token-b', 'BBBBCCCCDDDDEEEE',
    repeat('e', 44), repeat('s', 44)
  )$$,
  'publishing again is harmless'
);
select throws_ok(
  $$select public.publish_storybound_address(
    'b3333333-3333-4333-8333-333333333333', 'wrong-token', 'BBBBCCCCDDDDEEEF',
    repeat('e', 44), repeat('s', 44)
  )$$,
  'Active device not found', 'a wrong device token cannot publish'
);

select pg_temp.act_as('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c1111111-1111-4111-8111-111111111111');
select throws_ok(
  $$select public.publish_storybound_address(
    'c3333333-3333-4333-8333-333333333333', 'token-c', 'BBBBCCCCDDDDEEEE',
    repeat('x', 44), repeat('y', 44)
  )$$,
  'Address already in use', 'nobody can take over an address'
);

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a1111111-1111-4111-8111-111111111111');
select is(
  public.find_storybound_address(
    'a3333333-3333-4333-8333-333333333333', 'token-a', 'BBBBCCCCDDDDEEEE'
  )->>'encryptionPublicKey',
  repeat('e', 44),
  'an exact address finds its keys'
);
select is(
  public.find_storybound_address(
    'a3333333-3333-4333-8333-333333333333', 'token-a', 'ZZZZZZZZZZZZZZZZ'
  ),
  null,
  'an unknown address finds nothing'
);
select lives_ok(
  $$select public.send_storybound_parcel(
    'a3333333-3333-4333-8333-333333333333', 'token-a', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'BBBBCCCCDDDDEEEE', repeat('l', 32), repeat('b', 32)
  )$$,
  'a parcel can be sent'
);
select is(
  (public.send_storybound_parcel(
    'a3333333-3333-4333-8333-333333333333', 'token-a', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'BBBBCCCCDDDDEEEE', repeat('l', 32), repeat('b', 32)
  )->>'duplicate')::boolean,
  true,
  'sending the same parcel twice keeps one copy'
);

select pg_temp.act_as('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c1111111-1111-4111-8111-111111111111');
select is(
  jsonb_array_length(public.list_storybound_parcels(
    'c3333333-3333-4333-8333-333333333333', 'token-c'
  )),
  0,
  'a stranger sees no parcels'
);
select throws_ok(
  $$select public.get_storybound_parcel(
    'c3333333-3333-4333-8333-333333333333', 'token-c', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  )$$,
  'Parcel not found', 'a stranger cannot fetch a parcel'
);
select public.delete_storybound_parcel(
  'c3333333-3333-4333-8333-333333333333', 'token-c', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
);

select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b1111111-1111-4111-8111-111111111111');
select is(
  jsonb_array_length(public.list_storybound_parcels(
    'b3333333-3333-4333-8333-333333333333', 'token-b'
  )),
  1,
  'a stranger could not delete it, and the recipient sees it'
);
select is(
  public.get_storybound_parcel(
    'b3333333-3333-4333-8333-333333333333', 'token-b', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  ),
  repeat('b', 32),
  'the recipient can fetch it'
);
select public.delete_storybound_parcel(
  'b3333333-3333-4333-8333-333333333333', 'token-b', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
);
select is(
  jsonb_array_length(public.list_storybound_parcels(
    'b3333333-3333-4333-8333-333333333333', 'token-b'
  )),
  0,
  'an accepted parcel is gone from the server'
);

reset role;
select is(
  (select count(*)::integer from public.storybound_parcels),
  0,
  'nothing is left behind'
);

select * from finish();
rollback;
