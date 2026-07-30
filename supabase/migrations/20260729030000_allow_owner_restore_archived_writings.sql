begin;

-- The general UPDATE policy validates active parent/correspondence relations.
-- A soft-deleted writing may no longer satisfy those active-tree checks, so
-- restoration needs a narrow transition policy of its own.
drop policy if exists writings_update_author_archived_restore on public.writings;
create policy writings_update_author_archived_restore
on public.writings
for update
using (auth.uid() = author_id and deleted_at is not null)
with check (auth.uid() = author_id and deleted_at is null);

commit;

-- Rollback:
-- drop policy if exists writings_update_author_archived_restore on public.writings;
