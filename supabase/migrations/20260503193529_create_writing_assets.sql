create table writing_assets (
  id uuid primary key default gen_random_uuid(),
  writing_id uuid not null references writings(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  storage_path text not null,
  mime_type text not null,
  size_bytes int not null,
  width int,
  height int,
  created_at timestamptz not null default now()
);

create index idx_writing_assets_writing_id on writing_assets(writing_id);
create index idx_writing_assets_author_id on writing_assets(author_id);

alter table writing_assets enable row level security;

create policy "select_writing_assets"
  on writing_assets
  for select
  to authenticated, anon
  using (
    exists (
      select 1 from writings w
      where w.id = writing_assets.writing_id
        and (
          w.author_id = auth.uid()
          or w.visibility = 'public'
          or (
            w.visibility = 'shared'
            and exists (
              select 1 from writing_shares ws
              where ws.writing_id = w.id
                and ws.shared_with_id = auth.uid()
            )
          )
        )
    )
  );

create policy "insert_writing_assets"
  on writing_assets
  for insert
  to authenticated
  with check (author_id = auth.uid());

create policy "delete_writing_assets"
  on writing_assets
  for delete
  to authenticated
  using (author_id = auth.uid());

-- Rollback:
-- drop table if exists writing_assets;
