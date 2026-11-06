begin;
select plan(38);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'authenticated', 'authenticated', 'admin@example.test', 'not-used', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'authenticated', 'authenticated', 'author@example.test', 'not-used', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   'authenticated', 'authenticated', 'reader@example.test', 'not-used', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now());

insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('a1111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', now(), now()),
  ('b1111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', now(), now()),
  ('c1111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', now(), now());

insert into public.storybound_admins (owner_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

insert into storage.objects (bucket_id, name) values
  ('bookstore-books', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/one.json'),
  ('bookstore-books', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/two.json'),
  ('bookstore-books', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/three.json');

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

create function pg_temp.as_admin() returns void language sql as $$
  select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a1111111-1111-4111-8111-111111111111');
$$;
create function pg_temp.as_author() returns void language sql as $$
  select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b1111111-1111-4111-8111-111111111111');
$$;
create function pg_temp.as_reader() returns void language sql as $$
  select pg_temp.act_as('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c1111111-1111-4111-8111-111111111111');
$$;
grant execute on function pg_temp.as_admin() to authenticated;
grant execute on function pg_temp.as_author() to authenticated;
grant execute on function pg_temp.as_reader() to authenticated;

create function pg_temp.submit(listing uuid, source uuid, title text, file text) returns jsonb
language sql as $$
  select public.submit_storybound_version(
    listing, source, title, '', 'A book long enough to have a proper blurb.', 'fantasy',
    array['violence'], 'assisted', 'en', 3, 900, 'classic', null,
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/' || file, repeat('a', 64), 2000
  );
$$;
grant execute on function pg_temp.submit(uuid, uuid, text, text) to authenticated;

set local role authenticated;

select throws_ok(
  $$select * from public.storybound_store_listings$$,
  '42501', null, 'nobody can read listings directly'
);
select throws_ok(
  $$select * from public.storybound_store_versions$$,
  '42501', null, 'nobody can read versions directly'
);
select throws_ok(
  $$select * from public.storybound_admins$$,
  '42501', null, 'nobody can see who the admins are'
);
select throws_ok(
  $$update public.storybound_settings set value = 'false'$$,
  '42501', null, 'nobody can change the settings'
);
select throws_ok(
  $$select public.storybound_has_plus()$$,
  '42501', null, 'internal rules are not callable'
);

select pg_temp.as_reader();
select throws_ok(
  $$select public.browse_storybound_store()$$,
  null, 'Accept the Bookstore terms first', 'browsing needs the terms accepted'
);
select throws_ok(
  $$select public.join_storybound_store(99)$$,
  null, 'The Bookstore terms have changed', 'an out-of-date app cannot accept new terms'
);
select lives_ok($$select public.join_storybound_store(1)$$, 'a reader joins');
select is(
  (public.get_storybound_store_profile()->>'joined')::boolean, true, 'the reader has joined'
);
select is(
  (public.get_storybound_store_profile()->>'isAdmin')::boolean, false, 'the reader is no admin'
);

select pg_temp.as_author();
select public.join_storybound_store(1);
select throws_ok(
  $$select pg_temp.submit(gen_random_uuid(), gen_random_uuid(), 'No Name', 'one.json')$$,
  null, 'Choose a pen name first', 'publishing needs a pen name'
);
select lives_ok($$select public.set_storybound_pen_name('A. Writer')$$, 'the author takes a name');

select pg_temp.as_reader();
select throws_ok(
  $$select public.set_storybound_pen_name(' a. WRITER ')$$,
  null, 'That pen name is taken', 'two people cannot share a pen name'
);

select pg_temp.as_author();
select throws_ok(
  $$select public.submit_storybound_version(
    gen_random_uuid(), gen_random_uuid(), 'Stolen', '', 'A book long enough to have a blurb.',
    'fantasy', '{}', 'none', 'en', 1, 10, 'classic', null,
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc/x.json', repeat('a', 64), 2000
  )$$,
  null, 'That file has not been uploaded', 'an author can only submit their own files'
);
select lives_ok(
  $$select pg_temp.submit(
    '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    'The Salt Road', 'one.json'
  )$$,
  'the author submits a book'
);
select throws_ok(
  $$select pg_temp.submit(gen_random_uuid(), gen_random_uuid(), 'Another', 'two.json')$$,
  null, 'You can publish one new book a week', 'one new book a week'
);
select is(
  public.storybound_can_read_book('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/one.json'), true,
  'the author can read their pending book'
);

select pg_temp.as_reader();
select is(
  public.storybound_can_read_book('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/one.json'), false,
  'a stranger cannot read a pending book'
);
select is(
  public.browse_storybound_store()->'items', '[]'::jsonb, 'a pending book is not in the store'
);
select throws_ok(
  $$select public.get_storybound_listing('11111111-1111-4111-8111-111111111111')$$,
  null, 'That book is not in the Bookstore', 'a pending book has no public page'
);
select throws_ok(
  $$select public.add_storybound_book('11111111-1111-4111-8111-111111111111')$$,
  null, 'That book is not in the Bookstore', 'a pending book cannot be added'
);
select throws_ok(
  $$select public.review_storybound_version('11111111-1111-4111-8111-111111111111', 1, true, '')$$,
  null, 'Not allowed', 'a reader cannot approve books'
);
select throws_ok(
  $$select public.list_storybound_review_queue()$$,
  null, 'Not allowed', 'a reader cannot see the review queue'
);

select pg_temp.as_author();
select throws_ok(
  $$select public.review_storybound_version('11111111-1111-4111-8111-111111111111', 1, true, '')$$,
  null, 'Not allowed', 'an author cannot approve their own book'
);

select pg_temp.as_admin();
select is(
  jsonb_array_length(public.list_storybound_review_queue()), 1, 'the admin sees the queue'
);
select is(
  public.storybound_can_read_book('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/one.json'), true,
  'the admin can read a pending book'
);
select throws_ok(
  $$select public.review_storybound_version('11111111-1111-4111-8111-111111111111', 1, false, ' ')$$,
  null, 'Say why it was not approved', 'a rejection needs a reason'
);
select lives_ok(
  $$select public.review_storybound_version('11111111-1111-4111-8111-111111111111', 1, true, '')$$,
  'the admin approves the book'
);

select pg_temp.as_reader();
select is(
  public.browse_storybound_store('salt')->'items'->0->>'title', 'The Salt Road',
  'the approved book can be found'
);
select is(
  public.browse_storybound_store('', 'horror')->'items', '[]'::jsonb, 'genres filter the store'
);
select is(
  public.add_storybound_book('11111111-1111-4111-8111-111111111111')->>'version', '1',
  'a reader adds the book'
);
select public.add_storybound_book('11111111-1111-4111-8111-111111111111');
select is(
  (public.get_storybound_listing('11111111-1111-4111-8111-111111111111')->>'addCount')::integer, 1,
  'adding twice counts once'
);
select is(
  public.storybound_can_read_book('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/one.json'), true,
  'a member can read the live version'
);

-- A new version waits for review, while readers keep the old one.
select pg_temp.as_author();
select pg_temp.submit(
  gen_random_uuid(), '22222222-2222-4222-8222-222222222222', 'The Salt Road, revised', 'two.json'
);
select pg_temp.as_reader();
select is(
  public.storybound_can_read_book('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/two.json'), false,
  'an unreviewed update stays private'
);
select is(
  public.check_storybound_books(array['11111111-1111-4111-8111-111111111111'::uuid])->0->>'version',
  '1', 'readers are still on the approved version'
);

-- The paywall, once it is turned on, closes the store to anyone without Plus.
reset role;
update public.storybound_settings set value = 'true' where key = 'paywall_enabled';
set local role authenticated;
select pg_temp.as_reader();
select is(
  public.storybound_can_read_book('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/one.json'), false,
  'with the paywall on, a free account cannot read a book'
);
reset role;
insert into public.storybound_access (owner_id, plan, source)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'plus', 'comp');
set local role authenticated;
select pg_temp.as_reader();
select is(
  public.storybound_can_read_book('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/one.json'), true,
  'a tester with free Plus can'
);
reset role;
update public.storybound_settings set value = 'false' where key = 'paywall_enabled';
set local role authenticated;

-- Removal reaches readers' copies.
select pg_temp.as_admin();
select public.remove_storybound_listing(
  '11111111-1111-4111-8111-111111111111', 'It broke the content rules.'
);
select pg_temp.as_reader();
select is(
  public.check_storybound_books(array['11111111-1111-4111-8111-111111111111'::uuid])->0->>'status',
  'removed', 'the app learns a book was removed'
);

select * from finish();
rollback;
