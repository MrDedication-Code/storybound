create extension if not exists pgcrypto with schema extensions;

create table public.storybound_vaults (
  id uuid primary key,
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  protocol_version integer not null default 1 check (protocol_version = 1),
  key_epoch integer not null default 1 check (key_epoch > 0),
  recovery_verifier text not null check (char_length(recovery_verifier) between 32 and 256),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.storybound_devices (
  id uuid primary key,
  vault_id uuid not null references public.storybound_vaults(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  state text not null default 'active' check (state in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  session_id uuid not null,
  unique (vault_id, id)
);

create table public.storybound_key_envelopes (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.storybound_vaults(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('recovery', 'device')),
  recipient_device_id uuid references public.storybound_devices(id) on delete cascade,
  key_epoch integer not null check (key_epoch > 0),
  nonce text not null check (char_length(nonce) between 8 and 128),
  ciphertext text not null check (char_length(ciphertext) between 16 and 4096),
  recipient_public_key text,
  created_at timestamptz not null default now(),
  check ((kind = 'recovery' and recipient_device_id is null) or kind = 'device')
);

create unique index storybound_recovery_envelope_epoch_idx
  on public.storybound_key_envelopes (vault_id, key_epoch)
  where kind = 'recovery';

create table public.storybound_changes (
  sequence bigint generated always as identity primary key,
  vault_id uuid not null references public.storybound_vaults(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references public.storybound_devices(id),
  mutation_id uuid not null,
  entity_type text not null check (char_length(entity_type) between 1 and 80),
  entity_id text not null check (char_length(entity_id) between 1 and 240),
  operation text not null check (operation in ('upsert', 'delete')),
  base_remote_revision bigint,
  protocol_version integer not null check (protocol_version = 1),
  schema_version integer not null check (schema_version > 0),
  key_epoch integer not null check (key_epoch > 0),
  nonce text not null check (char_length(nonce) between 8 and 128),
  ciphertext text not null check (char_length(ciphertext) between 16 and 8388608),
  ciphertext_hash text not null check (char_length(ciphertext_hash) between 8 and 256),
  changed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (vault_id, mutation_id)
);

create index storybound_changes_pull_idx
  on public.storybound_changes (vault_id, sequence);

create table public.storybound_entity_heads (
  vault_id uuid not null references public.storybound_vaults(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  revision bigint not null references public.storybound_changes(sequence),
  mutation_id uuid not null,
  device_id uuid not null references public.storybound_devices(id),
  operation text not null check (operation in ('upsert', 'delete')),
  protocol_version integer not null,
  schema_version integer not null,
  key_epoch integer not null,
  nonce text not null,
  ciphertext text not null,
  ciphertext_hash text not null,
  changed_at timestamptz not null,
  primary key (vault_id, entity_type, entity_id)
);

alter table public.storybound_vaults enable row level security;
alter table public.storybound_devices enable row level security;
alter table public.storybound_key_envelopes enable row level security;
alter table public.storybound_changes enable row level security;
alter table public.storybound_entity_heads enable row level security;

create policy "vault owner access" on public.storybound_vaults
  for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "device owner access" on public.storybound_devices
  for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "envelope owner access" on public.storybound_key_envelopes
  for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "change owner read" on public.storybound_changes
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "head owner read" on public.storybound_entity_heads
  for select to authenticated using (owner_id = (select auth.uid()));

revoke all on public.storybound_vaults from public, anon, authenticated;
revoke all on public.storybound_devices from public, anon, authenticated;
revoke all on public.storybound_key_envelopes from public, anon, authenticated;
revoke all on public.storybound_changes from public, anon, authenticated;
revoke all on public.storybound_entity_heads from public, anon, authenticated;

create or replace function public.create_storybound_vault(
  p_vault_id uuid,
  p_device_id uuid,
  p_device_name text,
  p_key_epoch integer,
  p_recovery_verifier text,
  p_recovery_nonce text,
  p_recovery_ciphertext text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if p_key_epoch < 1 then raise exception 'Invalid key epoch'; end if;

  insert into public.storybound_vaults (id, owner_id, key_epoch, recovery_verifier)
  values (p_vault_id, current_user_id, p_key_epoch, p_recovery_verifier);
  insert into public.storybound_devices (id, vault_id, owner_id, display_name, session_id)
  values (
    p_device_id, p_vault_id, current_user_id, left(trim(p_device_name), 120),
    (auth.jwt()->>'session_id')::uuid
  );
  insert into public.storybound_key_envelopes (
    vault_id, owner_id, kind, key_epoch, nonce, ciphertext
  ) values (
    p_vault_id, current_user_id, 'recovery', p_key_epoch,
    p_recovery_nonce, p_recovery_ciphertext
  );
  return jsonb_build_object('vaultId', p_vault_id, 'deviceId', p_device_id, 'keyEpoch', p_key_epoch);
end;
$$;

create or replace function public.register_storybound_device(
  p_vault_id uuid,
  p_device_id uuid,
  p_device_name text,
  p_recovery_verifier text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  envelope record;
begin
  if not exists (
    select 1 from public.storybound_vaults
    where id = p_vault_id and owner_id = current_user_id
      and recovery_verifier = p_recovery_verifier
  ) then raise exception 'Vault not found'; end if;

  insert into public.storybound_devices (
    id, vault_id, owner_id, display_name, session_id
  ) values (
    p_device_id, p_vault_id, current_user_id, left(trim(p_device_name), 120),
    (auth.jwt()->>'session_id')::uuid
  );

  select key_epoch, nonce, ciphertext into envelope
  from public.storybound_key_envelopes
  where vault_id = p_vault_id and owner_id = current_user_id and kind = 'recovery'
  order by key_epoch desc limit 1;

  update public.storybound_devices set last_seen_at = now() where id = p_device_id;
  return jsonb_build_object(
    'vaultId', p_vault_id,
    'deviceId', p_device_id,
    'keyEpoch', envelope.key_epoch,
    'recoveryEnvelope', jsonb_build_object(
      'version', 1, 'kind', 'recovery', 'vaultId', p_vault_id,
      'keyEpoch', envelope.key_epoch, 'nonce', envelope.nonce,
      'ciphertext', envelope.ciphertext
    )
  );
end;
$$;

create or replace function public.get_storybound_bootstrap()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
      'vaultId', v.id,
      'keyEpoch', v.key_epoch,
      'devices', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', d.id, 'displayName', d.display_name, 'state', d.state,
          'createdAt', d.created_at, 'lastSeenAt', d.last_seen_at,
          'revokedAt', d.revoked_at
        ) order by d.created_at)
        from public.storybound_devices d
        where d.vault_id = v.id and d.owner_id = auth.uid()
      ), '[]'::jsonb)
    )
    from public.storybound_vaults v
    where v.owner_id = auth.uid()
  ), 'null'::jsonb)
