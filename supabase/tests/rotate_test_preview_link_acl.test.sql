begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('51900000-0000-4000-8000-000000000001', 'ode519-owner@example.test', '{"username":"ode519_owner"}'::jsonb),
  ('51900000-0000-4000-8000-000000000002', 'ode519-attacker@example.test', '{"username":"ode519_attacker"}'::jsonb);

insert into public.writings (id, author_id, title, version, deleted_at)
values
  ('51910000-0000-4000-8000-000000000001', '51900000-0000-4000-8000-000000000001', 'Owner writing', 1, null);

-- Requirement 1 (ODE-519): PUBLIC execute must be revoked, not just anon.
select ok(
  not has_function_privilege('public', 'public.rotate_test_preview_link(uuid,uuid,text)', 'EXECUTE'),
  'PUBLIC cannot execute rotate_test_preview_link'
);

select ok(
  not has_function_privilege('anon', 'public.rotate_test_preview_link(uuid,uuid,text)', 'EXECUTE'),
  'anon cannot execute rotate_test_preview_link'
);

select ok(
  not has_function_privilege('authenticated', 'public.rotate_test_preview_link(uuid,uuid,text)', 'EXECUTE'),
  'authenticated cannot execute rotate_test_preview_link'
);

select ok(
  has_function_privilege('service_role', 'public.rotate_test_preview_link(uuid,uuid,text)', 'EXECUTE'),
  'service_role retains execute on rotate_test_preview_link'
);

-- The audit reproduced execution "under SET ROLE anon after applying all
-- migrations" — assert that reproduction is now closed, not just that the
-- catalog privilege looks right.
set local role anon;

select throws_ok(
  $$ select * from public.rotate_test_preview_link(
       '51900000-0000-4000-8000-000000000001'::uuid,
       '51910000-0000-4000-8000-000000000001'::uuid,
       'anon-attempt-token'
     ) $$,
  'permission denied for function rotate_test_preview_link'::text,
  'anon calling the RPC directly is rejected at the privilege level'::text
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"51900000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

select throws_ok(
  $$ select * from public.rotate_test_preview_link(
       '51900000-0000-4000-8000-000000000002'::uuid,
       '51910000-0000-4000-8000-000000000001'::uuid,
       'authenticated-attempt-token'
     ) $$,
  'permission denied for function rotate_test_preview_link'::text,
  'authenticated non-owner calling the RPC directly is rejected at the privilege level'::text
);

-- Requirement 2: even from service_role (the only role that can still call
-- it), the function itself rejects an inviter who does not own the writing —
-- it must not rely solely on the caller route already having checked this.
reset role;
set local role service_role;

select throws_ok(
  $$ select * from public.rotate_test_preview_link(
       '51900000-0000-4000-8000-000000000002'::uuid,
       '51910000-0000-4000-8000-000000000001'::uuid,
       'wrong-owner-token'
     ) $$,
  'p_inviter_id is not the owner of the active writing'::text,
  'a non-owner p_inviter_id is rejected even when called with service_role'::text
);

-- Requirement 4: the legitimate owner path still works end to end.
select is(
  (
    select count(*)::int
    from public.rotate_test_preview_link(
      '51900000-0000-4000-8000-000000000001'::uuid,
      '51910000-0000-4000-8000-000000000001'::uuid,
      'owner-token'
    )
  ),
  1,
  'the writing owner can still rotate their own preview link via service_role'
);

reset role;
select * from finish();
rollback;
