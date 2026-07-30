begin;

drop policy if exists writings_delete_author_draft on public.writings;
drop policy if exists writings_delete_author_archived on public.writings;
create policy writings_delete_author_archived
on public.writings
for delete
using (auth.uid() = author_id and deleted_at is not null);

commit;

-- Rollback:
-- drop policy if exists writings_delete_author_archived on public.writings;
-- create policy writings_delete_author_draft on public.writings for delete
-- using (auth.uid() = author_id and status = 'draft');
