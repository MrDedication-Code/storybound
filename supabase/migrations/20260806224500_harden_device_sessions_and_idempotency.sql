-- This follow-up migration deliberately replaces the first protocol revision's RPC overloads.
-- Existing devices predate possession credentials, so they are revoked and must be recovered
-- once with the vault recovery code. New devices retain a random token in OS-protected storage.

-- DROP IF EXISTS covers both the genuine first deployed signatures and the hardened interim
-- signatures that appeared while this work was still under review. DROP removes their grants;
-- using an unconditional REVOKE first would make upgrades fail when one historical overload was
-- never present in a particular project.
drop function if exists public.create_storybound_vault(uuid, uuid, text, integer, text, text);
drop function if exists public.create_storybound_vault(uuid, uuid, text, integer, text, text, text);
drop function if exists public.register_storybound_device(uuid, uuid, text);
drop function if exists public.register_storybound_device(uuid, uuid, text, text);
drop function if exists public.push_storybound_mutations(uuid, uuid, jsonb);
drop function if exists public.pull_storybound_changes(uuid, bigint, integer);
drop function if exists public.pull_storybound_changes(uuid, uuid, bigint, integer);
drop function if exists public.revoke_storybound_device(uuid);

-- Some development builds used the original RPC catalog before these columns were added to the
-- first migration. Keep the final schema callable after that upgrade too. Legacy NULL rows are
-- revoked below; every newly created vault/device supplies both values.
alter table public.storybound_vaults
  add column if not exists recovery_verifier text
  check (
    recovery_verifier is null or char_length(recovery_verifier) between 32 and 256
  );

alter table public.storybound_devices
  add column if not exists session_id uuid;

alter table public.storybound_devices
  add column device_auth_hash text
  check (device_auth_hash is null or char_length(device_auth_hash) = 64);

update public.storybound_devices
set state = 'revoked', revoked_at = coalesce(revoked_at, now())
where device_auth_hash is null and state = 'active';

alter table public.storybound_devices
  add constraint storybound_active_device_session_check
  check (state = 'revoked' or session_id is not null);

alter table public.storybound_changes
  add column row_version bigint not null default 1 check (row_version > 0),
  add column change_set_id text check (
    change_set_id is null or char_length(change_set_id) between 1 and 240
  ),
  add column encoding text not null default 'aes-256-gcm-v1'
    check (encoding = 'aes-256-gcm-v1');

alter table public.storybound_changes
  alter column row_version drop default,
  alter column encoding drop default;

create or replace function public.create_storybound_vault(
  p_vault_id uuid,
  p_device_id uuid,
  p_device_name text,
  p_device_token text,
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
  current_session_id uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if current_session_id is null or not exists (
    select 1 from auth.sessions
    where id = current_session_id and user_id = current_user_id
      and (not_after is null or not_after > now())
  ) then raise exception 'Authentication session is not active'; end if;
  if p_key_epoch < 1 then raise exception 'Invalid key epoch'; end if;
  if char_length(p_device_token) < 32 or char_length(p_device_token) > 256 then
    raise exception 'Invalid device token';
  end if;

  insert into public.storybound_vaults (id, owner_id, key_epoch, recovery_verifier)
  values (p_vault_id, current_user_id, p_key_epoch, p_recovery_verifier);
  insert into public.storybound_devices (
    id, vault_id, owner_id, display_name, session_id, device_auth_hash
  ) values (
    p_device_id, p_vault_id, current_user_id, left(trim(p_device_name), 120),
    current_session_id, encode(extensions.digest(p_device_token, 'sha256'), 'hex')
  );
  insert into public.storybound_key_envelopes (
    vault_id, owner_id, kind, key_epoch, nonce, ciphertext
  ) values (
    p_vault_id, current_user_id, 'recovery', p_key_epoch,
    p_recovery_nonce, p_recovery_ciphertext
  );
  return jsonb_build_object(
    'vaultId', p_vault_id, 'deviceId', p_device_id, 'keyEpoch', p_key_epoch
  );
end;
$$;

create or replace function public.register_storybound_device(
  p_vault_id uuid,
  p_device_id uuid,
  p_device_name text,
  p_device_token text,
  p_recovery_verifier text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_session_id uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
  envelope record;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if current_session_id is null or not exists (
    select 1 from auth.sessions
    where id = current_session_id and user_id = current_user_id
      and (not_after is null or not_after > now())
  ) then raise exception 'Authentication session is not active'; end if;
  if char_length(p_device_token) < 32 or char_length(p_device_token) > 256 then
    raise exception 'Invalid device token';
  end if;
  if not exists (
    select 1 from public.storybound_vaults
    where id = p_vault_id and owner_id = current_user_id
      and recovery_verifier = p_recovery_verifier
  ) then raise exception 'Vault not found'; end if;

  insert into public.storybound_devices (
    id, vault_id, owner_id, display_name, session_id, device_auth_hash
  ) values (
    p_device_id, p_vault_id, current_user_id, left(trim(p_device_name), 120),
    current_session_id, encode(extensions.digest(p_device_token, 'sha256'), 'hex')
  );

  select key_epoch, nonce, ciphertext into envelope
  from public.storybound_key_envelopes
  where vault_id = p_vault_id and owner_id = current_user_id and kind = 'recovery'
  order by key_epoch desc limit 1;

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
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_session_id uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
  result jsonb;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if current_session_id is null or not exists (
    select 1 from auth.sessions
    where id = current_session_id and user_id = current_user_id
      and (not_after is null or not_after > now())
  ) then raise exception 'Authentication session is not active'; end if;

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
        where d.vault_id = v.id and d.owner_id = current_user_id
      ), '[]'::jsonb)
    )
    from public.storybound_vaults v
    where v.owner_id = current_user_id
  ), 'null'::jsonb) into result;
  return result;
