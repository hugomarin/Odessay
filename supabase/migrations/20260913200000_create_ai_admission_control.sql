begin;

-- ODE-524: title suggestions, publication review and margin transcription
-- call the configured AI provider with no application-level per-account
-- quota or concurrency limit. Provider-side limits are shared across every
-- Odessay user and don't allocate capacity fairly. This is the durable,
-- cross-instance admission store the fix requires — module-scoped counters
-- would reset per server instance/cold start and are explicitly rejected by
-- the issue's own Performance Architecture.

-- One row per (account, route): a fixed window that resets whenever a
-- request arrives after the window has expired for that account.
create table public.ai_rate_limit_windows (
  account_id uuid not null,
  route_key text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (account_id, route_key)
);

-- A shared concurrency ceiling across *all* AI routes for one account. A
-- lease row represents one admitted, still-in-flight request; it is deleted
-- on release. `expires_at` is a self-healing ceiling: a crashed or
-- never-released request cannot leak a permit forever, since an expired
-- lease is treated as already released without needing a cleanup job.
create table public.ai_concurrency_leases (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  route_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null
);

create index idx_ai_concurrency_leases_account_active
  on public.ai_concurrency_leases (account_id, expires_at);

-- Requirement 1: one shared, atomic admission operation. Advisory xact locks
-- (already the established pattern in this codebase — see
-- rotate_test_preview_link) make the whole check-then-increment atomic
-- without a separate read-then-write race between concurrent requests for
-- the same account, across any number of server instances, since the lock
-- and the data both live in Postgres rather than process memory.
--
-- Lock ordering is always route-scope first, then account-wide concurrency
-- scope — two concurrent admissions for the same account on *different*
-- routes never wait on each other's route lock, only ever serialize on the
-- shared concurrency lock, so this cannot deadlock.
create or replace function public.ai_admission_try_acquire(
  p_account_id uuid,
  p_route_key text,
  p_window_seconds integer,
  p_rate_limit integer,
  p_concurrency_limit integer,
  p_lease_seconds integer
) returns table (admitted boolean, lease_id uuid, retry_after_seconds integer, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_start timestamptz;
  v_count integer;
  v_concurrency_count integer;
  v_lease_id uuid;
begin
  if p_account_id is null or p_route_key is null then
    raise exception 'p_account_id and p_route_key are required';
  end if;
  if p_window_seconds <= 0 or p_rate_limit <= 0 or p_concurrency_limit <= 0 or p_lease_seconds <= 0 then
    raise exception 'admission parameters must be positive';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_account_id::text || ':rate:' || p_route_key, 0));

  select w.window_start, w.request_count into v_window_start, v_count
  from public.ai_rate_limit_windows w
  where w.account_id = p_account_id and w.route_key = p_route_key
  for update;

  if not found or v_now - v_window_start >= make_interval(secs => p_window_seconds) then
    insert into public.ai_rate_limit_windows as w (account_id, route_key, window_start, request_count)
    values (p_account_id, p_route_key, v_now, 0)
    on conflict (account_id, route_key) do update
      set window_start = excluded.window_start, request_count = 0
    returning w.window_start, w.request_count into v_window_start, v_count;
  end if;

  if v_count >= p_rate_limit then
    return query select
      false,
      null::uuid,
      greatest(1, ceil(extract(epoch from (v_window_start + make_interval(secs => p_window_seconds) - v_now)))::integer),
      'rate_limited'::text;
    return;
  end if;

  -- Requirement 1's "shared concurrency ceiling": scoped to the account
  -- only, not the route, so title-suggestions + publication-review +
  -- transcription all draw from the same in-flight budget.
  perform pg_advisory_xact_lock(hashtextextended(p_account_id::text || ':concurrency', 0));

  delete from public.ai_concurrency_leases where expires_at <= v_now;

  select count(*) into v_concurrency_count
  from public.ai_concurrency_leases l
  where l.account_id = p_account_id and l.expires_at > v_now;

  if v_concurrency_count >= p_concurrency_limit then
    return query select false, null::uuid, 1, 'concurrency_limited'::text;
    return;
  end if;

  update public.ai_rate_limit_windows w
  set request_count = w.request_count + 1
  where w.account_id = p_account_id and w.route_key = p_route_key;

  insert into public.ai_concurrency_leases (account_id, route_key, expires_at)
  values (p_account_id, p_route_key, v_now + make_interval(secs => p_lease_seconds))
  returning id into v_lease_id;

  return query select true, v_lease_id, 0, 'admitted'::text;
end;
$$;

-- Requirement 6: releasing is idempotent and never re-validates identity —
-- a lease id is an opaque, unguessable token the caller already earned by
-- being admitted; deleting one that is already gone (already expired, or
-- already released) is a silent no-op, not an error, so a route's
-- try/finally release can never itself throw.
create or replace function public.ai_admission_release(p_lease_id uuid) returns void
language sql
security definer
set search_path = public
as $$
  delete from public.ai_concurrency_leases where id = p_lease_id;
$$;

revoke all on function public.ai_admission_try_acquire(uuid, text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.ai_admission_try_acquire(uuid, text, integer, integer, integer, integer) to service_role;

revoke all on function public.ai_admission_release(uuid) from public, anon, authenticated;
grant execute on function public.ai_admission_release(uuid) to service_role;

commit;

-- Rollback reference (manual):
-- drop function if exists public.ai_admission_release(uuid);
-- drop function if exists public.ai_admission_try_acquire(uuid, text, integer, integer, integer, integer);
-- drop table if exists public.ai_concurrency_leases;
-- drop table if exists public.ai_rate_limit_windows;
