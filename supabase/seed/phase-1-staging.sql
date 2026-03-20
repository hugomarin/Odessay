-- Phase 1 Staging Seed
-- Deterministic UUIDs for reproducible QA flows.
-- Apply only in staging. Never in production.
--
-- Usage: psql $DATABASE_URL -f supabase/seed/phase-1-staging.sql
--        or via: npm run seed:phase1

begin;

-- ─── Seed users in auth.users ─────────────────────────────────────────────────
-- Passwords are all "Password1!" (bcrypt hash below).
-- These are test-only accounts; do not reuse in production.

insert into auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_user_meta_data,
  role,
  aud,
  created_at,
  updated_at
) values
  (
    'a1b2c3d4-0001-0001-0001-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'alice@staging.odessay.test',
    '$2a$10$PX9mZpJkLmNqRsTuVwXyZuABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    now(),
    '{"username": "alice", "display_name": "Alice Staging"}'::jsonb,
    'authenticated',
    'authenticated',
    now(),
    now()
  ),
  (
    'a1b2c3d4-0002-0002-0002-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'bob@staging.odessay.test',
    '$2a$10$PX9mZpJkLmNqRsTuVwXyZuABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    now(),
    '{"username": "bob", "display_name": "Bob Staging"}'::jsonb,
    'authenticated',
    'authenticated',
    now(),
    now()
  ),
  (
    'a1b2c3d4-0003-0003-0003-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'clara@staging.odessay.test',
    '$2a$10$PX9mZpJkLmNqRsTuVwXyZuABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    now(),
    '{"username": "clara", "display_name": "Clara Staging"}'::jsonb,
    'authenticated',
    'authenticated',
    now(),
    now()
  )
on conflict (id) do nothing;

-- Profiles are auto-created by the on_auth_user_created trigger.
-- The inserts above fire it. No manual profile inserts needed.

-- ─── Writings ─────────────────────────────────────────────────────────────────
-- 7 writings across Draft/Finished × Private/Shared/Public for Phase 1 QA.
-- body_json is minimal valid TipTap JSON. Triggers derive body_text and slug.

insert into public.writings (
  id,
  author_id,
  title,
  body_json,
  status,
  visibility,
  created_at,
  updated_at
) values

  -- Alice: private draft (no title, editor blank state)
  (
    'b1000000-0001-0001-0001-000000000001',
    'a1b2c3d4-0001-0001-0001-000000000001',
    null,
    '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
    'draft',
    'private',
    now() - interval '6 days',
    now() - interval '6 days'
  ),

  -- Alice: private draft with content (in-progress writing)
  (
    'b1000000-0001-0001-0001-000000000002',
    'a1b2c3d4-0001-0001-0001-000000000001',
    'Notas sobre el silencio',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"El silencio no es la ausencia de sonido, sino la presencia de algo que aún no tiene nombre."}]}]}'::jsonb,
    'draft',
    'private',
    now() - interval '5 days',
    now() - interval '2 hours'
  ),

  -- Alice: finished + shared with Bob (triggers shared visibility + writing_share)
  (
    'b1000000-0001-0001-0001-000000000003',
    'a1b2c3d4-0001-0001-0001-000000000001',
    'Una carta para Bob',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Bob, hay cosas que solo se pueden decir por escrito. Esta es una de ellas."}]}]}'::jsonb,
    'finished',
    'shared',
    now() - interval '4 days',
    now() - interval '4 days'
  ),

  -- Alice: finished + public
  (
    'b1000000-0001-0001-0001-000000000004',
    'a1b2c3d4-0001-0001-0001-000000000001',
    'Manifiesto de lo ordinario',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Lo extraordinario siempre fue ordinario visto con suficiente atención."}]},{"type":"paragraph","content":[{"type":"text","text":"No busco lo que no existe. Busco ver lo que ya está."}]}]}'::jsonb,
    'finished',
    'public',
    now() - interval '3 days',
    now() - interval '3 days'
  ),

  -- Bob: private draft
  (
    'b1000000-0002-0002-0002-000000000001',
    'a1b2c3d4-0002-0002-0002-000000000002',
    'Borrador sin título',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Respuesta pendiente. Hay algo que quiero decirle a Alice."}]}]}'::jsonb,
    'draft',
    'private',
    now() - interval '2 days',
    now() - interval '1 day'
  ),

  -- Bob: response to Alice's shared writing (parent_id set)
  (
    'b1000000-0002-0002-0002-000000000002',
    'a1b2c3d4-0002-0002-0002-000000000002',
    'Re: Una carta para Bob',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Alice, lo que describes resuena. Escribir es también escuchar."}]}]}'::jsonb,
    'finished',
    'shared',
    now() - interval '1 day',
    now() - interval '1 day'
  ),

  -- Clara: private draft (onboarding state, fresh user)
  (
    'b1000000-0003-0003-0003-000000000001',
    'a1b2c3d4-0003-0003-0003-000000000003',
    null,
    '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
    'draft',
    'private',
    now(),
    now()
  )

on conflict (id) do nothing;

-- Set parent_id for Bob's response (after writings exist)
update public.writings
set parent_id = 'b1000000-0001-0001-0001-000000000003'
where id = 'b1000000-0002-0002-0002-000000000002'
  and parent_id is null;

-- ─── Writing share: Alice → Bob ───────────────────────────────────────────────
insert into public.writing_shares (
  id,
  writing_id,
  shared_with_id,
  can_respond
) values (
  'c1000000-0001-0001-0001-000000000001',
  'b1000000-0001-0001-0001-000000000003',
  'a1b2c3d4-0002-0002-0002-000000000002',
  true
)
on conflict (writing_id, shared_with_id) do nothing;

-- Writing share: Bob → Alice (Bob's response)
insert into public.writing_shares (
  id,
  writing_id,
  shared_with_id,
  can_respond
) values (
  'c1000000-0002-0002-0002-000000000001',
  'b1000000-0002-0002-0002-000000000002',
  'a1b2c3d4-0001-0001-0001-000000000001',
  true
)
on conflict (writing_id, shared_with_id) do nothing;

commit;

-- Rollback (manual):
-- begin;
-- delete from public.writing_shares where id in (
--   'c1000000-0001-0001-0001-000000000001',
--   'c1000000-0002-0002-0002-000000000001'
-- );
-- delete from public.writings where id in (
--   'b1000000-0001-0001-0001-000000000001',
--   'b1000000-0001-0001-0001-000000000002',
--   'b1000000-0001-0001-0001-000000000003',
--   'b1000000-0001-0001-0001-000000000004',
--   'b1000000-0002-0002-0002-000000000001',
--   'b1000000-0002-0002-0002-000000000002',
--   'b1000000-0003-0003-0003-000000000001'
-- );
-- delete from public.profiles where id in (
--   'a1b2c3d4-0001-0001-0001-000000000001',
--   'a1b2c3d4-0002-0002-0002-000000000002',
--   'a1b2c3d4-0003-0003-0003-000000000003'
-- );
-- delete from auth.users where id in (
--   'a1b2c3d4-0001-0001-0001-000000000001',
--   'a1b2c3d4-0002-0002-0002-000000000002',
--   'a1b2c3d4-0003-0003-0003-000000000003'
-- );
-- commit;