$$;

create or replace function public.push_storybound_mutations(
  p_vault_id uuid,
  p_device_id uuid,
  p_mutations jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  mutation jsonb;
  existing record;
  head record;
  new_sequence bigint;
  results jsonb := '[]'::jsonb;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_mutations) <> 'array' or jsonb_array_length(p_mutations) > 100 then
    raise exception 'Invalid mutation batch';
  end if;
  if not exists (
    select 1 from public.storybound_devices
    where id = p_device_id and vault_id = p_vault_id
      and owner_id = current_user_id
      and session_id = (auth.jwt()->>'session_id')::uuid
      and state = 'active'
  ) then raise exception 'Active device not found'; end if;

  for mutation in select value from jsonb_array_elements(p_mutations)
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_vault_id::text || ':' || (mutation->>'entityType') || ':' || (mutation->>'entityId'),
        0
      )
    );

    select * into existing
    from public.storybound_changes
    where vault_id = p_vault_id and mutation_id = (mutation->>'mutationId')::uuid;
    if found then
      if existing.device_id is distinct from p_device_id
         or existing.entity_type is distinct from mutation->>'entityType'
         or existing.entity_id is distinct from mutation->>'entityId'
         or existing.operation is distinct from mutation->>'operation'
         or existing.base_remote_revision is distinct from nullif(mutation->>'baseRemoteRevision', '')::bigint
         or existing.protocol_version is distinct from (mutation->>'protocolVersion')::integer
         or existing.schema_version is distinct from (mutation->>'schemaVersion')::integer
         or existing.key_epoch is distinct from (mutation->>'keyVersion')::integer
         or existing.nonce is distinct from mutation->>'nonce'
         or existing.ciphertext is distinct from mutation->>'ciphertext'
         or existing.ciphertext_hash is distinct from mutation->>'hash'
      then raise exception 'Mutation identifier reused with different content';
      end if;
      results := results || jsonb_build_array(jsonb_build_object(
        'mutationId', mutation->>'mutationId', 'status', 'accepted',
        'remoteRevision', existing.sequence::text, 'duplicate', true
      ));
      continue;
    end if;

    select * into head from public.storybound_entity_heads
    where vault_id = p_vault_id
      and entity_type = mutation->>'entityType'
      and entity_id = mutation->>'entityId'
    for update;

    if not found and mutation->>'baseRemoteRevision' is not null then
      raise exception 'Base revision supplied for a missing entity';
    end if;
    if found and (mutation->>'baseRemoteRevision') is distinct from head.revision::text then
      results := results || jsonb_build_array(jsonb_build_object(
        'mutationId', mutation->>'mutationId', 'status', 'conflict',
        'remoteRevision', head.revision::text,
        'remoteMutationId', head.mutation_id,
        'remoteDeviceId', head.device_id,
        'remoteOperation', head.operation,
        'remotePayload', jsonb_build_object(
          'ciphertext', head.ciphertext, 'nonce', head.nonce,
          'encoding', 'aes-256-gcm-v1', 'keyVersion', head.key_epoch,
          'schemaVersion', head.schema_version, 'hash', head.ciphertext_hash
        )
      ));
      continue;
    end if;

    insert into public.storybound_changes (
      vault_id, owner_id, device_id, mutation_id, entity_type, entity_id,
      operation, base_remote_revision, protocol_version, schema_version,
      key_epoch, nonce, ciphertext, ciphertext_hash, changed_at
    ) values (
      p_vault_id, current_user_id, p_device_id, (mutation->>'mutationId')::uuid,
      mutation->>'entityType', mutation->>'entityId', mutation->>'operation',
      nullif(mutation->>'baseRemoteRevision', '')::bigint,
      (mutation->>'protocolVersion')::integer, (mutation->>'schemaVersion')::integer,
      (mutation->>'keyVersion')::integer, mutation->>'nonce', mutation->>'ciphertext',
      mutation->>'hash', (mutation->>'changedAt')::timestamptz
    ) returning sequence into new_sequence;

    insert into public.storybound_entity_heads (
      vault_id, owner_id, entity_type, entity_id, revision, mutation_id, device_id,
      operation, protocol_version, schema_version, key_epoch, nonce, ciphertext,
      ciphertext_hash, changed_at
    ) values (
      p_vault_id, current_user_id, mutation->>'entityType', mutation->>'entityId',
      new_sequence, (mutation->>'mutationId')::uuid, p_device_id, mutation->>'operation',
      (mutation->>'protocolVersion')::integer, (mutation->>'schemaVersion')::integer,
      (mutation->>'keyVersion')::integer, mutation->>'nonce', mutation->>'ciphertext',
      mutation->>'hash', (mutation->>'changedAt')::timestamptz
    ) on conflict (vault_id, entity_type, entity_id) do update set
      owner_id = excluded.owner_id, revision = excluded.revision,
      mutation_id = excluded.mutation_id, device_id = excluded.device_id,
      operation = excluded.operation, protocol_version = excluded.protocol_version,
      schema_version = excluded.schema_version, key_epoch = excluded.key_epoch,
      nonce = excluded.nonce, ciphertext = excluded.ciphertext,
      ciphertext_hash = excluded.ciphertext_hash, changed_at = excluded.changed_at;

    results := results || jsonb_build_array(jsonb_build_object(
      'mutationId', mutation->>'mutationId', 'status', 'accepted',
      'remoteRevision', new_sequence::text, 'duplicate', false
    ));
  end loop;
  update public.storybound_devices set last_seen_at = now() where id = p_device_id;
  return results;
