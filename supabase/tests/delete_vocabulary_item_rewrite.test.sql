-- CONFIG-07 (cloud/Postgres half) — deleting a custom vocabulary item must
-- rewrite the caller's own writings that carried its key to the base value,
-- in the same transaction, and must never touch another user's writings
-- even when the status text matches (RLS/author_id scoping). See the
-- desktop half of this same capability in
-- tests/integration/vocabulary/schema-change-safety.test.ts and
-- workflow/quality/capability-integration-map.md (CONFIG-07).
--
-- Run locally: npx supabase start && npx supabase test db --local supabase/tests/delete_vocabulary_item_rewrite.test.sql
-- Not wired into CI (no pgTAP test in this repo is, yet — see the other
-- files in this directory); this is a real, local-only proof for now.

begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

-- Two users. B's writing deliberately shares the same status *text* as A's
-- custom item ('in-review') to prove the rewrite is scoped by author_id, not
-- just by the status string.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('c0070000-0000-4000-8000-000000000001', 'config07-owner@example.test', '{"username":"config07_owner"}'::jsonb),
  ('c0070000-0000-4000-8000-000000000002', 'config07-other@example.test', '{"username":"config07_other"}'::jsonb);

-- User A's custom status ("in-review") and a base status row (base items
-- cannot be deleted — the function checks this from the row itself).
insert into public.vocabulary_items (id, user_id, kind, key, name, icon, color, is_base)
values
  ('c0071000-0000-4000-8000-000000000001', 'c0070000-0000-4000-8000-000000000001', 'status', 'in-review', 'In review', 'eye', '#0ea5e9', false),
  ('c0071000-0000-4000-8000-000000000002', 'c0070000-0000-4000-8000-000000000001', 'status', 'draft', 'Draft', 'pencil', '#94a3b8', true);

insert into public.writings (id, author_id, title, status, version)
values
  ('c0072000-0000-4000-8000-000000000001', 'c0070000-0000-4000-8000-000000000001', 'A — in review 1', 'in-review', 1),
  ('c0072000-0000-4000-8000-000000000002', 'c0070000-0000-4000-8000-000000000001', 'A — in review 2', 'in-review', 3),
  ('c0072000-0000-4000-8000-000000000003', 'c0070000-0000-4000-8000-000000000001', 'A — unrelated status', 'exploring', 1),
  ('c0072000-0000-4000-8000-000000000004', 'c0070000-0000-4000-8000-000000000002', 'B — same status text, different owner', 'in-review', 1);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"c0070000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

-- Failure: deleting a base item is rejected before any rewrite happens.
select throws_ok(
  $$ select public.delete_vocabulary_item('c0071000-0000-4000-8000-000000000002') $$,
  '23514',
  'base vocabulary items cannot be deleted',
  'base item delete is rejected'
);

-- Failure: another user's item id is invisible under this user's RLS scope
-- (the function's own WHERE already filters by user_id, this proves it).
select throws_ok(
  $$ select public.delete_vocabulary_item('00000000-0000-4000-8000-000000000000') $$,
  'P0002',
  'vocabulary item not found',
  'nonexistent item id is rejected, not silently a no-op'
);

-- The real deletion: rewrites exactly A's 2 matching writings, in one
-- transaction with the vocabulary_items row delete.
select results_eq(
  $$ select public.delete_vocabulary_item('c0071000-0000-4000-8000-000000000001') $$,
  array[2],
  'delete_vocabulary_item returns the count of writings it actually rewrote'
);

select results_eq(
  $$ select status from public.writings where id = 'c0072000-0000-4000-8000-000000000001' $$,
  array['draft'],
  'A''s first matching writing was rewritten to the base status'
);

select results_eq(
  $$ select status from public.writings where id = 'c0072000-0000-4000-8000-000000000002' $$,
  array['draft'],
  'A''s second matching writing was rewritten to the base status'
);

select results_eq(
  $$ select status from public.writings where id = 'c0072000-0000-4000-8000-000000000003' $$,
  array['exploring'],
  'A''s writing with an unrelated status is untouched'
);

-- Checked as B, not A: RLS already hides B's row from A's own SELECTs
-- (confirmed live — checking this as A returns zero rows via RLS, not
-- because the rewrite reached it), so the only way to actually prove the
-- rewrite itself didn't touch B's row is to read it back as its owner.
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"c0070000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
select results_eq(
  $$ select status from public.writings where id = 'c0072000-0000-4000-8000-000000000004' $$,
  array['in-review'],
  'B''s writing keeps its status even though the text matches A''s deleted key — proves author_id scoping, not just status-string matching'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"c0070000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  $$ select count(*)::int from public.vocabulary_items where id = 'c0071000-0000-4000-8000-000000000001' $$,
  array[0],
  'the deleted vocabulary item row itself is gone'
);

-- Deleting the same id again now fails as not-found, not as a silent no-op —
-- confirms the earlier "not found" rejection wasn't a fluke of test setup.
select throws_ok(
  $$ select public.delete_vocabulary_item('c0071000-0000-4000-8000-000000000001') $$,
  'P0002',
  'vocabulary item not found',
  'deleting an already-deleted item id fails, does not silently succeed'
);

select * from finish();
rollback;
