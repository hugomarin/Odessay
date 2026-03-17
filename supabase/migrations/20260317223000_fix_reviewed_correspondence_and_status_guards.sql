begin;

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

  -- Replies should not materialize a correspondence while still private drafts.
  if coalesce(new.visibility, 'private') not in ('shared', 'public') then
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
    and w.id <> new.id
    and w.correspondence_id is null;

  new.correspondence_id := resolved_correspondence_id;

  return new;
end;
$$;

drop trigger if exists writings_before_insert_assign_correspondence on public.writings;
drop trigger if exists writings_before_assign_correspondence on public.writings;
create trigger writings_before_assign_correspondence
before insert or update of parent_id, visibility, correspondence_id
on public.writings
for each row execute function public.writings_assign_correspondence();

create or replace function public.ai_observations_enforce_status_update()
returns trigger
language plpgsql
as $$
begin
  if new.writing_id is distinct from old.writing_id
    or new.observation is distinct from old.observation
    or new.paragraph_index is distinct from old.paragraph_index
    or new.created_at is distinct from old.created_at then
    raise exception 'Only status updates are allowed on ai_observations';
  end if;

  if new.status not in ('active', 'dismissed', 'addressed') then
    raise exception 'Invalid ai_observations status: %', new.status;
  end if;

  return new;
end;
$$;

drop trigger if exists ai_observations_enforce_status_update on public.ai_observations;
create trigger ai_observations_enforce_status_update
before update on public.ai_observations
for each row execute function public.ai_observations_enforce_status_update();

create or replace function public.invitations_enforce_status_update()
returns trigger
language plpgsql
as $$
begin
  if new.inviter_id is distinct from old.inviter_id
    or new.email is distinct from old.email
    or new.writing_id is distinct from old.writing_id
    or new.token is distinct from old.token
    or new.created_at is distinct from old.created_at then
    raise exception 'Only status updates are allowed on invitations';
  end if;

  if new.status not in ('pending', 'accepted', 'expired') then
    raise exception 'Invalid invitations status: %', new.status;
  end if;

  if new.status = 'accepted' then
    new.accepted_at := coalesce(new.accepted_at, timezone('utc', now()));
  else
    new.accepted_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists invitations_enforce_status_update on public.invitations;
create trigger invitations_enforce_status_update
before update on public.invitations
for each row execute function public.invitations_enforce_status_update();

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
  status in ('active', 'dismissed', 'addressed')
  and exists (
    select 1
    from public.writings w
    where w.id = writing_id
      and w.author_id = auth.uid()
  )
);

drop policy if exists invitations_update_inviter_or_service_role on public.invitations;
create policy invitations_update_inviter_or_service_role
on public.invitations
for update
using (inviter_id = auth.uid() or auth.role() = 'service_role')
with check (
  status in ('pending', 'accepted', 'expired')
  and (inviter_id = auth.uid() or auth.role() = 'service_role')
);

commit;

-- Rollback reference (manual):
-- drop trigger if exists invitations_enforce_status_update on public.invitations;
-- drop function if exists public.invitations_enforce_status_update();
-- drop trigger if exists ai_observations_enforce_status_update on public.ai_observations;
-- drop function if exists public.ai_observations_enforce_status_update();
-- drop trigger if exists writings_before_assign_correspondence on public.writings;
-- recreate previous trigger/function bodies from 20260317145743 + 20260317221000 if needed.
