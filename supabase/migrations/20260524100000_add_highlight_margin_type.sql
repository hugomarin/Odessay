begin;

alter table public.margins
  drop constraint if exists margins_type_check;

alter table public.margins
  add constraint margins_type_check
  check (type in ('personal', 'ai', 'collaborative', 'highlight'));

commit;

-- rollback:
-- alter table public.margins drop constraint if exists margins_type_check;
-- alter table public.margins add constraint margins_type_check check (type in ('personal', 'ai', 'collaborative'));
