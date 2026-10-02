-- ODE-616 (SHARE-04, F1): la RPC del listado de compartidos de desktop
-- autorizaba solo con la fila de `writing_shares`, sin mirar la visibilidad.
-- Un documento `private` con un share viejo (estado que crea el sync de
-- desktop con un UPDATE directo) seguía apareciendo en "Shared with me",
-- aunque su lectura ya estaba negada. Esta migración la alinea con la regla
-- de los listados: share Y `visibility in ('shared','public')`, vía
-- `can_read_writing` (misma regla que RLS, incluido el público con share).
--
-- `create or replace` conserva los grants existentes de
-- `20260613140041_add_list_incoming_shared_writings_rpc.sql`
-- (revoke a public, grant execute a authenticated).
--
-- Rollback (manual): re-ejecutar la definición de
-- `20260613140041_add_list_incoming_shared_writings_rpc.sql` (sin la
-- condición `and public.can_read_writing(w.id, auth.uid())`).

create or replace function public.list_incoming_shared_writings()
returns table (
  id uuid,
  title text,
  slug text,
  body_text text,
  updated_at timestamptz,
  author_username text,
  author_display_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    w.id,
    w.title,
    w.slug,
    w.body_text,
    w.updated_at,
    p.username,
    p.display_name
  from public.writing_shares ws
  join public.writings w on w.id = ws.writing_id
  left join public.profiles p on p.id = w.author_id
  where ws.shared_with_id = auth.uid()
    and w.deleted_at is null
    and w.author_id <> auth.uid()
    and public.can_read_writing(w.id, auth.uid())
  order by w.updated_at desc;
$$;
