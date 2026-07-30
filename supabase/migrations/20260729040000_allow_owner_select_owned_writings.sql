begin;

-- `can_read_writing()` sees the pre-update tombstone while a writing is being
-- restored. Give authors a direct SELECT path to every row they own so both
-- the archived OLD row and restored NEW row remain visible during UPDATE.
drop policy if exists writings_select_author_archived on public.writings;
drop policy if exists writings_select_author_owned on public.writings;
create policy writings_select_author_owned
on public.writings
for select
using (auth.uid() = author_id);

commit;

-- Rollback:
-- drop policy if exists writings_select_author_owned on public.writings;
-- create policy writings_select_author_archived on public.writings for select
-- using (auth.uid() = author_id and deleted_at is not null);
