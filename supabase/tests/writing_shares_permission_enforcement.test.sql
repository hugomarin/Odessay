-- SHARE-04 — Permission enforcement (real RLS, not verified manually)
--
-- tests/writing-shares.test.ts's own header says "RLS enforcement is
-- verified manually via Supabase MCP ... requires live DB connection." This
-- is that automated proof: only authorized consumers (owner, an explicitly
-- shared-with user, or anyone for a public writing) can read a writing —
-- and only the owner can grant or revoke a share, never the grantee or an
-- anonymous caller.
--
-- Scope: this proves the database authorization substrate (RLS on
-- writings/writing_shares, plus the security-definer RPC desktop uses for
-- "shared with me") — two independent authorization paths, both real
-- Postgres. It does NOT prove the web app's service-role paths
-- (`/shared/[id]`, `listSharedWritingsForUser()`, `web-sharing-service.ts`,
-- `/api/writings/import`), which use `createAdminClient()` and re-implement
-- their own manual ownership/share checks instead of relying on RLS — RLS
-- is bypassed there by design. See workflow/quality/capability-integration-map.md
-- (SHARE-04) for why the capability is scoped PARTIAL_INTEGRATION, not
-- INTEGRATION, until that second path has its own real proof.
--
-- Run locally: npx supabase start && npx supabase test db --local supabase/tests/writing_shares_permission_enforcement.test.sql
-- Not wired into CI (no pgTAP test in this repo is yet).

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('54040000-0000-4000-8000-000000000001', 'share04-owner@example.test', '{"username":"share04_owner"}'::jsonb),
  ('54040000-0000-4000-8000-000000000002', 'share04-grantee@example.test', '{"username":"share04_grantee"}'::jsonb),
  ('54040000-0000-4000-8000-000000000003', 'share04-stranger@example.test', '{"username":"share04_stranger"}'::jsonb);

-- Owner's three writings, one per visibility. Fixture setup only — the
-- property under test in this file is share creation/revocation and read
-- access, not writing creation, so this stays privileged.
insert into public.writings (id, author_id, title, visibility, status, version)
values
  ('54041000-0000-4000-8000-000000000001', '54040000-0000-4000-8000-000000000001', 'Private', 'private', 'draft', 1),
  ('54041000-0000-4000-8000-000000000002', '54040000-0000-4000-8000-000000000001', 'Shared', 'shared', 'draft', 1),
  ('54041000-0000-4000-8000-000000000003', '54040000-0000-4000-8000-000000000001', 'Public', 'public', 'draft', 1);

-- ─── As the owner: creates the share grant through real RLS, not privileged setup ───
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"54040000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$ insert into public.writing_shares (id, writing_id, shared_with_id) values ('54042000-0000-4000-8000-000000000001', '54041000-0000-4000-8000-000000000002', '54040000-0000-4000-8000-000000000002') $$,
  'the owner can create a share grant on her own writing (RLS insert check)'
);

select results_eq(
  $$ select count(*)::int from public.writings where author_id = '54040000-0000-4000-8000-000000000001' $$,
  array[3],
  'owner sees all three of her own writings regardless of visibility'
);

-- ─── As the grantee: can read the writing explicitly shared with her ───
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"54040000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select results_eq(
  $$ select count(*)::int from public.writings where id = '54041000-0000-4000-8000-000000000002' $$,
  array[1],
  'grantee can read the writing explicitly shared with her'
);

-- Desktop's "Shared with me" list goes through a SECURITY DEFINER RPC
-- (list_incoming_shared_writings), not a plain SELECT under RLS — a
-- second, independent authorization path for the same property, since a
-- security-definer function re-implements its own scoping and can leak if
-- that scoping is ever loosened. Real function, real call, not mocked.
select results_eq(
  $$ select id from public.list_incoming_shared_writings() $$,
  array['54041000-0000-4000-8000-000000000002'::uuid],
  'the RPC desktop uses for "shared with me" returns exactly the writing shared with the caller'
);

