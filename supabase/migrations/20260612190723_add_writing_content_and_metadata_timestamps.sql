-- Add content_updated_at and metadata_updated_at to writings
--
-- content_updated_at tracks real editorial work: title, body_json, body_text.
-- metadata_updated_at tracks status, visibility, version changes.
-- Both start as copies of updated_at so existing rows keep a stable baseline.

begin;

-- Add columns if they don't exist (idempotent)
alter table public.writings
  add column if not exists content_updated_at timestamptz default now(),
  add column if not exists metadata_updated_at timestamptz default now();

-- Backfill from updated_at for existing rows where still null
update public.writings
  set content_updated_at = updated_at,
      metadata_updated_at = updated_at
  where content_updated_at is null
     or metadata_updated_at is null;

-- Make columns non-nullable after backfill
alter table public.writings
  alter column content_updated_at set not null,
  alter column content_updated_at set default now(),
  alter column metadata_updated_at set not null,
  alter column metadata_updated_at set default now();

-- Drop existing triggers if present so the migration is idempotent
 drop trigger if exists writings_content_updated_at on public.writings;
 drop trigger if exists writings_metadata_updated_at on public.writings;
drop function if exists public.set_writing_content_updated_at();
drop function if exists public.set_writing_metadata_updated_at();

-- Trigger function: content_updated_at
 create or replace function public.set_writing_content_updated_at()
returns trigger as $$
begin
  if (
    old.title is distinct from new.title
    or old.body_json is distinct from new.body_json
    or old.body_text is distinct from new.body_text
  ) then
    new.content_updated_at := now();
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- Trigger function: metadata_updated_at
 create or replace function public.set_writing_metadata_updated_at()
returns trigger as $$
begin
  if (
    old.status is distinct from new.status
    or old.visibility is distinct from new.visibility
    or old.version is distinct from new.version
  ) then
    new.metadata_updated_at := now();
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- Triggers run before update so they can mutate new.
 create trigger writings_content_updated_at
  before update on public.writings
  for each row
  execute function public.set_writing_content_updated_at();

 create trigger writings_metadata_updated_at
  before update on public.writings
  for each row
  execute function public.set_writing_metadata_updated_at();

commit;

-- Update replace_writing_collections to also bump metadata_updated_at
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
      and c.deleted_at is null
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

  update public.writings
    set metadata_updated_at = now()
    where id = p_writing_id;
end;
$$;

-- Rollback (manual):
-- begin;
-- drop trigger if exists writings_content_updated_at on public.writings;
-- drop trigger if exists writings_metadata_updated_at on public.writings;
-- drop function if exists public.set_writing_content_updated_at();
-- drop function if exists public.set_writing_metadata_updated_at();
-- alter table public.writings drop column if exists content_updated_at;
-- alter table public.writings drop column if exists metadata_updated_at;
-- commit;
