begin;

alter table public.writings
  drop constraint if exists writings_status_check;

alter table public.writings
  add constraint writings_status_check
  check (status in ('new', 'exploring', 'draft', 'in_review', 'done', 'archived', 'canceled'));

commit;

-- rollback:
-- begin;
-- alter table public.writings
--   drop constraint if exists writings_status_check;
-- alter table public.writings
--   add constraint writings_status_check
--   check (status in ('new', 'exploring', 'draft', 'done'));
-- commit;
