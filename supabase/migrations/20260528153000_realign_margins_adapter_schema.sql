begin;

alter table public.margins
  add column if not exists type text not null default 'personal',
  add column if not exists text text not null default '',
  add column if not exists archived boolean not null default false,
  add column if not exists resolved boolean not null default false;

update public.margins
set text = coalesce(nullif(text, ''), note, '')
where coalesce(text, '') = '';

update public.margins
set note = text
where note is null
  and text <> '';

alter table public.margins
  drop constraint if exists margins_type_check;

alter table public.margins
  add constraint margins_type_check
  check (type in ('personal', 'ai', 'collaborative', 'highlight'));

create index if not exists idx_margins_writing_reader_id on public.margins(writing_id, reader_id);
create index if not exists idx_margins_writing_reader_type on public.margins(writing_id, reader_id, type);
create index if not exists idx_margins_writing_id_shared on public.margins(writing_id, shared);

commit;

-- rollback:
-- drop index if exists public.idx_margins_writing_id_shared;
-- drop index if exists public.idx_margins_writing_reader_type;
-- drop index if exists public.idx_margins_writing_reader_id;
-- alter table public.margins drop constraint if exists margins_type_check;
-- alter table public.margins add constraint margins_type_check check (type in ('personal', 'ai', 'collaborative'));
-- alter table public.margins drop column if exists resolved;
-- alter table public.margins drop column if exists archived;
-- alter table public.margins drop column if exists text;
-- alter table public.margins drop column if exists type;
