-- The Bookstore: books people publish for anyone with an account to read. Unlike sync and parcels,
-- nothing here is encrypted, because a published book is public: browsing, review and reading all
-- need to see it. Apps only ever reach these tables through the functions below.
--
-- A book's file lives in a private bucket. One function, storybound_can_read_book, decides who may
-- download it. The access tables at the end are dormant while the paywall setting is off.

create table public.storybound_store_members (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  pen_name text check (pen_name is null or char_length(btrim(pen_name)) between 2 and 60),
  terms_version integer not null check (terms_version >= 1),
  adult_confirmed_at timestamptz not null,
  suspended_at timestamptz,
  suspension_reason text check (suspension_reason is null or char_length(suspension_reason) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index storybound_store_members_pen_name_idx
  on public.storybound_store_members (lower(btrim(pen_name))) where pen_name is not null;

create table public.storybound_store_listings (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_book_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'live', 'rejected', 'withdrawn', 'removed')),
  live_version integer,
  add_count integer not null default 0 check (add_count >= 0),
  removal_reason text check (removal_reason is null or char_length(removal_reason) <= 2000),
  search tsvector,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (owner_id, source_book_id)
);

create index storybound_store_listings_browse_idx
  on public.storybound_store_listings (status, published_at desc);
create index storybound_store_listings_popular_idx
  on public.storybound_store_listings (status, add_count desc);
create index storybound_store_listings_search_idx
  on public.storybound_store_listings using gin (search);

create table public.storybound_store_versions (
  listing_id uuid not null references public.storybound_store_listings(id) on delete cascade,
  version integer not null check (version >= 1),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'superseded')),
  title text not null check (char_length(btrim(title)) between 1 and 240),
  subtitle text not null default '' check (char_length(subtitle) <= 240),
  author_name text not null check (char_length(author_name) between 2 and 60),
  blurb text not null check (char_length(btrim(blurb)) between 20 and 4000),
  genre text not null check (genre in (
    'fantasy', 'science-fiction', 'romance', 'thriller', 'mystery', 'horror', 'historical',
    'literary', 'adventure', 'comedy', 'other'
  )),
  content_warnings text[] not null default '{}'
    check (content_warnings <@ array[
      'violence', 'sexual-themes', 'strong-language', 'self-harm', 'abuse', 'drug-use', 'death'
    ]::text[]),
  ai_use text not null check (ai_use in ('none', 'assisted', 'generated')),
  language_code text not null default 'en' check (char_length(language_code) between 2 and 40),
  chapter_count integer not null check (chapter_count between 1 and 5000),
  word_count integer not null check (word_count between 1 and 10000000),
  cover_style text not null default 'classic',
  cover_thumb text check (cover_thumb is null or char_length(cover_thumb) <= 200000),
  file_path text not null unique check (char_length(file_path) <= 200),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_bytes integer not null check (file_bytes between 16 and 31457280),
  review_reason text check (review_reason is null or char_length(review_reason) <= 2000),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  submitted_at timestamptz not null default now(),
  primary key (listing_id, version)
);

create index storybound_store_versions_queue_idx
  on public.storybound_store_versions (status, submitted_at);

create table public.storybound_store_adds (
  listing_id uuid not null references public.storybound_store_listings(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (listing_id, owner_id)
);

create table public.storybound_store_reports (
  id uuid primary key,
  listing_id uuid not null references public.storybound_store_listings(id) on delete cascade,
  reporter_id uuid references auth.users(id) on delete set null,
  reason text not null
    check (reason in ('illegal', 'sexual', 'copyright', 'hate', 'spam', 'other')),
  detail text not null default '' check (char_length(detail) <= 2000),
  outcome text check (outcome is null or char_length(outcome) <= 2000),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (listing_id, reporter_id)
);

create table public.storybound_admins (
  owner_id uuid primary key references auth.users(id) on delete cascade
);

-- Dormant until the paywall setting is turned on.
create table public.storybound_access (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'plus')),
  source text not null default 'comp' check (source in ('comp', 'paddle', 'play')),
  ends_at timestamptz,
  kokoro_owned boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.storybound_settings (
  key text primary key,
  value jsonb not null
);

