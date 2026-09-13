begin;

-- ODE-519: public.rotate_test_preview_link is SECURITY DEFINER. Its original
-- migration (20260320002000) granted service_role execute but never revoked
-- PostgreSQL's default PUBLIC execute privilege, and the function trusted a
-- caller-supplied p_inviter_id without checking it against the writing's real
-- owner. Both allow an anon/authenticated caller to rotate a preview link for
-- any writing_id/inviter_id pair, bypassing the server-side
-- verifyWritingOwnership check entirely.

create or replace function public.rotate_test_preview_link(
  p_inviter_id uuid,
  p_writing_id uuid,
  p_token text
)
returns table (
  token text,
  created_at timestamptz,
  replaced_previous boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker_email text;
  v_prev_count integer := 0;
  v_created_at timestamptz;
  v_is_owner boolean;
begin
  if p_inviter_id is null or p_writing_id is null then
    raise exception 'p_inviter_id and p_writing_id are required';
  end if;

  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'p_token is required';
  end if;

  -- Requirement 2 (ODE-519): the function itself is the enforcement point,
  -- not just the caller route (lib/services/web-sharing-service.ts already
  -- calls verifyWritingOwnership before this RPC, but that check must not be
  -- the only thing standing between a request and privileged execution).
  select exists (
    select 1
    from public.writings w
    where w.id = p_writing_id
      and w.author_id = p_inviter_id
      and w.deleted_at is null
  ) into v_is_owner;

  if not v_is_owner then
    raise exception 'p_inviter_id is not the owner of the active writing';
  end if;

  v_marker_email := 'ux-eval+' || p_writing_id::text || '@odessay.local';

  perform pg_advisory_xact_lock(
    hashtextextended(p_inviter_id::text || ':' || p_writing_id::text || ':ux-preview', 0)
  );

  update public.invitations
  set status = 'expired'
  where inviter_id = p_inviter_id
    and writing_id = p_writing_id
    and email = v_marker_email
    and status = 'pending';

  get diagnostics v_prev_count = row_count;

  insert into public.invitations (
    inviter_id,
    writing_id,
    email,
    token,
    status
  ) values (
    p_inviter_id,
    p_writing_id,
    v_marker_email,
    p_token,
    'pending'
  )
  returning invitations.created_at into v_created_at;

  return query
  select
    p_token,
    v_created_at,
    (v_prev_count > 0);
end;
$$;

-- Requirement 1: CREATE OR REPLACE preserves whatever ACL entries already
-- exist on the function (including the implicit PUBLIC grant from the
-- original CREATE FUNCTION), so the revoke has to be explicit and separate
-- from the redefinition above, not assumed to follow from it.
revoke execute on function public.rotate_test_preview_link(uuid, uuid, text) from public;
revoke execute on function public.rotate_test_preview_link(uuid, uuid, text) from anon;
revoke execute on function public.rotate_test_preview_link(uuid, uuid, text) from authenticated;
grant execute on function public.rotate_test_preview_link(uuid, uuid, text) to service_role;

commit;

-- Rollback reference (manual):
-- Restoring the pre-ODE-519 behavior means re-introducing the vulnerability;
-- there is no safe rollback beyond redeploying the previous function body and
-- re-granting PUBLIC execute. Do not do this without a matching decision.
