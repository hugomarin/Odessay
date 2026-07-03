create table if not exists public.learned_words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  word text not null,
  language text not null default 'unknown',
  created_at timestamptz not null default now()
);

create unique index if not exists learned_words_user_language_word_idx
  on public.learned_words (user_id, language, word);

create index if not exists learned_words_user_created_at_idx
  on public.learned_words (user_id, created_at desc);

alter table public.learned_words enable row level security;

drop policy if exists learned_words_select_owner on public.learned_words;
create policy learned_words_select_owner
  on public.learned_words
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists learned_words_insert_owner on public.learned_words;
create policy learned_words_insert_owner
  on public.learned_words
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists learned_words_delete_owner on public.learned_words;
create policy learned_words_delete_owner
  on public.learned_words
  for delete
  to authenticated
  using (user_id = auth.uid());

grant select, insert, delete on public.learned_words to authenticated;

-- rollback:
-- drop policy if exists learned_words_delete_owner on public.learned_words;
-- drop policy if exists learned_words_insert_owner on public.learned_words;
-- drop policy if exists learned_words_select_owner on public.learned_words;
-- drop table if exists public.learned_words;