insert into public.storybound_settings (key, value) values
  ('paywall_enabled', 'false'::jsonb),
  ('store_terms_version', '1'::jsonb);

do $$
declare
  name text;
begin
  foreach name in array array[
    'storybound_store_members', 'storybound_store_listings', 'storybound_store_versions',
    'storybound_store_adds', 'storybound_store_reports', 'storybound_admins',
    'storybound_access', 'storybound_settings'
  ] loop
    execute format('alter table public.%I enable row level security', name);
    execute format('revoke all on public.%I from public, anon, authenticated', name);
  end loop;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bookstore-books', 'bookstore-books', false, 31457280, array['application/json']);

create or replace function public.storybound_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.storybound_admins where owner_id = auth.uid());
$$;

create or replace function public.storybound_paywall_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select value = 'true'::jsonb from public.storybound_settings where key = 'paywall_enabled'),
    false
  );
$$;

-- The one rule for paid features. While the paywall is off, everyone has them.
create or replace function public.storybound_has_plus()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not public.storybound_paywall_enabled() or exists (
    select 1 from public.storybound_access
    where owner_id = auth.uid() and plan = 'plus' and (ends_at is null or ends_at > now())
  );
$$;

create or replace function public.storybound_store_terms_version()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (value #>> '{}')::integer from public.storybound_settings
     where key = 'store_terms_version'),
    1
  );
$$;

-- Everything in the store needs an account that has accepted the current terms.
create or replace function public.storybound_store_require_member()
returns public.storybound_store_members
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  member public.storybound_store_members%rowtype;
begin
  perform public.storybound_require_session();
  select * into member from public.storybound_store_members where owner_id = auth.uid();
  if member.owner_id is null or member.terms_version < public.storybound_store_terms_version() then
    raise exception 'Accept the Bookstore terms first';
  end if;
  if member.suspended_at is not null then
    raise exception 'This account can no longer use the Bookstore';
  end if;
  return member;
end;
$$;

create or replace function public.storybound_require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.storybound_require_session();
  if not public.storybound_is_admin() then raise exception 'Not allowed'; end if;
end;
$$;

