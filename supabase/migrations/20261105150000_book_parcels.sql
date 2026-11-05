-- Send a book to another account. Parcels are sealed on the sender's device for the recipient's
-- key, so the server only relays ciphertext. It can see an address, a size and a date, and never
-- a title, a name or a word of the book.
--
-- An address is a fingerprint of the account's public keys. A sender checks the keys it gets back
-- against the address it was given, so this table cannot quietly redirect a book.

create table public.storybound_share_addresses (
  address text primary key check (address ~ '^[A-HJ-NP-Z2-9]{16}$'),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  vault_id uuid not null references public.storybound_vaults(id) on delete cascade,
  encryption_public_key text not null check (char_length(encryption_public_key) between 40 and 64),
  signing_public_key text not null check (char_length(signing_public_key) between 40 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.storybound_parcels (
  id uuid primary key,
  recipient_address text not null
    references public.storybound_share_addresses(address) on delete cascade,
  sender_owner_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (char_length(label) between 16 and 16384),
  body text not null check (char_length(body) between 16 and 25165824),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index storybound_parcels_recipient_idx
  on public.storybound_parcels (recipient_address, expires_at);
create index storybound_parcels_sender_idx
  on public.storybound_parcels (sender_owner_id, recipient_address);

alter table public.storybound_share_addresses enable row level security;
alter table public.storybound_parcels enable row level security;
revoke all on public.storybound_share_addresses from public, anon, authenticated;
revoke all on public.storybound_parcels from public, anon, authenticated;

create or replace function public.publish_storybound_address(
  p_device_id uuid,
  p_device_token text,
  p_address text,
  p_encryption_public_key text,
  p_signing_public_key text
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
  if exists (
    select 1 from public.storybound_share_addresses
    where address = p_address and owner_id <> auth.uid()
  ) then
    raise exception 'Address already in use';
  end if;
  insert into public.storybound_share_addresses (
    address, owner_id, vault_id, encryption_public_key, signing_public_key
  ) values (
    p_address, auth.uid(), device_vault_id, p_encryption_public_key, p_signing_public_key
  )
  on conflict (owner_id) do update set
    address = excluded.address,
    vault_id = excluded.vault_id,
    encryption_public_key = excluded.encryption_public_key,
    signing_public_key = excluded.signing_public_key,
    updated_at = now();
end;
$$;

-- Exact match only: there is no way to browse or search for who has an account.
create or replace function public.find_storybound_address(
  p_device_id uuid,
  p_device_token text,
  p_address text
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  found public.storybound_share_addresses%rowtype;
begin
  perform public.storybound_require_session();
  perform public.storybound_require_active_device(p_device_id, p_device_token);
  select * into found from public.storybound_share_addresses where address = p_address;
  if found.address is null then return null; end if;
  return jsonb_build_object(
    'address', found.address,
    'encryptionPublicKey', found.encryption_public_key,
    'signingPublicKey', found.signing_public_key
  );
end;
$$;

create or replace function public.send_storybound_parcel(
  p_device_id uuid,
  p_device_token text,
  p_parcel_id uuid,
  p_recipient_address text,
  p_label text,
  p_body text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  expiry timestamptz := now() + interval '30 days';
begin
  perform public.storybound_require_session();
  perform public.storybound_require_active_device(p_device_id, p_device_token);
  delete from public.storybound_parcels where expires_at <= now();
  if exists (
    select 1 from public.storybound_parcels
    where id = p_parcel_id and sender_owner_id = auth.uid()
  ) then
    return jsonb_build_object('parcelId', p_parcel_id, 'duplicate', true);
  end if;
  if not exists (
    select 1 from public.storybound_share_addresses where address = p_recipient_address
  ) then
    raise exception 'Address not found';
  end if;
  if (
    select count(*) from public.storybound_parcels
    where sender_owner_id = auth.uid() and recipient_address = p_recipient_address
  ) >= 20 then
    raise exception 'Too many unopened parcels for this person';
  end if;
  if (
    select count(*) from public.storybound_parcels where recipient_address = p_recipient_address
  ) >= 100 then
    raise exception 'This person has too many unopened parcels';
  end if;
  insert into public.storybound_parcels (
    id, recipient_address, sender_owner_id, label, body, expires_at
  ) values (
    p_parcel_id, p_recipient_address, auth.uid(), p_label, p_body, expiry
  );
  return jsonb_build_object('parcelId', p_parcel_id, 'expiresAt', expiry);
end;
$$;

create or replace function public.list_storybound_parcels(
  p_device_id uuid,
  p_device_token text
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.storybound_require_session();
  perform public.storybound_require_active_device(p_device_id, p_device_token);
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', parcel.id,
        'label', parcel.label,
        'createdAt', parcel.created_at,
        'expiresAt', parcel.expires_at
      ) order by parcel.created_at
    )
    from public.storybound_parcels parcel
    join public.storybound_share_addresses address
      on address.address = parcel.recipient_address
    where address.owner_id = auth.uid() and parcel.expires_at > now()
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_storybound_parcel(
  p_device_id uuid,
  p_device_token text,
  p_parcel_id uuid
) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  found_body text;
begin
  perform public.storybound_require_session();
  perform public.storybound_require_active_device(p_device_id, p_device_token);
  select parcel.body into found_body
  from public.storybound_parcels parcel
  join public.storybound_share_addresses address on address.address = parcel.recipient_address
  where parcel.id = p_parcel_id and address.owner_id = auth.uid() and parcel.expires_at > now();
  if found_body is null then raise exception 'Parcel not found'; end if;
  return found_body;
end;
$$;

-- Accepting and declining both end here. Only the recipient can remove a parcel.
create or replace function public.delete_storybound_parcel(
  p_device_id uuid,
  p_device_token text,
  p_parcel_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.storybound_require_session();
  perform public.storybound_require_active_device(p_device_id, p_device_token);
  delete from public.storybound_parcels parcel
  using public.storybound_share_addresses address
  where parcel.id = p_parcel_id
    and address.address = parcel.recipient_address
    and address.owner_id = auth.uid();
end;
$$;

revoke all on function public.publish_storybound_address(uuid, text, text, text, text)
  from public, anon;
revoke all on function public.find_storybound_address(uuid, text, text) from public, anon;
revoke all on function public.send_storybound_parcel(uuid, text, uuid, text, text, text)
  from public, anon;
revoke all on function public.list_storybound_parcels(uuid, text) from public, anon;
revoke all on function public.get_storybound_parcel(uuid, text, uuid) from public, anon;
revoke all on function public.delete_storybound_parcel(uuid, text, uuid) from public, anon;

grant execute on function public.publish_storybound_address(uuid, text, text, text, text)
  to authenticated;
grant execute on function public.find_storybound_address(uuid, text, text) to authenticated;
grant execute on function public.send_storybound_parcel(uuid, text, uuid, text, text, text)
  to authenticated;
grant execute on function public.list_storybound_parcels(uuid, text) to authenticated;
grant execute on function public.get_storybound_parcel(uuid, text, uuid) to authenticated;
grant execute on function public.delete_storybound_parcel(uuid, text, uuid) to authenticated;
