begin;

-- ODE-61: Implement shared and public visibility
--
-- The schema, RLS policies, and trigger skeleton for visibility were already in
-- place from the initial migration (Fase 0). This migration makes two targeted
-- corrections to `writings_set_derived_fields`:
--
--   1. Slug fallback chain — the original function only generated a slug when
--      the writing had a non-empty title. The spec requires a fallback to the
--      first 60 chars of body_text, and then to the short writing id, so that
--      every public/shared writing always gets a URL-safe slug.
--
--   2. Slug stability — in the local-first architecture the sync worker sends
--      the full writing payload on every flush, including `slug: null` (because
--      the local store has not yet received the server-assigned slug). The
--      previous trigger would regenerate the slug on each of those flushes.
--      The fix: for UPDATE operations, if the DB already has a slug, restore it
--      unconditionally — the slug is immutable once assigned.

create or replace function public.writings_set_derived_fields()
returns trigger
language plpgsql
as $$
declare
  slug_source text;
begin
  -- Derive body_text from body_json on insert or when body_json changes.
  if tg_op = 'INSERT' or new.body_json is distinct from old.body_json then
    new.body_text := public.extract_tiptap_text(new.body_json);
  end if;

  -- Generate slug on first publication (shared or public).
  -- Once a slug is assigned it is stable and must not change.
  if new.visibility in ('shared', 'public') then
    if tg_op = 'UPDATE' and old.slug is not null then
      -- Restore the persisted slug regardless of what the client sent.
      -- Local-first clients send slug:null until the next remote bootstrap
      -- updates their local store with the server-assigned value.
      new.slug := old.slug;
    elsif new.slug is null then
      -- First-time generation: title → body_text excerpt → short id.
      slug_source := nullif(trim(coalesce(new.title, '')), '');

      if slug_source is null then
        slug_source := nullif(left(trim(coalesce(new.body_text, '')), 60), '');
      end if;

      if slug_source is null then
        -- UUID first 8 hex chars always produce a valid normalize_slug output.
        slug_source := left(new.id::text, 8);
      end if;

      new.slug := public.generate_unique_writing_slug(new.author_id, slug_source, new.id);
    end if;
  end if;

  return new;
end;
$$;

commit;

-- Rollback reference (manual):
-- Restore original writings_set_derived_fields from 20260317145743_initial_schema.sql
-- (re-run that function definition).
