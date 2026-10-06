begin;

create or replace function public.can_read_writing(
  target_writing_id uuid,
  viewer_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when current_setting('role', true) in ('anon', 'authenticated')
      and viewer_id is distinct from auth.uid()
      then false
    else exists (
      select 1
      from public.writings w
      where w.id = target_writing_id
        and w.deleted_at is null
        and (
          w.visibility = 'public'
          or (viewer_id is not null and w.author_id = viewer_id)
          or (
            viewer_id is not null
            and w.visibility = 'shared'
            and exists (
              select 1
              from public.writing_shares ws
              where ws.writing_id = w.id
                and ws.shared_with_id = viewer_id
            )
          )
        )
    )
  end;
$$;

revoke execute on function public.can_read_writing(uuid, uuid) from public;
grant execute on function public.can_read_writing(uuid, uuid) to anon, authenticated, service_role;

commit;

-- Rollback reference (manual): this restores the pre-guard behavior and
-- re-opens the caller-supplied viewer oracle. Apply only with an explicit
-- rollback decision.
-- begin;
-- create or replace function public.can_read_writing(
--   target_writing_id uuid,
--   viewer_id uuid default auth.uid()
-- )
-- returns boolean
-- language sql
-- stable
-- security definer
-- set search_path = public
-- as $$
--   select exists (
--     select 1
--     from public.writings w
--     where w.id = target_writing_id
--       and w.deleted_at is null
--       and (
--         w.visibility = 'public'
--         or (viewer_id is not null and w.author_id = viewer_id)
--         or (
--           viewer_id is not null
--           and w.visibility = 'shared'
--           and exists (
--             select 1
--             from public.writing_shares ws
--             where ws.writing_id = w.id
--               and ws.shared_with_id = viewer_id
--           )
--         )
--       )
--   );
-- $$;
-- revoke execute on function public.can_read_writing(uuid, uuid) from anon, authenticated, service_role;
-- grant execute on function public.can_read_writing(uuid, uuid) to public, service_role;
-- commit;
