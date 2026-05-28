begin;

create or replace function public.replace_writing_collections(
  p_writing_id uuid,
  p_collection_ids uuid[],
  p_added_at timestamptz default timezone('utc', now())
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_collection_ids uuid[] := coalesce(
    array(
      select distinct collection_id
      from unnest(coalesce(p_collection_ids, '{}')) as collection_id
    ),
    '{}'
  );
  matched_collection_count integer := 0;
begin
  if auth.uid() is null then
    raise sqlstate 'PT401' using message = 'No active session.';
  end if;

  if not exists (
    select 1
    from public.writings w
    where w.id = p_writing_id
      and w.author_id = auth.uid()
      and w.deleted_at is null
  ) then
    raise sqlstate 'PT404' using message = 'Writing not found.';
  end if;

  if array_length(normalized_collection_ids, 1) is not null then
    select count(*)
    into matched_collection_count
    from public.collections c
    where c.owner_id = auth.uid()
      and c.id = any(normalized_collection_ids);

    if matched_collection_count <> array_length(normalized_collection_ids, 1) then
      raise sqlstate 'PT403' using message = 'One or more collections do not belong to the active user.';
    end if;
  end if;

  delete from public.writing_collections
  where writing_id = p_writing_id;

  if array_length(normalized_collection_ids, 1) is not null then
    insert into public.writing_collections (writing_id, collection_id, added_at)
    select p_writing_id, collection_id, p_added_at
    from unnest(normalized_collection_ids) as collection_id;
  end if;
end;
$$;

revoke all on function public.replace_writing_collections(uuid, uuid[], timestamptz) from public;
grant execute on function public.replace_writing_collections(uuid, uuid[], timestamptz) to authenticated;

commit;

-- Rollback reference (manual):
-- create or replace function public.replace_writing_collections(
--   p_writing_id uuid,
--   p_collection_ids uuid[],
--   p_added_at timestamptz default timezone('utc', now())
-- )
-- returns void
-- language plpgsql
-- security definer
-- set search_path = public
-- as $rollback$
-- declare
--   normalized_collection_ids uuid[] := coalesce(
--     array(
--       select distinct collection_id
--       from unnest(coalesce(p_collection_ids, '{}')) as collection_id
--     ),
--     '{}'
--   );
--   matched_collection_count integer := 0;
-- begin
--   if auth.uid() is null then
--     raise sqlstate 'PT401' using message = 'No active session.';
--   end if;
--
--   if not exists (
--     select 1
--     from public.writings w
--     where w.id = p_writing_id
--       and w.author_id = auth.uid()
--       and w.deleted_at is null
--   ) then
--     raise sqlstate 'PT404' using message = 'Writing not found.';
--   end if;
--
--   if array_length(normalized_collection_ids, 1) is not null then
--     select count(*)
--     into matched_collection_count
--     from public.collections c
--     where c.owner_id = auth.uid()
--       and c.deleted_at is null
--       and c.id = any(normalized_collection_ids);
--
--     if matched_collection_count <> array_length(normalized_collection_ids, 1) then
--       raise sqlstate 'PT403' using message = 'One or more collections do not belong to the active user.';
--     end if;
--   end if;
--
--   delete from public.writing_collections
--   where writing_id = p_writing_id;
--
--   if array_length(normalized_collection_ids, 1) is not null then
--     insert into public.writing_collections (writing_id, collection_id, added_at)
--     select p_writing_id, collection_id, p_added_at
--     from unnest(normalized_collection_ids) as collection_id;
--   end if;
-- end;
-- $rollback$;