end;
$$;

create or replace function public.push_storybound_mutations(
  p_vault_id uuid,
  p_device_id uuid,
  p_device_token text,
  p_mutations jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_session_id uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
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
  if current_session_id is null or not exists (
    select 1 from auth.sessions
    where id = current_session_id and user_id = current_user_id
      and (not_after is null or not_after > now())
  ) then raise exception 'Authentication session is not active'; end if;
  if not exists (
    select 1 from public.storybound_devices
    where id = p_device_id and vault_id = p_vault_id
      and owner_id = current_user_id
      and device_auth_hash = encode(extensions.digest(p_device_token, 'sha256'), 'hex')
      and state = 'active'
  ) then raise exception 'Active device not found'; end if;

  update public.storybound_devices
  set session_id = current_session_id, last_seen_at = now()
  where id = p_device_id and vault_id = p_vault_id;

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
         or existing.row_version is distinct from (mutation->>'rowVersion')::bigint
         or existing.change_set_id is distinct from mutation->>'changeSetId'
         or existing.schema_version is distinct from (mutation->>'schemaVersion')::integer
         or existing.key_epoch is distinct from (mutation->>'keyVersion')::integer
         or existing.encoding is distinct from mutation->>'encoding'
         or existing.nonce is distinct from mutation->>'nonce'
         or existing.ciphertext is distinct from mutation->>'ciphertext'
         or existing.ciphertext_hash is distinct from mutation->>'hash'
         or existing.changed_at is distinct from (mutation->>'changedAt')::timestamptz
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
      operation, base_remote_revision, protocol_version, row_version, change_set_id,
      schema_version, key_epoch, encoding, nonce, ciphertext, ciphertext_hash, changed_at
    ) values (
      p_vault_id, current_user_id, p_device_id, (mutation->>'mutationId')::uuid,
      mutation->>'entityType', mutation->>'entityId', mutation->>'operation',
      nullif(mutation->>'baseRemoteRevision', '')::bigint,
      (mutation->>'protocolVersion')::integer, (mutation->>'rowVersion')::bigint,
      mutation->>'changeSetId', (mutation->>'schemaVersion')::integer,
      (mutation->>'keyVersion')::integer, mutation->>'encoding',
      mutation->>'nonce', mutation->>'ciphertext', mutation->>'hash',
      (mutation->>'changedAt')::timestamptz
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
  return results;
end;
$$;

create or replace function public.pull_storybound_changes(
  p_vault_id uuid,
  p_device_id uuid,
  p_device_token text,
  p_cursor bigint default 0,
  p_limit integer default 100
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_session_id uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
  changes jsonb;
  next_cursor bigint;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if p_limit < 1 or p_limit > 500 then raise exception 'Invalid page limit'; end if;
  if current_session_id is null or not exists (
    select 1 from auth.sessions
    where id = current_session_id and user_id = current_user_id
      and (not_after is null or not_after > now())
  ) then raise exception 'Authentication session is not active'; end if;
  if not exists (
    select 1 from public.storybound_devices
    where id = p_device_id and vault_id = p_vault_id and owner_id = current_user_id
      and device_auth_hash = encode(extensions.digest(p_device_token, 'sha256'), 'hex')
      and state = 'active'
  ) then raise exception 'Active device not found'; end if;

  update public.storybound_devices
  set session_id = current_session_id, last_seen_at = now()
  where id = p_device_id and vault_id = p_vault_id;

  select coalesce(jsonb_agg(item order by (item->>'remoteRevision')::bigint), '[]'::jsonb)
  into changes from (
    select jsonb_build_object(
      'mutationId', c.mutation_id, 'deviceId', c.device_id,
      'entityType', c.entity_type, 'entityId', c.entity_id,
      'operation', c.operation, 'remoteRevision', c.sequence::text,
      'changedAt', c.changed_at,
      'payload', jsonb_build_object(
        'ciphertext', c.ciphertext, 'nonce', c.nonce,
        'encoding', c.encoding, 'keyVersion', c.key_epoch,
        'schemaVersion', c.schema_version, 'hash', c.ciphertext_hash
      )
    ) as item
    from public.storybound_changes c
    where c.vault_id = p_vault_id and c.sequence > greatest(p_cursor, 0)
    order by c.sequence limit p_limit
  ) page;

  select coalesce(max((item->>'remoteRevision')::bigint), greatest(p_cursor, 0))
  into next_cursor from jsonb_array_elements(changes) item;

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

create or replace function public.revoke_storybound_device(
  p_actor_device_id uuid,
  p_actor_device_token text,
  p_target_device_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_session_id uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
  actor_vault_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if p_actor_device_id = p_target_device_id then
    raise exception 'The active device cannot revoke itself';
  end if;
  if current_session_id is null or not exists (
    select 1 from auth.sessions
    where id = current_session_id and user_id = current_user_id
      and (not_after is null or not_after > now())
  ) then raise exception 'Authentication session is not active'; end if;

  select vault_id into actor_vault_id
  from public.storybound_devices
  where id = p_actor_device_id and owner_id = current_user_id
    and state = 'active'
    and device_auth_hash = encode(extensions.digest(p_actor_device_token, 'sha256'), 'hex');
  if actor_vault_id is null then raise exception 'Active device not found'; end if;

  update public.storybound_devices
  set session_id = current_session_id, last_seen_at = now()
  where id = p_actor_device_id and vault_id = actor_vault_id;

  update public.storybound_devices
  set state = 'revoked', revoked_at = now()
  where id = p_target_device_id and vault_id = actor_vault_id and owner_id = current_user_id;
  if not found then raise exception 'Target device not found'; end if;
end;
$$;

revoke all on function public.create_storybound_vault(uuid, uuid, text, text, integer, text, text, text)
  from public, anon;
revoke all on function public.register_storybound_device(uuid, uuid, text, text, text)
  from public, anon;
revoke all on function public.get_storybound_bootstrap() from public, anon;
revoke all on function public.push_storybound_mutations(uuid, uuid, text, jsonb)
  from public, anon;
revoke all on function public.pull_storybound_changes(uuid, uuid, text, bigint, integer)
  from public, anon;
revoke all on function public.revoke_storybound_device(uuid, text, uuid)
  from public, anon;

grant execute on function public.create_storybound_vault(uuid, uuid, text, text, integer, text, text, text)
  to authenticated;
grant execute on function public.register_storybound_device(uuid, uuid, text, text, text)
  to authenticated;
grant execute on function public.get_storybound_bootstrap() to authenticated;
grant execute on function public.push_storybound_mutations(uuid, uuid, text, jsonb)
  to authenticated;
grant execute on function public.pull_storybound_changes(uuid, uuid, text, bigint, integer)
  to authenticated;
grant execute on function public.revoke_storybound_device(uuid, text, uuid)
  to authenticated;
