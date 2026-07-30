begin;

-- PostgreSQL requires UPDATE targets to be visible through a SELECT policy.
-- The general writings policy intentionally hides soft-deleted rows, so the
-- owner needs this narrow companion policy to restore or inspect an archive.
drop policy if exists writings_select_author_archived on public.writings;
create policy writings_select_author_archived
on public.writings
for select
using (auth.uid() = author_id and deleted_at is not null);

commit;

-- Rollback:
-- drop policy if exists writings_select_author_archived on public.writings;
