begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('40700000-0000-4000-8000-000000000001', 'ode407-owner@example.test', '{"username":"ode407_owner"}'::jsonb),
  ('40700000-0000-4000-8000-000000000002', 'ode407-other@example.test', '{"username":"ode407_other"}'::jsonb);

insert into public.writings (id, author_id, title, version, deleted_at)
values
  ('40710000-0000-4000-8000-000000000001', '40700000-0000-4000-8000-000000000001', 'Owner restore target', 4, '2026-07-29T12:00:00Z'),
  ('40710000-0000-4000-8000-000000000002', '40700000-0000-4000-8000-000000000001', 'Owner delete target', 2, '2026-07-29T12:00:00Z'),
  ('40710000-0000-4000-8000-000000000003', '40700000-0000-4000-8000-000000000001', 'Owner active target', 1, null),
  ('40710000-0000-4000-8000-000000000004', '40700000-0000-4000-8000-000000000002', 'Other archived target', 3, '2026-07-29T12:00:00Z');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"40700000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  $$ select count(*) from public.writings where deleted_at is not null $$,
  array[2::bigint],
  'owner can select their archived writings'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"40700000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

select results_eq(
  $$ select count(*) from public.writings where author_id = '40700000-0000-4000-8000-000000000001' and deleted_at is not null $$,
  array[0::bigint],
  'authenticated non-owner cannot select another author archive'
);

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select results_eq(
  $$ select count(*) from public.writings where deleted_at is not null $$,
  array[0::bigint],
  'unauthenticated reader cannot select archives'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"40700000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

update public.writings
set deleted_at = null, version = version + 1
where id = '40710000-0000-4000-8000-000000000001';

select results_eq(
  $$ select count(*) from public.writings where id = '40710000-0000-4000-8000-000000000001' and deleted_at is null and version = 5 $$,
  array[1::bigint],
  'owner can restore an archived writing'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"40700000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

update public.writings
set deleted_at = null, version = version + 1
where id = '40710000-0000-4000-8000-000000000004';

reset role;
select results_eq(
  $$ select count(*) from public.writings where id = '40710000-0000-4000-8000-000000000004' and deleted_at is not null and version = 3 $$,
  array[1::bigint],
  'non-owner cannot restore another author archive'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"40700000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

delete from public.writings where id = '40710000-0000-4000-8000-000000000003';

reset role;
select results_eq(
  $$ select count(*) from public.writings where id = '40710000-0000-4000-8000-000000000003' $$,
  array[1::bigint],
  'owner cannot permanently delete a non-archived writing'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"40700000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

delete from public.writings where id = '40710000-0000-4000-8000-000000000002';

reset role;
select results_eq(
  $$ select count(*) from public.writings where id = '40710000-0000-4000-8000-000000000002' $$,
  array[1::bigint],
  'non-owner cannot permanently delete another author archive'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"40700000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

delete from public.writings where id = '40710000-0000-4000-8000-000000000002';

reset role;
select results_eq(
  $$ select count(*) from public.writings where id = '40710000-0000-4000-8000-000000000002' $$,
  array[0::bigint],
  'owner can permanently delete their archived writing'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"40700000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

delete from public.writings where id = '40710000-0000-4000-8000-000000000001';

reset role;
select results_eq(
  $$ select count(*) from public.writings where id = '40710000-0000-4000-8000-000000000001' $$,
  array[1::bigint],
  'a restored row is protected from permanent deletion'
);

select * from finish();
rollback;
