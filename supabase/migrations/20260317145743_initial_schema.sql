begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.normalize_slug(input_text text)
returns text
language sql
immutable
as $$
  select nullif(
    trim(both '-' from regexp_replace(lower(coalesce(input_text, '')), '[^a-z0-9]+', '-', 'g')),
    ''
  );
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  bio text,
  invited_by_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint profiles_username_format check (username ~ '^[a-z0-9_-]{3,32}$')
);

create table if not exists public.writings (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  body_json jsonb not null default '{}'::jsonb,
  body_text text not null default '',
  slug text,
  status text not null default 'draft',
  visibility text not null default 'private',
  parent_id uuid references public.writings(id) on delete set null,
  correspondence_id uuid,
  version integer not null default 1,
  sync_status text not null default 'synced',
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint writings_status_check check (status in ('draft', 'finished')),
  constraint writings_visibility_check check (visibility in ('private', 'shared', 'public')),
  constraint writings_sync_status_check check (sync_status in ('synced', 'pending', 'conflict')),
  constraint writings_version_check check (version >= 1),
  constraint writings_slug_by_author_unique unique (author_id, slug)
);

create table if not exists public.correspondences (
  id uuid primary key default gen_random_uuid(),
  root_writing_id uuid not null unique references public.writings(id) on delete cascade,
  title text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.writings
  drop constraint if exists writings_correspondence_id_fkey;

alter table public.writings
  add constraint writings_correspondence_id_fkey
  foreign key (correspondence_id)
  references public.correspondences(id)
  on delete set null;

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text,
  visibility text not null default 'private',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint collections_visibility_check check (visibility in ('private', 'public'))
);

create table if not exists public.writing_collections (
  writing_id uuid not null references public.writings(id) on delete cascade,
  collection_id uuid not null references public.collections(id) on delete cascade,
  added_at timestamptz not null default timezone('utc', now()),
  primary key (writing_id, collection_id)
);

create table if not exists public.writing_shares (
  id uuid primary key default gen_random_uuid(),
  writing_id uuid not null references public.writings(id) on delete cascade,
  shared_with_id uuid not null references public.profiles(id) on delete cascade,
  can_respond boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  constraint writing_shares_unique unique (writing_id, shared_with_id)
);

create table if not exists public.ai_observations (
  id uuid primary key default gen_random_uuid(),
  writing_id uuid not null references public.writings(id) on delete cascade,
  observation text not null,
  paragraph_index integer not null,
  status text not null default 'active',
  created_at timestamptz not null default timezone('utc', now()),
  constraint ai_observations_status_check check (status in ('active', 'dismissed', 'addressed'))
);

create table if not exists public.margins (
  id uuid primary key default gen_random_uuid(),
  reader_id uuid not null references public.profiles(id) on delete cascade,
  writing_id uuid not null references public.writings(id) on delete cascade,
  anchor_start integer not null,
  anchor_end integer not null,
  anchor_text text not null,
  note text,
  shared boolean not null default false,
  shared_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint margins_anchor_start_check check (anchor_start >= 0),
  constraint margins_anchor_end_check check (anchor_end > anchor_start)
);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  writing_id uuid references public.writings(id) on delete set null,
  token text not null unique,
  status text not null default 'pending',
  created_at timestamptz not null default timezone('utc', now()),
  accepted_at timestamptz,
  constraint invitations_status_check check (status in ('pending', 'accepted', 'expired'))
);

