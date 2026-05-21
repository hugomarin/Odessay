begin;

alter table public.profiles
  add column if not exists disabled_statuses jsonb not null default '[]'::jsonb;

comment on column public.profiles.disabled_statuses is 'JSON array of writing status values the user has disabled from pickers and filters';

commit;

-- rollback:
-- begin;
-- alter table public.profiles
--   drop column if exists disabled_statuses;
-- commit;
