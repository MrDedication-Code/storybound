-- Storybound never stores a recovery code, only a value wrapped by it, so a user who
-- misses the one-time display screen has no way to see the original code again. The
-- supported remedy is generating a replacement from a device that is already unlocked
-- (and therefore already holds the vault key): re-wrap the same vault key under a fresh
-- code and replace the stored recovery envelope, invalidating the old code.

create or replace function public.rotate_storybound_recovery_envelope(
  p_device_id uuid,
  p_device_token text,
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
  target_vault_id uuid;
  target_key_epoch integer;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if current_session_id is null or not exists (
    select 1 from auth.sessions
    where id = current_session_id and user_id = current_user_id
      and (not_after is null or not_after > now())
  ) then raise exception 'Authentication session is not active'; end if;
  if char_length(p_recovery_verifier) < 32 or char_length(p_recovery_verifier) > 256 then
    raise exception 'Invalid recovery verifier';
  end if;

  select vault_id into target_vault_id
  from public.storybound_devices
  where id = p_device_id and owner_id = current_user_id and state = 'active'
    and device_auth_hash = encode(extensions.digest(p_device_token, 'sha256'), 'hex');
  if target_vault_id is null then raise exception 'Active device not found'; end if;

  select key_epoch into target_key_epoch
  from public.storybound_vaults
  where id = target_vault_id and owner_id = current_user_id
  for update;
  if target_key_epoch is null then raise exception 'Vault not found'; end if;

  update public.storybound_vaults
  set recovery_verifier = p_recovery_verifier, updated_at = now()
  where id = target_vault_id and owner_id = current_user_id;

  update public.storybound_key_envelopes
  set nonce = p_recovery_nonce, ciphertext = p_recovery_ciphertext, created_at = now()
  where vault_id = target_vault_id and owner_id = current_user_id
    and kind = 'recovery' and key_epoch = target_key_epoch;
  if not found then raise exception 'Recovery envelope not found'; end if;

  update public.storybound_devices
  set session_id = current_session_id, last_seen_at = now()
  where id = p_device_id and vault_id = target_vault_id;

  return jsonb_build_object('vaultId', target_vault_id, 'keyEpoch', target_key_epoch);
end;
$$;

revoke all on function public.rotate_storybound_recovery_envelope(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.rotate_storybound_recovery_envelope(uuid, text, text, text, text)
  to authenticated;
