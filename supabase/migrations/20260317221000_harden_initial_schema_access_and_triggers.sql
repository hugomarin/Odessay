begin;

create or replace function public.ensure_unique_username(base_username text, profile_id uuid default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text;
  candidate text;
  suffix integer := 0;
  suffix_text text;
begin
  cleaned := regexp_replace(lower(coalesce(base_username, 'writer')), '[^a-z0-9_-]+', '', 'g');

  if cleaned = '' then
    cleaned := 'writer';
  end if;

  if cleaned ~ '^[0-9]' then
    cleaned := 'u_' || cleaned;
  end if;

  if length(cleaned) < 3 then
    cleaned := cleaned || repeat('x', 3 - length(cleaned));
  end if;

  cleaned := left(cleaned, 32);
  candidate := cleaned;

  while exists (
    select 1
    from public.profiles p
    where p.username = candidate
      and (profile_id is null or p.id <> profile_id)
  ) loop
    suffix := suffix + 1;
    suffix_text := '_' || suffix;
    candidate := left(cleaned, greatest(1, 32 - length(suffix_text))) || suffix_text;
  end loop;

  return candidate;
end;
$$;

create or replace function public.extract_tiptap_text(input_json jsonb)
returns text
language plpgsql
immutable
as $$
declare
  item jsonb;
  output_text text := '';
begin
  if input_json is null then
    return '';
  end if;

  if jsonb_typeof(input_json) = 'object' then
    if input_json ? 'text' then
      output_text := coalesce(input_json ->> 'text', '');
    end if;

    if input_json ? 'content' and jsonb_typeof(input_json -> 'content') = 'array' then
      for item in select value from jsonb_array_elements(input_json -> 'content') loop
        output_text := concat_ws(' ', output_text, public.extract_tiptap_text(item));
      end loop;
    end if;

    return trim(regexp_replace(output_text, '\s+', ' ', 'g'));
  end if;

  if jsonb_typeof(input_json) = 'array' then
    for item in select value from jsonb_array_elements(input_json) loop
      output_text := concat_ws(' ', output_text, public.extract_tiptap_text(item));
    end loop;

    return trim(regexp_replace(output_text, '\s+', ' ', 'g'));
  end if;

  return '';
end;
$$;

create or replace function public.sync_correspondence_metadata(target_correspondence_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_correspondence_id is null then
    return;
  end if;

  update public.correspondences c
  set title = root.title,
      updated_at = timezone('utc', now())
  from public.writings root
  where c.id = target_correspondence_id
    and root.id = c.root_writing_id;
end;
$$;

create or replace function public.touch_correspondence_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_correspondence_metadata(old.correspondence_id);
    return null;
  end if;

  perform public.sync_correspondence_metadata(new.correspondence_id);

  if tg_op = 'UPDATE'
    and old.correspondence_id is distinct from new.correspondence_id then
    perform public.sync_correspondence_metadata(old.correspondence_id);
  end if;

  return null;
end;
$$;

create or replace function public.margins_set_shared_at()
returns trigger
language plpgsql
as $$
begin
  if new.shared then
    if tg_op = 'INSERT' then
      new.shared_at := coalesce(new.shared_at, timezone('utc', now()));
    elsif old.shared = false or new.shared_at is null then
      new.shared_at := coalesce(new.shared_at, timezone('utc', now()));
    end if;
  else
    new.shared_at := null;
  end if;

  return new;
end;
$$;

create or replace view public.public_profiles as
select
  id,
  username,
  display_name,
  bio
from public.profiles;

drop trigger if exists margins_manage_shared_at on public.margins;
create trigger margins_manage_shared_at
before insert or update of shared, shared_at on public.margins
for each row execute function public.margins_set_shared_at();

drop policy if exists profiles_select_public on public.profiles;
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self
on public.profiles
for select
using (auth.uid() = id);

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

revoke select on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant select on public.public_profiles to anon, authenticated;
grant select on public.writing_collections to anon, authenticated;

commit;

-- Rollback reference (manual):
-- revoke select on public.public_profiles from anon, authenticated;
-- revoke select on public.profiles from authenticated;
-- grant select on public.profiles to anon, authenticated;
-- drop view if exists public.public_profiles;
-- drop trigger if exists margins_manage_shared_at on public.margins;
-- drop function if exists public.margins_set_shared_at();
-- drop function if exists public.sync_correspondence_metadata(uuid);
