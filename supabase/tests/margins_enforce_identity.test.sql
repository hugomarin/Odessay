begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('52100000-0000-4000-8000-000000000001', 'ode521-owner-a@example.test', '{"username":"ode521_owner_a"}'::jsonb),
  ('52100000-0000-4000-8000-000000000002', 'ode521-attacker-b@example.test', '{"username":"ode521_attacker_b"}'::jsonb);

insert into public.profiles (id, username)
values
  ('52100000-0000-4000-8000-000000000001', 'ode521_owner_a'),
  ('52100000-0000-4000-8000-000000000002', 'ode521_attacker_b');

insert into public.writings (id, author_id, title, version)
values
  ('52110000-0000-4000-8000-000000000001', '52100000-0000-4000-8000-000000000001', 'Owner A writing', 1),
  ('52110000-0000-4000-8000-000000000002', '52100000-0000-4000-8000-000000000002', 'Attacker B writing', 1);

-- Owner A creates a real margin.
insert into public.margins (id, reader_id, writing_id, anchor_start, anchor_end, anchor_text, note)
values (
  '52120000-0000-4000-8000-000000000001',
  '52100000-0000-4000-8000-000000000001',
  '52110000-0000-4000-8000-000000000001',
  0, 10, 'anchor text', 'A''s real annotation'
);

-- Requirement 5's exact exploit: attacker B embeds A's real margin id in
-- their own body_json, producing an upsert row with B's own reader_id/
-- writing_id but A's margin id.
select throws_like(
  $$ insert into public.margins (id, reader_id, writing_id, anchor_start, anchor_end, anchor_text, note)
     values (
       '52120000-0000-4000-8000-000000000001',
       '52100000-0000-4000-8000-000000000002',
       '52110000-0000-4000-8000-000000000002',
       0, 10, 'hijacked anchor', 'hostile content'
     )
     on conflict (id) do update set
       reader_id = excluded.reader_id,
       writing_id = excluded.writing_id,
       anchor_text = excluded.anchor_text,
       note = excluded.note $$,
  'MARGIN_OWNERSHIP_CONFLICT%',
  'attacker B cannot claim owner A''s margin id via upsert'
);

-- Requirement 1/3: the original row is untouched, byte for byte, on its
-- original owner and writing.
select results_eq(
  $$ select reader_id, writing_id, anchor_text, note from public.margins where id = '52120000-0000-4000-8000-000000000001' $$,
  $$ values ('52100000-0000-4000-8000-000000000001'::uuid, '52110000-0000-4000-8000-000000000001'::uuid, 'anchor text'::text, 'A''s real annotation'::text) $$,
  'the hijack attempt leaves the original row exactly as it was'
);

-- Requirement 3, at batch scale: one legitimate row for B plus one hostile
-- id (A's) in the SAME statement must reject the whole batch — not insert
-- the legitimate row while skipping the hostile one.
select throws_like(
  $$ insert into public.margins (id, reader_id, writing_id, anchor_start, anchor_end, anchor_text, note)
     values
       ('52120000-0000-4000-8000-000000000099', '52100000-0000-4000-8000-000000000002', '52110000-0000-4000-8000-000000000002', 0, 5, 'legit anchor', 'B''s own new annotation'),
       ('52120000-0000-4000-8000-000000000001', '52100000-0000-4000-8000-000000000002', '52110000-0000-4000-8000-000000000002', 0, 10, 'hijacked anchor', 'hostile content')
     on conflict (id) do update set
       reader_id = excluded.reader_id,
       writing_id = excluded.writing_id,
       anchor_text = excluded.anchor_text,
       note = excluded.note $$,
  'MARGIN_OWNERSHIP_CONFLICT%',
  'a batch mixing one legitimate row and one hostile id is rejected atomically'
);

select is(
  (select count(*)::int from public.margins where id = '52120000-0000-4000-8000-000000000099'),
  0,
  'the legitimate row from the rejected batch was not partially inserted'
);

-- Requirement 6: legitimate edits to an owned margin still work.
select lives_ok(
  $$ insert into public.margins (id, reader_id, writing_id, anchor_start, anchor_end, anchor_text, note)
     values (
       '52120000-0000-4000-8000-000000000001',
       '52100000-0000-4000-8000-000000000001',
       '52110000-0000-4000-8000-000000000001',
       0, 12, 'anchor text updated', 'A''s edited annotation'
     )
     on conflict (id) do update set
       anchor_end = excluded.anchor_end,
       anchor_text = excluded.anchor_text,
       note = excluded.note $$,
  'owner A can still edit their own margin through the same upsert shape'
);

-- Requirement 6, continued: brand-new ids insert normally.
select lives_ok(
  $$ insert into public.margins (id, reader_id, writing_id, anchor_start, anchor_end, anchor_text, note)
     values (
       '52120000-0000-4000-8000-000000000002',
       '52100000-0000-4000-8000-000000000002',
       '52110000-0000-4000-8000-000000000002',
       0, 8, 'B''s own anchor', 'B''s own new annotation'
     )
     on conflict (id) do update set
       anchor_end = excluded.anchor_end $$,
  'a brand-new id inserts normally for its rightful reader/writing'
);

select * from finish();
rollback;
