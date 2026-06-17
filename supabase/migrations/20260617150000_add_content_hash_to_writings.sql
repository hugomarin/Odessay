begin;

alter table public.writings
  add column if not exists content_hash text;

comment on column public.writings.content_hash is
  'BLAKE3 hash over canonical markdown bytes, prefixed as blake3:<hex>. Existing rows are backfilled on next save/sync.';

create index if not exists writings_content_hash_idx
  on public.writings (content_hash)
  where content_hash is not null and deleted_at is null;

commit;

-- Rollback:
-- begin;
-- drop index if exists public.writings_content_hash_idx;
-- alter table public.writings drop column if exists content_hash;
-- commit;
