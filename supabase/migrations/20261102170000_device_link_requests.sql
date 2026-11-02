-- Link a new device by approving it from one that is already unlocked, instead of typing the
-- recovery code. The server only relays public keys and an envelope that is sealed for the new
-- device; it never sees the vault key.
--
-- 1. The new device signs in and calls request_storybound_device_link with a random x25519
--    public key and the SHA-256 of its future possession token.
-- 2. An unlocked device lists pending requests and acknowledges one with its own ephemeral
--    public key. Both screens then show six words derived from the vault, request, and both
--    public keys, so any substituted key on either side changes the words.
-- 3. After the user confirms that the words match on both devices, the approver seals the vault
--    key for the requester and calls approve_storybound_device_link, which registers the device.
-- 4. The requester collects the envelope with get_storybound_device_link.

create table public.storybound_link_requests (
  id uuid primary key,
  vault_id uuid not null references public.storybound_vaults(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  requested_device_id uuid not null,
  device_name text not null check (char_length(device_name) between 1 and 120),
  requester_public_key text not null check (char_length(requester_public_key) between 40 and 64),
  device_auth_hash text not null check (char_length(device_auth_hash) = 64),
  requester_session_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'declined', 'cancelled')),
  approver_device_id uuid references public.storybound_devices(id) on delete cascade,
  approver_public_key text check (
    approver_public_key is null or char_length(approver_public_key) between 40 and 64
  ),
  key_epoch integer check (key_epoch is null or key_epoch > 0),
  envelope_nonce text check (envelope_nonce is null or char_length(envelope_nonce) between 8 and 128),
  envelope_ciphertext text check (
    envelope_ciphertext is null or char_length(envelope_ciphertext) between 16 and 4096
  ),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  check (
    status <> 'approved' or (
      approver_device_id is not null and approver_public_key is not null
      and key_epoch is not null and envelope_nonce is not null and envelope_ciphertext is not null
    )
  )
);

create index storybound_link_requests_vault_idx
  on public.storybound_link_requests (vault_id, status, expires_at);

alter table public.storybound_link_requests enable row level security;
revoke all on public.storybound_link_requests from public, anon, authenticated;

create or replace function public.storybound_require_session()
returns uuid
language plpgsql
stable
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
  return current_session_id;
end;
$$;

create or replace function public.storybound_require_active_device(
  p_device_id uuid,
  p_device_token text
) returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  device_vault_id uuid;
begin
  select vault_id into device_vault_id
  from public.storybound_devices
  where id = p_device_id and owner_id = auth.uid() and state = 'active'
    and device_auth_hash = encode(extensions.digest(p_device_token, 'sha256'), 'hex');
  if device_vault_id is null then raise exception 'Active device not found'; end if;
  return device_vault_id;
end;
$$;

