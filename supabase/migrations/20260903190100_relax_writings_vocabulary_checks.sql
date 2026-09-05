begin;

-- ODE-472: the vocabulary is no longer a closed union — a user can create
-- custom artifact types and statuses. Validation that a value belongs to the
-- user's vocabulary moves to the application layer (INVALID_INPUT on write);
-- the database keeps only a shape constraint so it still rejects garbage
-- (empty string, absurd length) without re-closing the vocabulary.

alter table public.writings
  drop constraint if exists writings_artifact_type_check;

alter table public.writings
  add constraint writings_artifact_type_shape_check
  check (char_length(artifact_type) > 0 and char_length(artifact_type) <= 64);

alter table public.writings
  drop constraint if exists writings_status_check;

alter table public.writings
  add constraint writings_status_shape_check
  check (char_length(status) > 0 and char_length(status) <= 64);

commit;

-- rollback:
-- begin;
-- alter table public.writings drop constraint if exists writings_artifact_type_shape_check;
-- alter table public.writings
--   add constraint writings_artifact_type_check
--   check (artifact_type in ('general', 'agent', 'skill', 'prompt', 'template', 'status'));
-- alter table public.writings drop constraint if exists writings_status_shape_check;
-- alter table public.writings
--   add constraint writings_status_check
--   check (status in ('new', 'exploring', 'draft', 'in_review', 'done', 'archived', 'canceled'));
-- commit;
