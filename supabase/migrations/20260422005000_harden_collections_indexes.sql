begin;

create index if not exists idx_collections_owner_updated_at
  on public.collections (owner_id, updated_at desc);

create index if not exists idx_collections_public_owner
  on public.collections (visibility, owner_id)
  where visibility = 'public';

create index if not exists idx_writing_collections_writing_id
  on public.writing_collections (writing_id);

drop policy if exists collections_select_visible on public.collections;
create policy collections_select_visible
on public.collections
for select
using (
  owner_id = auth.uid()
  or visibility = 'public'
);

drop policy if exists writing_collections_select_visible on public.writing_collections;
create policy writing_collections_select_visible
on public.writing_collections
for select
using (
  public.can_read_writing(writing_id, auth.uid())
  and exists (
    select 1
    from public.collections c
    where c.id = collection_id
      and (c.owner_id = auth.uid() or c.visibility = 'public')
  )
);

commit;

-- Rollback reference (manual):
-- drop index if exists public.idx_writing_collections_writing_id;
-- drop index if exists public.idx_collections_public_owner;
-- drop index if exists public.idx_collections_owner_updated_at;
-- drop policy if exists collections_select_visible on public.collections;
-- create policy collections_select_visible
-- on public.collections
-- for select
-- using (owner_id = auth.uid() or visibility = 'public');
-- drop policy if exists writing_collections_select_visible on public.writing_collections;
-- create policy writing_collections_select_visible
-- on public.writing_collections
-- for select
-- using (
--   public.can_read_writing(writing_id, auth.uid())
--   and exists (
--     select 1
--     from public.collections c
--     where c.id = collection_id
--       and (c.owner_id = auth.uid() or c.visibility = 'public')
--   )
-- );