create or replace function public.request_storybound_device_link(
  p_request_id uuid,
  p_device_id uuid,
  p_device_name text,
  p_device_token text,
  p_public_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_session_id uuid := public.storybound_require_session();
  target_vault_id uuid;
  target_key_epoch integer;
  expiry timestamptz := now() + interval '10 minutes';
begin
  if char_length(p_device_token) < 32 or char_length(p_device_token) > 256 then
    raise exception 'Invalid device token';
  end if;
  select id, key_epoch into target_vault_id, target_key_epoch
  from public.storybound_vaults where owner_id = auth.uid();
  if target_vault_id is null then raise exception 'Vault not found'; end if;
  if exists (select 1 from public.storybound_devices where id = p_device_id) then
    raise exception 'Device already registered';
  end if;
  if (
    select count(*) from public.storybound_link_requests
    where vault_id = target_vault_id and status = 'pending' and expires_at > now()
  ) >= 3 then
    raise exception 'Too many pending link requests';
  end if;

  insert into public.storybound_link_requests (
    id, vault_id, owner_id, requested_device_id, device_name, requester_public_key,
    device_auth_hash, requester_session_id, expires_at
  ) values (
    p_request_id, target_vault_id, auth.uid(), p_device_id, left(trim(p_device_name), 120),
    p_public_key, encode(extensions.digest(p_device_token, 'sha256'), 'hex'),
    current_session_id, expiry
  );
  return jsonb_build_object(
    'requestId', p_request_id, 'vaultId', target_vault_id,
    'keyEpoch', target_key_epoch, 'expiresAt', expiry
  );
end;
$$;

create or replace function public.list_storybound_link_requests(
  p_device_id uuid,
  p_device_token text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  device_vault_id uuid;
begin
  perform public.storybound_require_session();
  device_vault_id := public.storybound_require_active_device(p_device_id, p_device_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'requestId', id, 'deviceName', device_name,
      'requesterPublicKey', requester_public_key,
      'approverDeviceId', approver_device_id, 'approverPublicKey', approver_public_key,
      'createdAt', created_at, 'expiresAt', expires_at
    ) order by created_at)
    from public.storybound_link_requests
    where vault_id = device_vault_id and status = 'pending' and expires_at > now()
  ), '[]'::jsonb);
end;
$$;

