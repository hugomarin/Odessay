begin;

create or replace function public.claim_profile_username(target_username text)
returns table (
  username text,
  previous_username text,
  reserved_until timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  normalized_username text := lower(trim(coalesce(target_username, '')));
  current_username text;
  locked_reservation public.username_reservations%rowtype;
  next_reserved_until timestamptz := timezone('utc', now()) + interval '7 days';
begin
  if actor_id is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if normalized_username !~ '^[a-z0-9_-]{3,30}$' then
    raise exception 'INVALID_USERNAME';
  end if;

  delete from public.username_reservations
  where username_reservations.reserved_until <= timezone('utc', now());

  select profiles.username
  into current_username
  from public.profiles
  where profiles.id = actor_id
  for update;

  if current_username is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  if current_username = normalized_username then
    return query
      select current_username, current_username, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from public.profiles
    where profiles.username = normalized_username
      and profiles.id <> actor_id
  ) then
    raise exception 'USERNAME_TAKEN';
  end if;

  select *
  into locked_reservation
  from public.username_reservations
  where username_reservations.username = normalized_username
  for update;

  if locked_reservation.username is not null
     and locked_reservation.owner_id <> actor_id
     and locked_reservation.reserved_until > timezone('utc', now()) then
    raise exception 'USERNAME_RESERVED';
  end if;

  update public.profiles
  set username = normalized_username,
      updated_at = timezone('utc', now())
  where id = actor_id;

  insert into public.username_reservations (username, owner_id, reserved_until)
  values (current_username, actor_id, next_reserved_until)
  on conflict (username) do update
    set owner_id = excluded.owner_id,
        reserved_until = excluded.reserved_until,
        updated_at = timezone('utc', now());

  delete from public.username_reservations
  where username = normalized_username
    and owner_id = actor_id;

  return query
    select normalized_username, current_username, next_reserved_until;
end;
$$;

grant execute on function public.claim_profile_username(text) to authenticated;

commit;
