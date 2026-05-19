create table if not exists public.correction_blocks (
  id text primary key,
  writing_id uuid not null references public.writings(id) on delete cascade,
  block_id text not null,
  block_hash text not null,
  suggestions jsonb not null,
  model text not null,
  created_at timestamptz not null default now(),
  latency_ms integer,
  prompt_tokens integer,
  completion_tokens integer
);

create index if not exists correction_blocks_writing_id_idx
  on public.correction_blocks (writing_id);

create unique index if not exists correction_blocks_writing_hash_idx
  on public.correction_blocks (writing_id, block_hash);

alter table public.correction_blocks enable row level security;

drop policy if exists correction_blocks_select_owner on public.correction_blocks;
create policy correction_blocks_select_owner
  on public.correction_blocks
  for select
  using (
    exists (
      select 1
      from public.writings w
      where w.id = correction_blocks.writing_id
        and w.author_id = auth.uid()
    )
  );

drop policy if exists correction_blocks_insert_owner on public.correction_blocks;
create policy correction_blocks_insert_owner
  on public.correction_blocks
  for insert
  with check (
    exists (
      select 1
      from public.writings w
      where w.id = correction_blocks.writing_id
        and w.author_id = auth.uid()
    )
  );

drop policy if exists correction_blocks_update_owner on public.correction_blocks;
create policy correction_blocks_update_owner
  on public.correction_blocks
  for update
  using (
    exists (
      select 1
      from public.writings w
      where w.id = correction_blocks.writing_id
        and w.author_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.writings w
      where w.id = correction_blocks.writing_id
        and w.author_id = auth.uid()
    )
  );

drop policy if exists correction_blocks_delete_owner on public.correction_blocks;
create policy correction_blocks_delete_owner
  on public.correction_blocks
  for delete
  using (
    exists (
      select 1
      from public.writings w
      where w.id = correction_blocks.writing_id
        and w.author_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.correction_blocks to authenticated;

-- rollback:
-- drop policy if exists correction_blocks_delete_owner on public.correction_blocks;
-- drop policy if exists correction_blocks_update_owner on public.correction_blocks;
-- drop policy if exists correction_blocks_insert_owner on public.correction_blocks;
-- drop policy if exists correction_blocks_select_owner on public.correction_blocks;
-- drop table if exists public.correction_blocks;
