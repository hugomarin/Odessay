begin;

-- ODE-664: un writing que conserva filas vigentes en `writing_shares` converge
-- a `shared` en el mismo UPDATE que pide `private`. La regla vive en el owner
-- existente (`public.writings_set_derived_fields`, migración del 2026-03-31),
-- antes de derivar el slug, para que el PATCH web, el sync desktop bajo RLS y
-- cualquier otro caller compartan el resultado sin reglas divergentes.
--
-- Decisión aceptada (Hugo, 2026-10-03): cada fila existente de
-- `writing_shares` es un grant vigente; no hay backfill ni revocación
-- automática. Los grants obsoletos se revisan/revocan explícitamente antes de
-- este cambio. `can_read_writing` y la lista incoming siguen exigiendo
-- `visibility = 'shared'` y la fila de share del viewer, así que la promoción
-- no amplía el acceso más allá de los grants existentes.
create or replace function public.writings_set_derived_fields()
returns trigger
language plpgsql
as $$
declare
  slug_source text;
begin
  -- ODE-664: promover `private` → `shared` cuando ya existe un grant. Corre
  -- antes de derivar el slug: un writing promovido en este UPDATE estrena slug
  -- igual que uno que ya llega `shared`. El trigger solo se dispara en
  -- UPDATE OF body_json, title, visibility, slug, author_id (initial_schema),
  -- y el payload de sync desktop incluye `visibility`.
  if new.visibility = 'private'
     and exists (
       select 1
       from public.writing_shares ws
       where ws.writing_id = new.id
     ) then
    new.visibility := 'shared';
  end if;

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

-- Rollback (manual): restaurar la función vigente de
-- supabase/migrations/20260331_phase2_visibility_rls.sql (body_text + slug
-- estable, sin promoción de visibilidad). Pegar su definición completa:
--
-- begin;
--
-- create or replace function public.writings_set_derived_fields()
-- returns trigger
-- language plpgsql
-- as $$
-- declare
--   slug_source text;
-- begin
--   -- Derive body_text from body_json on insert or when body_json changes.
--   if tg_op = 'INSERT' or new.body_json is distinct from old.body_json then
--     new.body_text := public.extract_tiptap_text(new.body_json);
--   end if;
--
--   -- Generate slug on first publication (shared or public).
--   -- Once a slug is assigned it is stable and must not change.
--   if new.visibility in ('shared', 'public') then
--     if tg_op = 'UPDATE' and old.slug is not null then
--       -- Restore the persisted slug regardless of what the client sent.
--       -- Local-first clients send slug:null until the next remote bootstrap
--       -- updates their local store with the server-assigned value.
--       new.slug := old.slug;
--     elsif new.slug is null then
--       -- First-time generation: title → body_text excerpt → short id.
--       slug_source := nullif(trim(coalesce(new.title, '')), '');
--
--       if slug_source is null then
--         slug_source := nullif(left(trim(coalesce(new.body_text, '')), 60), '');
--       end if;
--
--       if slug_source is null then
--         -- UUID first 8 hex chars always produce a valid normalize_slug output.
--         slug_source := left(new.id::text, 8);
--       end if;
--
--       new.slug := public.generate_unique_writing_slug(new.author_id, slug_source, new.id);
--     end if;
--   end if;
--
--   return new;
-- end;
-- $$;
--
-- commit;