end;
$$;

create or replace function public.pull_storybound_changes(
  p_vault_id uuid,
  p_device_id uuid,
  p_cursor bigint default 0,
  p_limit integer default 100
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  changes jsonb;
  next_cursor bigint;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if p_limit < 1 or p_limit > 500 then raise exception 'Invalid page limit'; end if;
  if not exists (
    select 1 from public.storybound_devices
    where id = p_device_id and vault_id = p_vault_id and owner_id = current_user_id
      and session_id = (auth.jwt()->>'session_id')::uuid and state = 'active'
  ) then raise exception 'Active device not found'; end if;

  select coalesce(jsonb_agg(item order by (item->>'remoteRevision')::bigint), '[]'::jsonb)
  into changes from (
    select jsonb_build_object(
      'mutationId', c.mutation_id, 'deviceId', c.device_id,
      'entityType', c.entity_type, 'entityId', c.entity_id,
      'operation', c.operation, 'remoteRevision', c.sequence::text,
      'changedAt', c.changed_at,
      'payload', jsonb_build_object(
        'ciphertext', c.ciphertext, 'nonce', c.nonce,
        'encoding', 'aes-256-gcm-v1', 'keyVersion', c.key_epoch,
        'schemaVersion', c.schema_version, 'hash', c.ciphertext_hash
      )
    ) as item
    from public.storybound_changes c
    where c.vault_id = p_vault_id and c.sequence > greatest(p_cursor, 0)
    order by c.sequence limit p_limit
  ) page;

  select coalesce(max((item->>'remoteRevision')::bigint), greatest(p_cursor, 0))
  into next_cursor from jsonb_array_elements(changes) item;

  update public.storybound_devices set last_seen_at = now() where id = p_device_id;
  return jsonb_build_object(
    'changes', changes,
    'nextCursor', next_cursor::text,
    'hasMore', exists(
      select 1 from public.storybound_changes
      where vault_id = p_vault_id and sequence > next_cursor
    )
  );
end;
$$;

create or replace function public.revoke_storybound_device(p_device_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.storybound_devices
  set state = 'revoked', revoked_at = now()
  where id = p_device_id and owner_id = auth.uid();
end;
$$;

revoke all on function public.create_storybound_vault(uuid, uuid, text, integer, text, text, text) from public, anon;
revoke all on function public.register_storybound_device(uuid, uuid, text, text) from public, anon;
revoke all on function public.get_storybound_bootstrap() from public, anon;
revoke all on function public.push_storybound_mutations(uuid, uuid, jsonb) from public, anon;
revoke all on function public.pull_storybound_changes(uuid, uuid, bigint, integer) from public, anon;
revoke all on function public.revoke_storybound_device(uuid) from public, anon;
grant execute on function public.create_storybound_vault(uuid, uuid, text, integer, text, text, text) to authenticated;
grant execute on function public.register_storybound_device(uuid, uuid, text, text) to authenticated;
grant execute on function public.get_storybound_bootstrap() to authenticated;
grant execute on function public.push_storybound_mutations(uuid, uuid, jsonb) to authenticated;
grant execute on function public.pull_storybound_changes(uuid, uuid, bigint, integer) to authenticated;
grant execute on function public.revoke_storybound_device(uuid) to authenticated;
