begin;

alter table public.writings
  add column if not exists artifact_type text;

update public.writings
set artifact_type = 'general'
where artifact_type is null;

alter table public.writings
  alter column artifact_type set default 'general',
  alter column artifact_type set not null;

alter table public.writings
  drop constraint if exists writings_artifact_type_check;

alter table public.writings
  add constraint writings_artifact_type_check
  check (artifact_type in ('general', 'agent', 'skill', 'prompt', 'template', 'status'));

commit;

-- Rollback:
-- begin;
-- alter table public.writings drop constraint if exists writings_artifact_type_check;
-- alter table public.writings drop column if exists artifact_type;
-- commit;
