begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('52000000-0000-4000-8000-000000000001', 'ode520-owner@example.test', '{"username":"ode520_owner"}'::jsonb),
  ('52000000-0000-4000-8000-000000000002', 'ode520-attacker@example.test', '{"username":"ode520_attacker"}'::jsonb);

insert into public.writings (id, author_id, title, version, visibility, deleted_at)
values
  ('52010000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', 'Owner A private writing', 1, 'private', null),
  ('52010000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000002', 'Attacker B own writing', 1, 'private', null);

-- Requirement 2: the legitimate owner path still works — owner A can invite
-- on their own writing.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"52000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$ insert into public.invitations (inviter_id, writing_id, email, token, status)
     values (
       '52000000-0000-4000-8000-000000000001',
       '52010000-0000-4000-8000-000000000001',
       'ux-eval+52010000-0000-4000-8000-000000000001@odessay.local',
       'owner-a-legit-token-0001',
       'pending'
     ) $$,
  'owner A can create an invitation for their own writing'
);

-- Requirement 5, the exact exploit: attacker B knows A''s writing UUID and
-- tries to mint an invitation for it. inviter_id = B satisfies the old
-- (pre-ODE-520) check on its own; only the new ownership check stops this.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"52000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select throws_ok(
  $$ insert into public.invitations (inviter_id, writing_id, email, token, status)
     values (
       '52000000-0000-4000-8000-000000000002',
       '52010000-0000-4000-8000-000000000001',
       'ux-eval+52010000-0000-4000-8000-000000000001@odessay.local',
       'attacker-b-forged-token-0001',
       'pending'
     ) $$,
  '42501'::char(5),
  NULL,
  'attacker B cannot mint an invitation for owner A''s writing'
);

-- Requirement 2, continued: B can still legitimately invite on their own
-- writing.
select lives_ok(
  $$ insert into public.invitations (inviter_id, writing_id, email, token, status)
     values (
       '52000000-0000-4000-8000-000000000002',
       '52010000-0000-4000-8000-000000000002',
       'ux-eval+52010000-0000-4000-8000-000000000002@odessay.local',
       'attacker-b-own-token-0001',
       'pending'
     ) $$,
  'attacker B can still create an invitation for their own writing'
);

-- Requirement 1: UPDATE must protect the new relationship too — B tries to
-- retarget their own (legitimately created) invitation at A''s writing.
select throws_ok(
  $$ update public.invitations
     set writing_id = '52010000-0000-4000-8000-000000000001'
     where token = 'attacker-b-own-token-0001' $$,
  '42501'::char(5),
  NULL,
  'attacker B cannot retarget their own invitation at owner A''s writing'
);

-- Requirement 1, the old relationship: a row whose writing_id no longer
-- resolves to its inviter (a forged historical row, simulated here via
-- service_role the way an old pre-fix row would look) must not be a
-- candidate for update at all. USING filters candidate rows against the OLD
-- row, so this is not an exception — the row is simply invisible to B, and
-- the UPDATE silently affects nothing, unlike a WITH CHECK violation on a
-- row B still owns (which does throw, as tests 2 and 4 show).
reset role;
set local role service_role;
update public.invitations
set writing_id = '52010000-0000-4000-8000-000000000001'
where token = 'attacker-b-own-token-0001';
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"52000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

update public.invitations
set status = 'expired'
where token = 'attacker-b-own-token-0001';

reset role;
select results_eq(
  $$ select status from public.invitations where token = 'attacker-b-own-token-0001' $$,
  array['pending'],
  'B''s update on a row USING no longer sees as theirs affects zero rows — status stays pending'
);

-- Requirement 2, continued: owner A can still update the status of their own
-- legitimate invitation.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"52000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$ update public.invitations set status = 'expired' where token = 'owner-a-legit-token-0001' $$,
  'owner A can still update their own legitimate invitation'
);

reset role;
select * from finish();
rollback;