-- Who may download a book's file: its author, an admin, or any member for the live version.
create or replace function public.storybound_can_read_book(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.storybound_is_admin() or exists (
    select 1
    from public.storybound_store_versions version
    join public.storybound_store_listings listing on listing.id = version.listing_id
    left join public.storybound_store_members member on member.owner_id = auth.uid()
    where version.file_path = p_name and (
      listing.owner_id = auth.uid() or (
        listing.status = 'live'
        and listing.live_version = version.version
        and member.owner_id is not null
        and member.suspended_at is null
        and public.storybound_has_plus()
      )
    )
  ) or (storage.foldername(p_name))[1] = auth.uid()::text;
$$;

create or replace function public.storybound_can_upload_book(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (storage.foldername(p_name))[1] = auth.uid()::text
    and public.storybound_has_plus()
    and exists (
      select 1 from public.storybound_store_members
      where owner_id = auth.uid() and pen_name is not null and suspended_at is null
    )
    and (
      select count(*) from storage.objects
      where bucket_id = 'bookstore-books'
        and (storage.foldername(name))[1] = auth.uid()::text
        and created_at > now() - interval '1 day'
    ) < 20;
$$;

-- An author can tidy their own files, but not one that readers are still being given.
create or replace function public.storybound_can_delete_book(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (storage.foldername(p_name))[1] = auth.uid()::text and not exists (
    select 1
    from public.storybound_store_versions version
    join public.storybound_store_listings listing on listing.id = version.listing_id
    where version.file_path = p_name
      and listing.status = 'live'
      and listing.live_version = version.version
  );
$$;

create policy "Bookstore files are read through the access rule"
  on storage.objects for select to authenticated
  using (bucket_id = 'bookstore-books' and public.storybound_can_read_book(name));

create policy "Authors upload to their own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'bookstore-books' and public.storybound_can_upload_book(name));

create policy "Authors remove their own unused files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'bookstore-books' and public.storybound_can_delete_book(name));

create or replace function public.get_storybound_store_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  member public.storybound_store_members%rowtype;
  current_terms integer := public.storybound_store_terms_version();
begin
  perform public.storybound_require_session();
  select * into member from public.storybound_store_members where owner_id = auth.uid();
  return jsonb_build_object(
    'joined', member.owner_id is not null and member.terms_version >= current_terms,
    'penName', member.pen_name,
    'suspended', member.suspended_at is not null,
    'suspensionReason', member.suspension_reason,
    'isAdmin', public.storybound_is_admin(),
    'termsVersion', current_terms
  );
end;
$$;

create or replace function public.join_storybound_store(p_terms_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.storybound_require_session();
  if p_terms_version <> public.storybound_store_terms_version() then
    raise exception 'The Bookstore terms have changed';
  end if;
  insert into public.storybound_store_members (owner_id, terms_version, adult_confirmed_at)
  values (auth.uid(), p_terms_version, now())
  on conflict (owner_id) do update set
    terms_version = excluded.terms_version,
    adult_confirmed_at = excluded.adult_confirmed_at,
    updated_at = now();
end;
$$;

create or replace function public.set_storybound_pen_name(p_pen_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := btrim(coalesce(p_pen_name, ''));
begin
  perform public.storybound_store_require_member();
  if char_length(clean) not between 2 and 60 then
    raise exception 'A pen name needs 2 to 60 characters';
  end if;
  if exists (
    select 1 from public.storybound_store_members
    where lower(btrim(pen_name)) = lower(clean) and owner_id <> auth.uid()
  ) then
    raise exception 'That pen name is taken';
  end if;
  update public.storybound_store_members
  set pen_name = clean, updated_at = now()
  where owner_id = auth.uid();
end;
$$;

-- What a reader sees of one version.
create or replace function public.storybound_store_card(
  p_listing public.storybound_store_listings,
  p_version public.storybound_store_versions
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', (p_listing).id,
    'status', (p_listing).status,
    'version', (p_version).version,
    'title', (p_version).title,
    'subtitle', (p_version).subtitle,
    'authorName', (p_version).author_name,
    'blurb', (p_version).blurb,
    'genre', (p_version).genre,
    'contentWarnings', to_jsonb((p_version).content_warnings),
    'aiUse', (p_version).ai_use,
    'languageCode', (p_version).language_code,
    'chapterCount', (p_version).chapter_count,
    'wordCount', (p_version).word_count,
    'coverStyle', (p_version).cover_style,
    'coverThumb', (p_version).cover_thumb,
    'addCount', (p_listing).add_count,
    'publishedAt', (p_listing).published_at,
    'mine', (p_listing).owner_id = auth.uid()
  );
$$;

create or replace function public.browse_storybound_store(
  p_query text default '',
  p_genre text default null,
  p_sort text default 'new',
  p_page integer default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  page_size constant integer := 24;
  clean text := btrim(coalesce(p_query, ''));
  found jsonb;
begin
  perform public.storybound_store_require_member();
  select coalesce(jsonb_agg(card), '[]'::jsonb) into found
  from (
    select public.storybound_store_card(listing, live) as card
    from public.storybound_store_listings listing
    join public.storybound_store_versions live
      on live.listing_id = listing.id and live.version = listing.live_version
    where listing.status = 'live'
      and (p_genre is null or live.genre = p_genre)
      and (
        clean = ''
        or listing.search @@ websearch_to_tsquery('simple', clean)
        or position(lower(clean) in lower(live.title)) > 0
        or position(lower(clean) in lower(live.author_name)) > 0
      )
    order by
      case when p_sort = 'popular' then listing.add_count end desc nulls last,
      listing.published_at desc,
      listing.id
    limit page_size + 1
    offset greatest(p_page, 0) * page_size
  ) page;
  return jsonb_build_object(
    'items', coalesce(
      (select jsonb_agg(item) from (
        select item from jsonb_array_elements(found) with ordinality as rows(item, position)
        where position <= page_size
      ) visible),
      '[]'::jsonb
    ),
    'hasMore', jsonb_array_length(found) > page_size
  );
end;
$$;

create or replace function public.get_storybound_listing(p_listing_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  found_listing public.storybound_store_listings%rowtype;
  found_version public.storybound_store_versions%rowtype;
begin
  perform public.storybound_store_require_member();
  select * into found_listing from public.storybound_store_listings where id = p_listing_id;
  if found_listing.id is null
    or (found_listing.status <> 'live' and found_listing.owner_id <> auth.uid()
        and not public.storybound_is_admin()) then
    raise exception 'That book is not in the Bookstore';
  end if;
  select item.* into found_version from public.storybound_store_versions item
  where item.listing_id = found_listing.id
    and item.version = coalesce(
      found_listing.live_version,
      (select max(latest.version) from public.storybound_store_versions latest
       where latest.listing_id = found_listing.id)
    );
  return public.storybound_store_card(found_listing, found_version) || jsonb_build_object(
    'added', exists (
      select 1 from public.storybound_store_adds item
      where item.listing_id = found_listing.id and item.owner_id = auth.uid()
    )
  );
end;
$$;

-- Records the add and says which file to fetch. The file itself is still behind the access rule.
create or replace function public.add_storybound_book(p_listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_listing public.storybound_store_listings%rowtype;
  found_version public.storybound_store_versions%rowtype;
  added integer;
begin
  perform public.storybound_store_require_member();
  if not public.storybound_has_plus() then raise exception 'Storybound Plus is needed'; end if;
  select * into found_listing from public.storybound_store_listings
  where id = p_listing_id for update;
  if found_listing.id is null or found_listing.status <> 'live' then
    raise exception 'That book is not in the Bookstore';
  end if;
  if found_listing.owner_id = auth.uid() then raise exception 'This is your own book'; end if;
  select item.* into found_version from public.storybound_store_versions item
  where item.listing_id = found_listing.id and item.version = found_listing.live_version;
  insert into public.storybound_store_adds (listing_id, owner_id)
  values (found_listing.id, auth.uid())
  on conflict do nothing;
  get diagnostics added = row_count;
  if added > 0 then
    update public.storybound_store_listings
    set add_count = add_count + 1 where id = found_listing.id;
  end if;
  return jsonb_build_object(
    'listingId', found_listing.id,
    'version', found_version.version,
    'authorName', found_version.author_name,
    'filePath', found_version.file_path,
    'sha256', found_version.file_sha256
  );
end;
$$;

-- For the reader's copies: what is new, and what has left the store.
create or replace function public.check_storybound_books(p_listing_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Only a session: a suspended reader still needs to hear about removed books.
  perform public.storybound_require_session();
  if coalesce(array_length(p_listing_ids, 1), 0) > 2000 then
    raise exception 'Too many books';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'listingId', listing.id,
      'status', listing.status,
      'version', listing.live_version,
      'authorName', version.author_name,
      'filePath', version.file_path,
      'sha256', version.file_sha256,
      'removalReason', listing.removal_reason
    ))
    from public.storybound_store_listings listing
    left join public.storybound_store_versions version
      on version.listing_id = listing.id and version.version = listing.live_version
    where listing.id = any(p_listing_ids)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.submit_storybound_version(
  p_listing_id uuid,
  p_source_book_id uuid,
  p_title text,
  p_subtitle text,
  p_blurb text,
  p_genre text,
  p_content_warnings text[],
  p_ai_use text,
  p_language_code text,
  p_chapter_count integer,
  p_word_count integer,
  p_cover_style text,
  p_cover_thumb text,
  p_file_path text,
  p_file_sha256 text,
  p_file_bytes integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  member public.storybound_store_members%rowtype;
  found_listing public.storybound_store_listings%rowtype;
  next_version integer;
begin
  member := public.storybound_store_require_member();
  if not public.storybound_has_plus() then raise exception 'Storybound Plus is needed'; end if;
  if member.pen_name is null then raise exception 'Choose a pen name first'; end if;
  if (storage.foldername(p_file_path))[1] is distinct from auth.uid()::text or not exists (
    select 1 from storage.objects where bucket_id = 'bookstore-books' and name = p_file_path
  ) then
    raise exception 'That file has not been uploaded';
  end if;

  select * into found_listing from public.storybound_store_listings
  where owner_id = auth.uid() and source_book_id = p_source_book_id for update;

  if found_listing.id is null then
    if not public.storybound_is_admin() and (
      select count(*) from public.storybound_store_listings
      where owner_id = auth.uid() and created_at > now() - interval '7 days'
    ) >= 1 then
      raise exception 'You can publish one new book a week';
    end if;
    insert into public.storybound_store_listings (id, owner_id, source_book_id)
    values (p_listing_id, auth.uid(), p_source_book_id)
    returning * into found_listing;
  elsif found_listing.status = 'removed' then
    raise exception 'This book was removed from the Bookstore';
  elsif not public.storybound_is_admin() and (
    select count(*) from public.storybound_store_versions
    where listing_id = found_listing.id and submitted_at > now() - interval '1 day'
  ) >= 5 then
    raise exception 'Too many versions of this book today';
  end if;

  update public.storybound_store_versions
  set status = 'superseded'
  where listing_id = found_listing.id and status = 'pending';

  select coalesce(max(item.version), 0) + 1 into next_version
  from public.storybound_store_versions item where item.listing_id = found_listing.id;

  insert into public.storybound_store_versions (
    listing_id, version, title, subtitle, author_name, blurb, genre, content_warnings, ai_use,
    language_code, chapter_count, word_count, cover_style, cover_thumb, file_path, file_sha256,
    file_bytes
  ) values (
    found_listing.id, next_version, btrim(p_title), coalesce(p_subtitle, ''), member.pen_name,
    btrim(p_blurb), p_genre, coalesce(p_content_warnings, '{}'), p_ai_use,
    coalesce(p_language_code, 'en'), p_chapter_count, p_word_count,
    coalesce(p_cover_style, 'classic'), p_cover_thumb, p_file_path, p_file_sha256, p_file_bytes
  );

  update public.storybound_store_listings
  set status = case when status = 'live' then 'live' else 'pending' end,
      updated_at = now()
  where id = found_listing.id;

  return jsonb_build_object('listingId', found_listing.id, 'version', next_version);
end;
$$;

create or replace function public.list_my_storybound_listings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.storybound_store_require_member();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', listing.id,
      'sourceBookId', listing.source_book_id,
      'status', listing.status,
      'liveVersion', listing.live_version,
      'addCount', listing.add_count,
      'removalReason', listing.removal_reason,
      'latestVersion', latest.version,
      'latestStatus', latest.status,
      'latestReason', latest.review_reason,
      'title', latest.title,
      'subtitle', latest.subtitle,
      'blurb', latest.blurb,
      'genre', latest.genre,
      'contentWarnings', to_jsonb(latest.content_warnings),
      'aiUse', latest.ai_use,
      'submittedAt', latest.submitted_at
    ) order by latest.submitted_at desc)
    from public.storybound_store_listings listing
    join lateral (
      select * from public.storybound_store_versions item
      where item.listing_id = listing.id order by item.version desc limit 1
    ) latest on true
    where listing.owner_id = auth.uid()
  ), '[]'::jsonb);
end;
$$;

create or replace function public.withdraw_storybound_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.storybound_require_session();
  update public.storybound_store_listings
  set status = 'withdrawn', updated_at = now()
  where id = p_listing_id and owner_id = auth.uid() and status <> 'removed';
  if not found then raise exception 'That book is not in the Bookstore'; end if;
  update public.storybound_store_versions
  set status = 'superseded'
  where listing_id = p_listing_id and status = 'pending';
end;
$$;

create or replace function public.report_storybound_listing(
  p_report_id uuid,
  p_listing_id uuid,
  p_reason text,
  p_detail text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.storybound_store_require_member();
  if not exists (
    select 1 from public.storybound_store_listings where id = p_listing_id and status = 'live'
  ) then
    raise exception 'That book is not in the Bookstore';
  end if;
  insert into public.storybound_store_reports (id, listing_id, reporter_id, reason, detail)
  values (p_report_id, p_listing_id, auth.uid(), p_reason, coalesce(p_detail, ''))
  on conflict (listing_id, reporter_id) do update set
    reason = excluded.reason,
    detail = excluded.detail,
    closed_at = null,
    outcome = null;
end;
$$;

create or replace function public.list_storybound_review_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.storybound_require_admin();
  return coalesce((
    select jsonb_agg(
      public.storybound_store_card(listing, waiting) || jsonb_build_object(
        'version', waiting.version,
        'filePath', waiting.file_path,
        'sha256', waiting.file_sha256,
        'submittedAt', waiting.submitted_at,
        'isUpdate', listing.live_version is not null
      ) order by waiting.submitted_at
    )
    from public.storybound_store_versions waiting
    join public.storybound_store_listings listing on listing.id = waiting.listing_id
    where waiting.status = 'pending'
  ), '[]'::jsonb);
end;
$$;

create or replace function public.review_storybound_version(
  p_listing_id uuid,
  p_version integer,
  p_approve boolean,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_version public.storybound_store_versions%rowtype;
begin
  perform public.storybound_require_admin();
  select * into found_version from public.storybound_store_versions
  where listing_id = p_listing_id and version = p_version and status = 'pending' for update;
  if found_version.listing_id is null then raise exception 'That version is not waiting'; end if;
  if not p_approve and char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Say why it was not approved';
  end if;

  update public.storybound_store_versions
  set status = case when p_approve then 'approved' else 'rejected' end,
      review_reason = nullif(btrim(coalesce(p_reason, '')), ''),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where listing_id = p_listing_id and version = p_version;

  if p_approve then
    update public.storybound_store_listings
    set status = 'live',
        live_version = p_version,
        published_at = coalesce(published_at, now()),
        updated_at = now(),
        search = to_tsvector('simple', concat_ws(
          ' ', found_version.title, found_version.subtitle, found_version.author_name,
          found_version.blurb
        ))
    where id = p_listing_id;
  else
    update public.storybound_store_listings
    set status = case when status = 'live' then 'live' else 'rejected' end,
        updated_at = now()
    where id = p_listing_id;
  end if;
end;
$$;

create or replace function public.remove_storybound_listing(p_listing_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.storybound_require_admin();
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Say why it was removed';
  end if;
  update public.storybound_store_listings
  set status = 'removed', removal_reason = btrim(p_reason), updated_at = now()
  where id = p_listing_id;
  if not found then raise exception 'That book is not in the Bookstore'; end if;
  update public.storybound_store_versions
  set status = 'superseded'
  where listing_id = p_listing_id and status = 'pending';
  update public.storybound_store_reports
  set closed_at = now(), outcome = 'Removed: ' || btrim(p_reason)
  where listing_id = p_listing_id and closed_at is null;
end;
$$;

-- Stops an author using the store. Their pending work goes, and their books too if asked.
create or replace function public.suspend_storybound_author(
  p_listing_id uuid,
  p_reason text,
  p_remove_books boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  author_id uuid;
  clean text := btrim(coalesce(p_reason, ''));
begin
  perform public.storybound_require_admin();
  if char_length(clean) = 0 then raise exception 'Say why the account is being suspended'; end if;
  select owner_id into author_id from public.storybound_store_listings where id = p_listing_id;
  if author_id is null then raise exception 'That book is not in the Bookstore'; end if;
  if exists (select 1 from public.storybound_admins where owner_id = author_id) then
    raise exception 'A reviewer cannot be suspended';
  end if;

  update public.storybound_store_members
  set suspended_at = now(), suspension_reason = clean, updated_at = now()
  where owner_id = author_id;

  update public.storybound_store_versions version
  set status = 'superseded'
  from public.storybound_store_listings listing
  where listing.id = version.listing_id
    and listing.owner_id = author_id
    and version.status = 'pending';

  update public.storybound_store_listings
  set status = case when live_version is null then 'withdrawn' else status end,
      updated_at = now()
  where owner_id = author_id and status = 'pending';

  if p_remove_books then
    update public.storybound_store_listings
    set status = 'removed', removal_reason = clean, updated_at = now()
    where owner_id = author_id and status <> 'removed';
    update public.storybound_store_reports report
    set closed_at = now(), outcome = 'Removed: ' || clean
    from public.storybound_store_listings listing
    where listing.id = report.listing_id
      and listing.owner_id = author_id
      and report.closed_at is null;
  end if;
end;
$$;

-- Lifts a suspension. Books that were removed stay removed.
create or replace function public.unsuspend_storybound_member(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.storybound_require_admin();
  update public.storybound_store_members
  set suspended_at = null, suspension_reason = null, updated_at = now()
  where owner_id = p_owner_id;
end;
$$;

create or replace function public.list_storybound_suspended()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.storybound_require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'ownerId', member.owner_id,
      'penName', member.pen_name,
      'reason', member.suspension_reason,
      'suspendedAt', member.suspended_at
    ) order by member.suspended_at desc)
    from public.storybound_store_members member
    where member.suspended_at is not null
  ), '[]'::jsonb);
end;
$$;

create or replace function public.list_storybound_reports()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.storybound_require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', report.id,
      'listingId', report.listing_id,
      'title', version.title,
      'authorName', version.author_name,
      'reason', report.reason,
      'detail', report.detail,
      'createdAt', report.created_at
    ) order by report.created_at)
    from public.storybound_store_reports report
    join public.storybound_store_listings listing on listing.id = report.listing_id
    left join public.storybound_store_versions version
      on version.listing_id = listing.id and version.version = listing.live_version
    where report.closed_at is null
  ), '[]'::jsonb);
end;
$$;

create or replace function public.close_storybound_report(p_report_id uuid, p_outcome text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.storybound_require_admin();
  update public.storybound_store_reports
  set closed_at = now(), outcome = nullif(btrim(coalesce(p_outcome, '')), '')
  where id = p_report_id;
end;
$$;

-- Before deleting an account, so its files stop being in use and can be removed.
create or replace function public.withdraw_all_storybound_listings()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.storybound_require_session();
  update public.storybound_store_listings
  set status = 'withdrawn', updated_at = now()
  where owner_id = auth.uid() and status <> 'removed';
end;
$$;

-- Everything belonging to the account goes with it, through its foreign keys.
create or replace function public.delete_storybound_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.storybound_require_session();
  delete from auth.users where id = auth.uid();
end;
$$;

-- Readable signed out, so the apps can tell whether anything is locked at all.
create or replace function public.get_storybound_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enforced', public.storybound_paywall_enabled(),
    'plan', case
      when public.storybound_paywall_enabled() and not public.storybound_has_plus() then 'free'
      when public.storybound_paywall_enabled() then 'plus'
      else 'open'
    end,
    'endsAt', (select ends_at from public.storybound_access where owner_id = auth.uid()),
    'kokoroOwned', coalesce(
      (select kokoro_owned from public.storybound_access where owner_id = auth.uid()), false
    )
  );
$$;

do $$
declare
  routine regprocedure;
begin
  for routine in
    select oid::regprocedure from pg_proc
    where pronamespace = 'public'::regnamespace and proname = any(array[
      'storybound_is_admin', 'storybound_paywall_enabled', 'storybound_has_plus',
      'storybound_store_terms_version', 'storybound_store_require_member',
      'storybound_require_admin', 'storybound_store_card'
    ])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', routine);
  end loop;

  for routine in
    select oid::regprocedure from pg_proc
    where pronamespace = 'public'::regnamespace and proname = any(array[
      'storybound_can_read_book', 'storybound_can_upload_book', 'storybound_can_delete_book',
      'get_storybound_store_profile', 'join_storybound_store', 'set_storybound_pen_name',
      'browse_storybound_store', 'get_storybound_listing', 'add_storybound_book',
      'check_storybound_books', 'submit_storybound_version', 'list_my_storybound_listings',
      'withdraw_storybound_listing', 'report_storybound_listing', 'list_storybound_review_queue',
      'review_storybound_version', 'remove_storybound_listing', 'list_storybound_reports',
      'close_storybound_report', 'suspend_storybound_author', 'unsuspend_storybound_member',
      'list_storybound_suspended', 'withdraw_all_storybound_listings', 'delete_storybound_account'
    ])
  loop
    execute format('revoke all on function %s from public, anon', routine);
    execute format('grant execute on function %s to authenticated', routine);
  end loop;
end;
$$;

revoke all on function public.get_storybound_access() from public;
grant execute on function public.get_storybound_access() to anon, authenticated;