create index if not exists idx_writings_author_id on public.writings(author_id);
create index if not exists idx_writings_parent_id on public.writings(parent_id);
create index if not exists idx_writings_correspondence_id on public.writings(correspondence_id);
create index if not exists idx_writings_visibility on public.writings(visibility);
create index if not exists idx_writings_sync_status on public.writings(sync_status);
create index if not exists idx_writings_slug_author on public.writings(author_id, slug) where slug is not null;
create index if not exists idx_writing_collections_collection_id on public.writing_collections(collection_id);
create index if not exists idx_writing_shares_shared_with on public.writing_shares(shared_with_id);
create index if not exists idx_invitations_email on public.invitations(email);
create index if not exists idx_margins_writing_id on public.margins(writing_id);
create index if not exists idx_margins_reader_id on public.margins(reader_id);

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
begin
  cleaned := regexp_replace(lower(coalesce(base_username, 'writer')), '[^a-z0-9_-]+', '', 'g');

  if cleaned = '' then
    cleaned := 'writer';
  end if;

  if cleaned ~ '^[0-9]' then
    cleaned := 'u_' || cleaned;
  end if;

  candidate := cleaned;

  while exists (
    select 1
    from public.profiles p
    where p.username = candidate
      and (profile_id is null or p.id <> profile_id)
  ) loop
    suffix := suffix + 1;
    candidate := cleaned || '_' || suffix;
  end loop;

  return candidate;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  username_base text;
  display_name_value text;
  username_value text;
begin
  username_base := coalesce(
    new.raw_user_meta_data ->> 'username',
    split_part(new.email, '@', 1),
    'writer'
  );

  display_name_value := coalesce(
    new.raw_user_meta_data ->> 'display_name',
    new.raw_user_meta_data ->> 'full_name',
    split_part(new.email, '@', 1),
    'Writer'
  );

  username_value := public.ensure_unique_username(username_base, new.id);

  insert into public.profiles (id, username, display_name)
  values (new.id, username_value, display_name_value)
  on conflict (id) do update
    set username = excluded.username,
        display_name = excluded.display_name,
        updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

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

    return trim(regexp_replace(output_text, '\\s+', ' ', 'g'));
  end if;

  if jsonb_typeof(input_json) = 'array' then
    for item in select value from jsonb_array_elements(input_json) loop
      output_text := concat_ws(' ', output_text, public.extract_tiptap_text(item));
    end loop;

    return trim(regexp_replace(output_text, '\\s+', ' ', 'g'));
  end if;

  return '';
end;
$$;

