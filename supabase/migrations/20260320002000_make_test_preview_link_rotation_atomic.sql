begin;

create unique index if not exists idx_invitations_pending_ux_eval_unique
on public.invitations(inviter_id, writing_id, email)
where status = 'pending'
  and writing_id is not null
  and email like 'ux-eval+%@odessay.local';

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
begin
  if p_inviter_id is null or p_writing_id is null then
    raise exception 'p_inviter_id and p_writing_id are required';
  end if;

  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'p_token is required';
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

grant execute on function public.rotate_test_preview_link(uuid, uuid, text) to service_role;

commit;

-- Rollback reference (manual):
-- drop function if exists public.rotate_test_preview_link(uuid, uuid, text);
-- drop index if exists public.idx_invitations_pending_ux_eval_unique;
