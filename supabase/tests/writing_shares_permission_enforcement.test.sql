-- SHARE-04 — Permission enforcement (real RLS, not verified manually)
--
-- tests/writing-shares.test.ts's own header says "RLS enforcement is
-- verified manually via Supabase MCP ... requires live DB connection." This
-- is that automated proof: only authorized consumers (owner, an explicitly
-- shared-with user, or anyone for a public writing) can read a writing —
-- and only the owner can grant or revoke a share, never the grantee or an
-- anonymous caller.
--
-- It also pins the oracle itself: public.can_read_writing(target, viewer) is
-- called directly with an explicit viewer and literal expected booleans for
-- owner (all three visibilities), anonymous, authenticated stranger, active
-- grantee, revoked grantee, stale share on a private writing, soft-deleted
-- writing and a nonexistent id. Those assertions go through no RLS policy,
-- RPC or application wrapper, so a wrapper cannot agree with the function
-- while both are wrong in the same way.
--
-- Scope: this proves the database authorization substrate (RLS on
-- writings/writing_shares, plus the security-definer RPC desktop uses for
-- "shared with me") — two independent authorization paths, both real
-- Postgres. The web app's service-role paths (`/shared/[id]`,
-- `listSharedWritingsForUser()`, `web-sharing-service.ts`,
-- `/api/writings/import`), which use `createAdminClient()` and re-implement
-- their own manual ownership/share checks instead of relying on RLS, are
-- proven separately, not here: tests/integration/sharing/service-role-authorization.supabase.test.ts
-- (ODE-616 PR2). See workflow/quality/capability-integration-map.md (SHARE-04).
--
-- Run locally: npm run supabase:locked -- supabase test db --local supabase/tests/writing_shares_permission_enforcement.test.sql
-- CI: the supabase-local job runs `supabase test db --local`, which discovers
-- every supabase/tests/*.test.sql file — this one included.

begin;

create extension if not exists pgtap with schema extensions;

select plan(33);

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

-- F1 (ODE-616): a `private` writing with a stale share row (the state the
-- desktop sync creates with a direct UPDATE) must not appear in the RPC
-- either. Fixture setup only; the assertion below under the grantee's role
-- is the property under test.
insert into public.writing_shares (id, writing_id, shared_with_id)
values ('54042000-0000-4000-8000-000000000002', '54041000-0000-4000-8000-000000000001', '54040000-0000-4000-8000-000000000002');

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

-- F1 (ODE-616): the stale share row on the private writing must not leak it
-- into the list, even though the share row exists.
select results_eq(
  $$ select count(*)::int from public.list_incoming_shared_writings() where id = '54041000-0000-4000-8000-000000000001' $$,
  array[0],
  'the "shared with me" RPC excludes a private writing with a stale share row'
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

-- ─── Direct oracle: can_read_writing(target, viewer) with explicit viewers ───
-- The assertions below call public.can_read_writing itself from the test's
-- privileged session, passing the viewer explicitly: auth.uid() is never
-- read, and no RLS policy, RPC or application wrapper participates in the
-- result. The expected values are the contract's literal booleans.
reset role;

select is(public.can_read_writing('54041000-0000-4000-8000-000000000001', '54040000-0000-4000-8000-000000000001'), true,
  'oracle: the owner can read her private writing');

select is(public.can_read_writing('54041000-0000-4000-8000-000000000002', '54040000-0000-4000-8000-000000000001'), true,
  'oracle: the owner can read her shared writing');

select is(public.can_read_writing('54041000-0000-4000-8000-000000000003', '54040000-0000-4000-8000-000000000001'), true,
  'oracle: the owner can read her public writing');

select is(public.can_read_writing('54041000-0000-4000-8000-000000000003', null::uuid), true,
  'oracle: an anonymous viewer (null auth.uid()) can read a public writing');

select is(public.can_read_writing('54041000-0000-4000-8000-000000000001', null::uuid), false,
  'oracle: an anonymous viewer cannot read a private writing');

select is(public.can_read_writing('54041000-0000-4000-8000-000000000002', null::uuid), false,
  'oracle: an anonymous viewer cannot read a shared writing');

select is(public.can_read_writing('54041000-0000-4000-8000-000000000003', '54040000-0000-4000-8000-000000000003'), true,
  'oracle: an authenticated stranger can read a public writing');

select is(public.can_read_writing('54041000-0000-4000-8000-000000000001', '54040000-0000-4000-8000-000000000003'), false,
  'oracle: an authenticated stranger cannot read a private writing');

select is(public.can_read_writing('54041000-0000-4000-8000-000000000002', '54040000-0000-4000-8000-000000000003'), false,
  'oracle: an authenticated stranger cannot read a writing shared with someone else');

select is(public.can_read_writing('54041000-0000-4000-8000-000000000002', '54040000-0000-4000-8000-000000000002'), true,
  'oracle: the grantee can read the writing shared with her while the grant exists');

select is(public.can_read_writing('54041000-0000-4000-8000-000000000001', '54040000-0000-4000-8000-000000000002'), false,
  'oracle: a stale share row on a private writing gives its grantee no access');

select is(public.can_read_writing('54041000-0000-4000-8000-000000000099', '54040000-0000-4000-8000-000000000001'), false,
  'oracle: a nonexistent writing id is unreadable even by the owner');

-- Soft delete is part of the contract for every visibility. Positive control
-- first: a stranger reads the same writing while it is alive.
insert into public.writings (id, author_id, title, visibility, status, version)
values ('54041000-0000-4000-8000-000000000004', '54040000-0000-4000-8000-000000000001', 'Doomed', 'public', 'draft', 1);

select is(public.can_read_writing('54041000-0000-4000-8000-000000000004', '54040000-0000-4000-8000-000000000003'), true,
  'oracle control: a stranger can read the public writing before it is soft-deleted');

update public.writings
set deleted_at = timezone('utc', now())
where id = '54041000-0000-4000-8000-000000000004';

select is(public.can_read_writing('54041000-0000-4000-8000-000000000004', '54040000-0000-4000-8000-000000000003'), false,
  'oracle: a soft-deleted public writing is unreadable for a stranger');

select is(public.can_read_writing('54041000-0000-4000-8000-000000000004', '54040000-0000-4000-8000-000000000001'), false,
  'oracle: a soft-deleted writing is unreadable even for its owner');

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

-- The direct oracle call that returned true while the grant existed now
-- returns false: revocation is visible to the contract itself.
reset role;

select is(public.can_read_writing('54041000-0000-4000-8000-000000000002', '54040000-0000-4000-8000-000000000002'), false,
  'oracle: after revocation the former grantee cannot read the shared writing');

select * from finish();
rollback;