create or replace function public.acknowledge_storybound_device_link(
  p_device_id uuid,
  p_device_token text,
  p_request_id uuid,
  p_public_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  device_vault_id uuid;
  request record;
begin
  perform public.storybound_require_session();
  device_vault_id := public.storybound_require_active_device(p_device_id, p_device_token);
  select * into request from public.storybound_link_requests
  where id = p_request_id and vault_id = device_vault_id
  for update;
  if not found or request.status <> 'pending' or request.expires_at <= now() then
    raise exception 'Link request not found';
  end if;
  -- The first acknowledgement fixes the approver key the six words are derived from.
  if request.approver_public_key is not null then
    if request.approver_device_id = p_device_id and request.approver_public_key = p_public_key then
      return jsonb_build_object('requestId', p_request_id, 'approverPublicKey', p_public_key);
    end if;
    raise exception 'Link request already acknowledged';
  end if;
  update public.storybound_link_requests
  set approver_device_id = p_device_id, approver_public_key = p_public_key, updated_at = now()
  where id = p_request_id;
  return jsonb_build_object('requestId', p_request_id, 'approverPublicKey', p_public_key);
end;
$$;

create or replace function public.approve_storybound_device_link(
  p_device_id uuid,
  p_device_token text,
  p_request_id uuid,
  p_key_epoch integer,
  p_envelope_nonce text,
  p_envelope_ciphertext text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  device_vault_id uuid;
  request record;
begin
  perform public.storybound_require_session();
  device_vault_id := public.storybound_require_active_device(p_device_id, p_device_token);
  select * into request from public.storybound_link_requests
  where id = p_request_id and vault_id = device_vault_id
  for update;
  if not found or request.status <> 'pending' or request.expires_at <= now() then
    raise exception 'Link request not found';
  end if;
  if request.approver_device_id is distinct from p_device_id then
    raise exception 'Acknowledge the link request before approving it';
  end if;
  if p_key_epoch <> (select key_epoch from public.storybound_vaults where id = device_vault_id) then
    raise exception 'Invalid key epoch';
  end if;

  insert into public.storybound_devices (
    id, vault_id, owner_id, display_name, session_id, device_auth_hash
  ) values (
    request.requested_device_id, device_vault_id, request.owner_id, request.device_name,
    request.requester_session_id, request.device_auth_hash
  );
  insert into public.storybound_key_envelopes (
    vault_id, owner_id, kind, recipient_device_id, key_epoch, nonce, ciphertext,
    recipient_public_key
  ) values (
    device_vault_id, request.owner_id, 'device', request.requested_device_id, p_key_epoch,
    p_envelope_nonce, p_envelope_ciphertext, request.requester_public_key
  );
  update public.storybound_link_requests
  set status = 'approved', key_epoch = p_key_epoch, envelope_nonce = p_envelope_nonce,
      envelope_ciphertext = p_envelope_ciphertext, updated_at = now()
  where id = p_request_id;
  update public.storybound_devices
  set last_seen_at = now()
  where id = p_device_id;
  return jsonb_build_object('requestId', p_request_id, 'deviceId', request.requested_device_id);
end;
$$;

create or replace function public.decline_storybound_device_link(
  p_device_id uuid,
  p_device_token text,
  p_request_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  device_vault_id uuid;
begin
  perform public.storybound_require_session();
  device_vault_id := public.storybound_require_active_device(p_device_id, p_device_token);
  update public.storybound_link_requests
  set status = 'declined', updated_at = now()
  where id = p_request_id and vault_id = device_vault_id and status = 'pending';
  if not found then raise exception 'Link request not found'; end if;
end;
$$;

create or replace function public.get_storybound_device_link(
  p_request_id uuid,
  p_device_token text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request record;
begin
  perform public.storybound_require_session();
  select * into request from public.storybound_link_requests
  where id = p_request_id and owner_id = auth.uid()
    and device_auth_hash = encode(extensions.digest(p_device_token, 'sha256'), 'hex');
  if not found then raise exception 'Link request not found'; end if;
  return jsonb_build_object(
    'requestId', request.id,
    'vaultId', request.vault_id,
    'deviceId', request.requested_device_id,
    'status', case
      when request.status = 'pending' and request.expires_at <= now() then 'expired'
      else request.status
    end,
    'approverPublicKey', request.approver_public_key,
    'keyEpoch', request.key_epoch,
    'envelope', case when request.status = 'approved' then jsonb_build_object(
      'version', 1, 'kind', 'device', 'vaultId', request.vault_id,
      'keyEpoch', request.key_epoch, 'nonce', request.envelope_nonce,
      'ciphertext', request.envelope_ciphertext,
      'recipientPublicKey', request.requester_public_key
    ) end,
    'expiresAt', request.expires_at
  );
end;
$$;

create or replace function public.cancel_storybound_device_link(
  p_request_id uuid,
  p_device_token text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.storybound_require_session();
  update public.storybound_link_requests
  set status = 'cancelled', updated_at = now()
  where id = p_request_id and owner_id = auth.uid() and status = 'pending'
    and device_auth_hash = encode(extensions.digest(p_device_token, 'sha256'), 'hex');
end;
$$;

revoke all on function public.storybound_require_session() from public, anon, authenticated;
revoke all on function public.storybound_require_active_device(uuid, text)
  from public, anon, authenticated;
revoke all on function public.request_storybound_device_link(uuid, uuid, text, text, text)
  from public, anon;
revoke all on function public.list_storybound_link_requests(uuid, text) from public, anon;
revoke all on function public.acknowledge_storybound_device_link(uuid, text, uuid, text)
  from public, anon;
revoke all on function public.approve_storybound_device_link(uuid, text, uuid, integer, text, text)
  from public, anon;
revoke all on function public.decline_storybound_device_link(uuid, text, uuid) from public, anon;
revoke all on function public.get_storybound_device_link(uuid, text) from public, anon;
revoke all on function public.cancel_storybound_device_link(uuid, text) from public, anon;

grant execute on function public.request_storybound_device_link(uuid, uuid, text, text, text)
  to authenticated;
grant execute on function public.list_storybound_link_requests(uuid, text) to authenticated;
grant execute on function public.acknowledge_storybound_device_link(uuid, text, uuid, text)
  to authenticated;
grant execute on function public.approve_storybound_device_link(uuid, text, uuid, integer, text, text)
  to authenticated;
grant execute on function public.decline_storybound_device_link(uuid, text, uuid) to authenticated;
grant execute on function public.get_storybound_device_link(uuid, text) to authenticated;
grant execute on function public.cancel_storybound_device_link(uuid, text) to authenticated;
