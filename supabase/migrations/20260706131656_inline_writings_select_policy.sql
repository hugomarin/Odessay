begin;

-- Helper: checks whether the current user has a writing_shares row for a given
-- writing. It only touches writing_shares (never writings) so it can safely be
-- called from the writings SELECT policy without triggering RLS recursion
-- (42P17) with writing_shares_select_related.
create or replace function public.has_writing_share(target_writing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.writing_shares
    where writing_id = target_writing_id
      and shared_with_id = auth.uid()
  );
$$;

-- Replace the SELECT policy on writings so the dominant case (owner reading
-- their own rows) resolves inline on the author_id index without invoking a
-- per-row function. The OR branches are ordered owner -> public -> shared so
-- the executor short-circuits before calling has_writing_share for owned rows.
drop policy if exists writings_select_accessible on public.writings;

create policy writings_select_accessible
on public.writings
for select
using (
  deleted_at is null and (
    author_id = (select auth.uid())
    or visibility = 'public'
    or (visibility = 'shared' and public.has_writing_share(id))
  )
);

commit;

-- Rollback reference (manual):
-- begin;
-- drop policy if exists writings_select_accessible on public.writings;
-- create policy writings_select_accessible
-- on public.writings
-- for select
-- using (public.can_read_writing(id, auth.uid()));
-- drop function if exists public.has_writing_share(uuid);
-- commit;