create or replace function public.generate_unique_writing_slug(
  writing_author_id uuid,
  writing_title text,
  writing_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  base_slug text;
  candidate text;
  suffix integer := 1;
begin
  base_slug := public.normalize_slug(writing_title);

  if base_slug is null then
    return null;
  end if;

  candidate := left(base_slug, 96);

  while exists (
    select 1
    from public.writings w
    where w.author_id = writing_author_id
      and w.slug = candidate
      and (writing_id is null or w.id <> writing_id)
  ) loop
    suffix := suffix + 1;
    candidate := left(base_slug, 90) || '-' || suffix;
  end loop;

  return candidate;
end;
$$;

create or replace function public.writings_set_derived_fields()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.body_json is distinct from old.body_json then
    new.body_text := public.extract_tiptap_text(new.body_json);
  end if;

  if new.visibility in ('shared', 'public') and coalesce(new.title, '') <> '' then
    if tg_op = 'INSERT'
      or new.slug is null
      or new.title is distinct from old.title
      or new.visibility is distinct from old.visibility then
      new.slug := public.generate_unique_writing_slug(new.author_id, new.title, new.id);
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.writings_assign_correspondence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_correspondence_id uuid;
  root_id uuid;
  root_title text;
  resolved_correspondence_id uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  select w.correspondence_id
  into parent_correspondence_id
  from public.writings w
  where w.id = new.parent_id;

  if new.correspondence_id is null then
    new.correspondence_id := parent_correspondence_id;
  end if;

  if new.correspondence_id is not null then
    return new;
  end if;

  with recursive chain as (
    select w.id, w.parent_id, w.title
    from public.writings w
    where w.id = new.parent_id
    union all
    select w.id, w.parent_id, w.title
    from public.writings w
    join chain c on w.id = c.parent_id
  )
  select c.id, c.title
  into root_id, root_title
  from chain c
  where c.parent_id is null
  limit 1;

  if root_id is null then
    root_id := new.parent_id;
    select w.title into root_title from public.writings w where w.id = new.parent_id;
  end if;

  insert into public.correspondences (root_writing_id, title)
  values (root_id, root_title)
  on conflict (root_writing_id) do update
    set title = excluded.title
  returning id into resolved_correspondence_id;

  with recursive tree as (
    select w.id
    from public.writings w
    where w.id = root_id
    union all
    select w.id
    from public.writings w
    join tree t on w.parent_id = t.id
  )
  update public.writings w
  set correspondence_id = resolved_correspondence_id
  where w.id in (select id from tree)
    and w.correspondence_id is null;

  new.correspondence_id := resolved_correspondence_id;

  return new;
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
    if old.correspondence_id is not null then
      update public.correspondences
      set updated_at = timezone('utc', now())
      where id = old.correspondence_id;
    end if;

    return null;
  end if;

  if new.correspondence_id is not null then
    update public.correspondences
    set updated_at = timezone('utc', now())
    where id = new.correspondence_id;
  end if;

  if tg_op = 'UPDATE'
    and old.correspondence_id is distinct from new.correspondence_id
    and old.correspondence_id is not null then
    update public.correspondences
    set updated_at = timezone('utc', now())
    where id = old.correspondence_id;
  end if;

  return null;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists collections_set_updated_at on public.collections;
create trigger collections_set_updated_at
before update on public.collections
for each row execute function public.set_updated_at();

drop trigger if exists margins_set_updated_at on public.margins;
create trigger margins_set_updated_at
before update on public.margins
for each row execute function public.set_updated_at();

drop trigger if exists correspondences_set_updated_at on public.correspondences;
create trigger correspondences_set_updated_at
before update on public.correspondences
for each row execute function public.set_updated_at();

drop trigger if exists writings_before_insert_assign_correspondence on public.writings;
create trigger writings_before_insert_assign_correspondence
before insert on public.writings
for each row execute function public.writings_assign_correspondence();

drop trigger if exists writings_before_set_derived_fields on public.writings;
create trigger writings_before_set_derived_fields
before insert or update of body_json, title, visibility, slug, author_id on public.writings
for each row execute function public.writings_set_derived_fields();

drop trigger if exists writings_set_updated_at on public.writings;
create trigger writings_set_updated_at
before update on public.writings
for each row execute function public.set_updated_at();

drop trigger if exists writings_touch_correspondence_after_write on public.writings;
create trigger writings_touch_correspondence_after_write
after insert or update or delete on public.writings
for each row execute function public.touch_correspondence_updated_at();

create or replace function public.can_read_writing(target_writing_id uuid, viewer_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.writings w
    where w.id = target_writing_id
      and w.deleted_at is null
      and (
        w.visibility = 'public'
        or (viewer_id is not null and w.author_id = viewer_id)
        or (
          viewer_id is not null
          and w.visibility = 'shared'
          and exists (
            select 1
            from public.writing_shares ws
            where ws.writing_id = w.id
              and ws.shared_with_id = viewer_id
          )
        )
      )
  );
$$;

create or replace function public.can_access_correspondence(target_correspondence_id uuid, viewer_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.writings w
    where w.correspondence_id = target_correspondence_id
      and (
        viewer_id is not null
        and (
          w.author_id = viewer_id
          or exists (
            select 1
            from public.writing_shares ws
            where ws.writing_id = w.id
              and ws.shared_with_id = viewer_id
          )
        )
      )
  );
$$;

alter table public.profiles enable row level security;
alter table public.writings enable row level security;
alter table public.correspondences enable row level security;
alter table public.collections enable row level security;
alter table public.writing_collections enable row level security;
alter table public.writing_shares enable row level security;
alter table public.ai_observations enable row level security;
alter table public.margins enable row level security;
alter table public.invitations enable row level security;

drop policy if exists profiles_select_public on public.profiles;
create policy profiles_select_public
on public.profiles
for select
using (true);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
on public.profiles
for insert
with check (auth.uid() = id);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists writings_select_accessible on public.writings;
create policy writings_select_accessible
on public.writings
for select
using (public.can_read_writing(id, auth.uid()));

drop policy if exists writings_insert_author on public.writings;
create policy writings_insert_author
on public.writings
for insert
with check (auth.uid() = author_id);

drop policy if exists writings_update_author on public.writings;
create policy writings_update_author
on public.writings
for update
using (auth.uid() = author_id)
with check (auth.uid() = author_id);

drop policy if exists writings_delete_author_draft on public.writings;
create policy writings_delete_author_draft
on public.writings
for delete
using (auth.uid() = author_id and status = 'draft');

drop policy if exists correspondences_select_participants on public.correspondences;
create policy correspondences_select_participants
on public.correspondences
for select
using (public.can_access_correspondence(id, auth.uid()));

drop policy if exists correspondences_insert_service_role on public.correspondences;
create policy correspondences_insert_service_role
on public.correspondences
for insert
with check (auth.role() = 'service_role');

drop policy if exists correspondences_update_service_role on public.correspondences;
create policy correspondences_update_service_role
on public.correspondences
for update
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists correspondences_delete_service_role on public.correspondences;
create policy correspondences_delete_service_role
on public.correspondences
for delete
using (auth.role() = 'service_role');

drop policy if exists collections_select_visible on public.collections;
create policy collections_select_visible
on public.collections
for select
using (owner_id = auth.uid() or visibility = 'public');

drop policy if exists collections_insert_owner on public.collections;
create policy collections_insert_owner
on public.collections
for insert
with check (owner_id = auth.uid());

drop policy if exists collections_update_owner on public.collections;
create policy collections_update_owner
on public.collections
for update
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists collections_delete_owner on public.collections;
create policy collections_delete_owner
on public.collections
for delete
using (owner_id = auth.uid());

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

drop policy if exists writing_collections_insert_owner on public.writing_collections;
create policy writing_collections_insert_owner
on public.writing_collections
for insert
with check (
  exists (
    select 1
    from public.collections c
    where c.id = collection_id
      and c.owner_id = auth.uid()
  )
  and exists (
    select 1
    from public.writings w
    where w.id = writing_id
      and w.author_id = auth.uid()
  )
);

drop policy if exists writing_collections_delete_owner on public.writing_collections;
create policy writing_collections_delete_owner
on public.writing_collections
for delete
using (
  exists (
    select 1
    from public.collections c
    where c.id = collection_id
      and c.owner_id = auth.uid()
  )
);

drop policy if exists writing_shares_select_related on public.writing_shares;
create policy writing_shares_select_related
on public.writing_shares
for select
using (
  shared_with_id = auth.uid()
  or exists (
    select 1
    from public.writings w
    where w.id = writing_id
      and w.author_id = auth.uid()
  )
);

drop policy if exists writing_shares_insert_author on public.writing_shares;
create policy writing_shares_insert_author
on public.writing_shares
for insert
with check (
  exists (
    select 1
    from public.writings w
    where w.id = writing_id
      and w.author_id = auth.uid()
  )
);

drop policy if exists writing_shares_update_author on public.writing_shares;
create policy writing_shares_update_author
on public.writing_shares
for update
using (
  exists (
    select 1
    from public.writings w
    where w.id = writing_id
      and w.author_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.writings w
    where w.id = writing_id
      and w.author_id = auth.uid()
  )
);

drop policy if exists writing_shares_delete_author on public.writing_shares;
create policy writing_shares_delete_author
on public.writing_shares
for delete
using (
  exists (
    select 1
    from public.writings w
    where w.id = writing_id
      and w.author_id = auth.uid()
  )
);

drop policy if exists ai_observations_select_author on public.ai_observations;
create policy ai_observations_select_author
on public.ai_observations
for select
using (
  exists (
    select 1
    from public.writings w
    where w.id = writing_id
      and w.author_id = auth.uid()
  )
);

drop policy if exists ai_observations_insert_service_role on public.ai_observations;
create policy ai_observations_insert_service_role
on public.ai_observations
for insert
with check (auth.role() = 'service_role');

drop policy if exists ai_observations_update_author on public.ai_observations;
create policy ai_observations_update_author
on public.ai_observations
for update
using (
  exists (
    select 1
    from public.writings w
    where w.id = writing_id
      and w.author_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.writings w
    where w.id = writing_id
      and w.author_id = auth.uid()
  )
);

drop policy if exists margins_select_owner_or_shared_with_author on public.margins;
create policy margins_select_owner_or_shared_with_author
on public.margins
for select
using (
  reader_id = auth.uid()
  or (
    shared = true
    and exists (
      select 1
      from public.writings w
      where w.id = writing_id
        and w.author_id = auth.uid()
    )
  )
);

drop policy if exists margins_insert_reader on public.margins;
create policy margins_insert_reader
on public.margins
for insert
with check (
  reader_id = auth.uid()
  and public.can_read_writing(writing_id, auth.uid())
);

drop policy if exists margins_update_reader on public.margins;
create policy margins_update_reader
on public.margins
for update
using (reader_id = auth.uid())
with check (reader_id = auth.uid());

drop policy if exists margins_delete_reader on public.margins;
create policy margins_delete_reader
on public.margins
for delete
using (reader_id = auth.uid());

drop policy if exists invitations_select_inviter on public.invitations;
create policy invitations_select_inviter
on public.invitations
for select
using (inviter_id = auth.uid());

drop policy if exists invitations_insert_inviter on public.invitations;
create policy invitations_insert_inviter
on public.invitations
for insert
with check (inviter_id = auth.uid());

drop policy if exists invitations_update_inviter_or_service_role on public.invitations;
create policy invitations_update_inviter_or_service_role
on public.invitations
for update
using (inviter_id = auth.uid() or auth.role() = 'service_role')
with check (inviter_id = auth.uid() or auth.role() = 'service_role');

grant usage on schema public to anon, authenticated, service_role;

grant select on public.profiles to anon, authenticated;
grant select on public.writings to anon, authenticated;
grant select on public.collections to anon, authenticated;
grant select on public.correspondences to authenticated;
grant select on public.writing_collections to authenticated;
grant select, insert, update, delete on public.writing_shares to authenticated;
grant select on public.ai_observations to authenticated;
grant select, insert, update, delete on public.margins to authenticated;
grant select, insert, update on public.invitations to authenticated;

grant insert, update, delete on public.writings to authenticated;
grant insert, update, delete on public.collections to authenticated;
grant insert, delete on public.writing_collections to authenticated;
grant update on public.profiles to authenticated;

commit;

-- Rollback reference (manual):
-- drop trigger if exists on_auth_user_created on auth.users;
-- drop function if exists public.handle_new_auth_user();
-- drop function if exists public.ensure_unique_username(text, uuid);
-- drop function if exists public.touch_correspondence_updated_at();
-- drop function if exists public.writings_assign_correspondence();
-- drop function if exists public.writings_set_derived_fields();
-- drop function if exists public.generate_unique_writing_slug(uuid, text, uuid);
-- drop function if exists public.extract_tiptap_text(jsonb);
-- drop function if exists public.can_access_correspondence(uuid, uuid);
-- drop function if exists public.can_read_writing(uuid, uuid);
-- drop function if exists public.normalize_slug(text);
-- drop function if exists public.set_updated_at();
-- drop table if exists public.invitations cascade;
-- drop table if exists public.margins cascade;
-- drop table if exists public.ai_observations cascade;
-- drop table if exists public.writing_shares cascade;
-- drop table if exists public.writing_collections cascade;
-- drop table if exists public.collections cascade;
-- drop table if exists public.correspondences cascade;
-- drop table if exists public.writings cascade;
-- drop table if exists public.profiles cascade;
