begin;

create table if not exists public.vocabulary_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('type', 'status')),
  key text not null,
  name text not null,
  description text not null default '',
  icon text not null,
  color text not null,
  hidden boolean not null default false,
  is_base boolean not null default false,
  is_required boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists vocabulary_items_user_kind_key_idx
  on public.vocabulary_items (user_id, kind, key);

create index if not exists vocabulary_items_user_kind_idx
  on public.vocabulary_items (user_id, kind);

comment on table public.vocabulary_items is
  'User-owned artifact type / status vocabulary (ODE-472). key is the stable identifier stored in writings.artifact_type / writings.status.';

alter table public.vocabulary_items enable row level security;

-- Paridad de las cuatro operaciones (ODE-355 42P17: revisar solo SELECT no basta).

drop policy if exists vocabulary_items_select_owner on public.vocabulary_items;
create policy vocabulary_items_select_owner
  on public.vocabulary_items
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists vocabulary_items_insert_owner on public.vocabulary_items;
create policy vocabulary_items_insert_owner
  on public.vocabulary_items
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists vocabulary_items_update_owner on public.vocabulary_items;
create policy vocabulary_items_update_owner
  on public.vocabulary_items
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists vocabulary_items_delete_owner on public.vocabulary_items;
create policy vocabulary_items_delete_owner
  on public.vocabulary_items
  for delete
  to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.vocabulary_items to authenticated;

-- Deletes a custom (non-base) vocabulary item and rewrites the caller's
-- writings that carried its key to the base value, in one transaction — the
-- function body is the transaction; either both happen or neither does.
-- `security invoker` means it runs under the caller's RLS, not a bypass.
create or replace function public.delete_vocabulary_item(p_item_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_kind text;
  v_key text;
  v_is_base boolean;
  v_rewritten integer;
begin
  select kind, key, is_base into v_kind, v_key, v_is_base
  from public.vocabulary_items
  where id = p_item_id and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'vocabulary item not found' using errcode = 'P0002';
  end if;

  if v_is_base then
    raise exception 'base vocabulary items cannot be deleted' using errcode = '23514';
  end if;

  if v_kind = 'type' then
    update public.writings set artifact_type = 'general'
      where author_id = auth.uid() and artifact_type = v_key;
  else
    update public.writings set status = 'draft'
      where author_id = auth.uid() and status = v_key;
  end if;

  get diagnostics v_rewritten = row_count;

  delete from public.vocabulary_items where id = p_item_id and user_id = auth.uid();

  return v_rewritten;
end;
$$;

grant execute on function public.delete_vocabulary_item(uuid) to authenticated;

commit;

-- rollback:
-- begin;
-- drop function if exists public.delete_vocabulary_item(uuid);
-- drop policy if exists vocabulary_items_delete_owner on public.vocabulary_items;
-- drop policy if exists vocabulary_items_update_owner on public.vocabulary_items;
-- drop policy if exists vocabulary_items_insert_owner on public.vocabulary_items;
-- drop policy if exists vocabulary_items_select_owner on public.vocabulary_items;
-- drop table if exists public.vocabulary_items;
-- commit;
