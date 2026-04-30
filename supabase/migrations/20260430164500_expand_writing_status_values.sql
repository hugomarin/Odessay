begin;

update public.writings
set status = 'done'
where status = 'finished';

alter table public.writings
  drop constraint if exists writings_status_check;

alter table public.writings
  add constraint writings_status_check
  check (status in ('new', 'exploring', 'draft', 'done'));

commit;

-- rollback:
-- begin;
-- update public.writings
-- set status = 'finished'
-- where status = 'done';
-- delete from public.writings
-- where status in ('new', 'exploring');
-- alter table public.writings
--   drop constraint if exists writings_status_check;
-- alter table public.writings
--   add constraint writings_status_check
--   check (status in ('draft', 'finished'));
-- commit;