-- A shared-with user cannot grant herself (or a third party) access to a
-- document she does not own — only the author can create a share row.
select throws_ok(
  $$ insert into public.writing_shares (writing_id, shared_with_id) values ('54041000-0000-4000-8000-000000000001', '54040000-0000-4000-8000-000000000002') $$,
  '42501',
  null,
  'the grantee cannot self-grant access to the owner''s private writing (RLS insert check)'
);

-- Nor can she revoke the grant the owner made — RLS's delete USING clause
-- scopes deletes to the writing's author, so a grantee's delete affects
-- zero rows rather than erroring.
select results_eq(
  $$ delete from public.writing_shares where id = '54042000-0000-4000-8000-000000000001' returning id $$,
  array[]::uuid[],
  'the grantee''s attempt to revoke her own share grant deletes nothing (RLS delete check)'
);

select results_eq(
  $$ select count(*)::int from public.writing_shares where id = '54042000-0000-4000-8000-000000000001' $$,
  array[1],
  'the share grant still exists after the grantee''s no-op delete attempt'
);

-- ─── As the stranger: the actual enforcement proof this scenario exists for ───
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"54040000-0000-4000-8000-000000000003","role":"authenticated"}', true);

select results_eq(
  $$ select count(*)::int from public.writings where id = '54041000-0000-4000-8000-000000000001' $$,
  array[0],
  'a stranger cannot read a private writing'
);

select results_eq(
  $$ select count(*)::int from public.writings where id = '54041000-0000-4000-8000-000000000002' $$,
  array[0],
  'a stranger cannot read a writing shared with someone else, even knowing its id'
);

-- Positive control: RLS is scoping access, not blanket-denying everything —
-- a public writing is genuinely readable by a non-owner, non-grantee.
select results_eq(
  $$ select count(*)::int from public.writings where id = '54041000-0000-4000-8000-000000000003' $$,
  array[1],
  'a stranger CAN read a public writing — RLS is scoping, not blanket-denying'
);

-- A stranger cannot see the share grant row either (it names the grantee,
-- not her).
select results_eq(
  $$ select count(*)::int from public.writing_shares where writing_id = '54041000-0000-4000-8000-000000000002' $$,
  array[0],
  'a stranger cannot see the share-grant row for a document not shared with her'
);

-- Same RPC, same enforcement, from the stranger's side — must not leak
-- another user's incoming shares.
select results_eq(
  $$ select count(*)::int from public.list_incoming_shared_writings() $$,
  array[0],
  'the "shared with me" RPC returns nothing for a stranger — no cross-user leak'
);

-- ─── As an anonymous caller: only the public writing is visible ───
-- `anon` has a plain SELECT grant on writings (for public-writing browsing
-- without an account) and no auth.uid() at all — this is the one role
-- where can_read_writing()'s viewer_id is genuinely null, so it exercises
-- a code path the authenticated-stranger tests above cannot reach.
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select results_eq(
  $$ select count(*)::int from public.writings where id in ('54041000-0000-4000-8000-000000000001', '54041000-0000-4000-8000-000000000002') $$,
  array[0],
  'an anonymous caller cannot read the private or the shared writing'
);

select results_eq(
  $$ select count(*)::int from public.writings where id = '54041000-0000-4000-8000-000000000003' $$,
  array[1],
  'an anonymous caller CAN read the public writing'
);

-- ─── Revocation: the owner deletes the grant, access actually disappears ───
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"54040000-0000-4000-8000-000000000001","role":"authenticated"}', true);

delete from public.writing_shares where id = '54042000-0000-4000-8000-000000000001';

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"54040000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select results_eq(
  $$ select count(*)::int from public.writings where id = '54041000-0000-4000-8000-000000000002' $$,
  array[0],
  'after the owner revokes the share, the former grantee can no longer read it'
);

select results_eq(
  $$ select count(*)::int from public.writing_shares where id = '54042000-0000-4000-8000-000000000001' $$,
  array[0],
  'the revoked share-grant row is actually gone, not just hidden'
);

select * from finish();
rollback;
