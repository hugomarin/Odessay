begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('67200000-0000-4000-8000-000000000001', 'ode672-owner@example.test', '{"username":"ode672_owner"}'::jsonb),
  ('67200000-0000-4000-8000-000000000002', 'ode672-stranger@example.test', '{"username":"ode672_stranger"}'::jsonb);

insert into public.writings (id, author_id, title, visibility, status, version)
values
  ('67210000-0000-4000-8000-000000000001', '67200000-0000-4000-8000-000000000001', 'Owner private', 'private', 'draft', 1),
  ('67210000-0000-4000-8000-000000000002', '67200000-0000-4000-8000-000000000001', 'Owner shared', 'shared', 'draft', 1),
  ('67210000-0000-4000-8000-000000000003', '67200000-0000-4000-8000-000000000001', 'Owner public', 'public', 'draft', 1);

select ok(
  not has_function_privilege('public', 'public.can_read_writing(uuid,uuid)', 'EXECUTE'),
  'PUBLIC cannot execute can_read_writing'
);

select ok(
  has_function_privilege('anon', 'public.can_read_writing(uuid,uuid)', 'EXECUTE'),
  'anon retains execute on can_read_writing for RLS evaluation'
);

select ok(
  has_function_privilege('authenticated', 'public.can_read_writing(uuid,uuid)', 'EXECUTE'),
  'authenticated retains execute on can_read_writing for RLS evaluation'
);

select ok(
  has_function_privilege('service_role', 'public.can_read_writing(uuid,uuid)', 'EXECUTE'),
  'service_role can execute can_read_writing for the import path'
);

-- An anonymous caller has no session identity. An explicit other viewer must
-- not turn the SECURITY DEFINER function into a cross-user oracle.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select is(
  public.can_read_writing('67210000-0000-4000-8000-000000000001', '67200000-0000-4000-8000-000000000001'),
  false,
  'anon cannot spoof the owner identity for a private writing'
);

select is(
  public.can_read_writing('67210000-0000-4000-8000-000000000003', null::uuid),
  true,
  'anon with a null viewer can read a public writing'
);

select is(
  public.can_read_writing('67210000-0000-4000-8000-000000000001', null::uuid),
  false,
  'anon with a null viewer cannot read a private writing'
);

select is(
  public.can_read_writing('67210000-0000-4000-8000-000000000002', null::uuid),
  false,
  'anon with a null viewer cannot read a shared writing'
);

-- Authenticated callers may pass only their own session identity.
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"67200000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

select is(
  public.can_read_writing('67210000-0000-4000-8000-000000000001', '67200000-0000-4000-8000-000000000002'),
  false,
  'authenticated stranger cannot read the private writing as herself'
);

select is(
  public.can_read_writing('67210000-0000-4000-8000-000000000001', '67200000-0000-4000-8000-000000000001'),
  false,
  'authenticated stranger cannot spoof the owner identity'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"67200000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select is(
  public.can_read_writing('67210000-0000-4000-8000-000000000001', '67200000-0000-4000-8000-000000000001'),
  true,
  'authenticated owner can read a private writing as herself'
);

-- This is the legitimate explicit-viewer call shape used by the import route.
reset role;
set local role service_role;

select is(
  public.can_read_writing('67210000-0000-4000-8000-000000000002', '67200000-0000-4000-8000-000000000001'),
  true,
  'service_role retains explicit viewer access for a shared writing'
);

reset role;
select * from finish();
rollback;
