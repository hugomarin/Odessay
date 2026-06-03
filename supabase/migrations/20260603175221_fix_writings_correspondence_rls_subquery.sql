begin;

drop policy if exists writings_insert_author on public.writings;
create policy writings_insert_author
on public.writings
for insert
with check (
  auth.uid() = author_id
  and (
    parent_id is null
    or public.can_read_writing(parent_id, auth.uid())
  )
  and (
    correspondence_id is null
    or exists (
      select 1
      from public.correspondences c
      where c.id = correspondence_id
        and (
          c.root_writing_id = id
          or exists (
            select 1
            from public.writings parent
            where parent.id = parent_id
              and parent.correspondence_id = c.id
          )
        )
    )
  )
);

drop policy if exists writings_update_author on public.writings;
create policy writings_update_author
on public.writings
for update
using (auth.uid() = author_id)
with check (
  auth.uid() = author_id
  and (
    parent_id is null
    or public.can_read_writing(parent_id, auth.uid())
  )
  and (
    correspondence_id is null
    or exists (
      select 1
      from public.correspondences c
      where c.id = correspondence_id
        and (
          c.root_writing_id = id
          or exists (
            select 1
            from public.writings parent
            where parent.id = parent_id
              and parent.correspondence_id = c.id
          )
        )
    )
  )
);

commit;

-- Rollback reference (manual):
-- begin;
-- drop policy if exists writings_insert_author on public.writings;
-- create policy writings_insert_author
-- on public.writings
-- for insert
-- with check (
--   auth.uid() = author_id
--   and (
--     parent_id is null
--     or public.can_read_writing(parent_id, auth.uid())
--   )
--   and (
--     correspondence_id is null
--     or exists (
--       select 1
--       from public.correspondences c
--       where c.id = correspondence_id
--         and (
--           c.root_writing_id = id
--           or exists (
--             select 1
--             from public.writings parent
--             where parent.id = parent_id
--               and parent.correspondence_id = c.id
--           )
--         )
--     )
--   )
-- );
-- drop policy if exists writings_update_author on public.writings;
-- create policy writings_update_author
-- on public.writings
-- for update
-- using (auth.uid() = author_id)
-- with check (
--   auth.uid() = author_id
--   and (
--     parent_id is null
--     or public.can_read_writing(parent_id, auth.uid())
--   )
--   and (
--     correspondence_id is null
--     or exists (
--       select 1
--       from public.correspondences c
--       where c.id = correspondence_id
--         and (
--           c.root_writing_id = c.id
--           or exists (
--             select 1
--             from public.writings parent
--             where parent.id = parent.parent_id
--               and parent.correspondence_id = c.id
--           )
--         )
--     )
--   )
-- );
-- commit;
