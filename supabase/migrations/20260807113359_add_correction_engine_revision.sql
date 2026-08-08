-- ODE-415: add engine_revision to correction_blocks so cache rows from a
-- previous model/prompt revision can be rejected during hydration.

alter table public.correction_blocks
  add column if not exists engine_revision text null;

-- rollback:
-- alter table public.correction_blocks drop column if exists engine_revision;
