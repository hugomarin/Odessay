-- Desktop "Shared with me" author resolution.
--
-- The desktop app talks to Supabase with the authenticated anon client, so RLS
-- applies. The hardening migration (20260317221000) restricted profiles SELECT
-- to self only (auth.uid() = id), which means a recipient cannot read the
-- author's username/display_name through a normal embed — the author renders as
-- "Unknown author".
--
-- The web app sidesteps this by running the sharing query server-side with the
-- service-role key. To give desktop the same data without reopening the
-- profiles table, expose a SECURITY DEFINER function that returns ONLY the
-- writings shared with the calling user, joined to the author's public profile
-- fields (username, display_name). Access is scoped to auth.uid(), so a caller
-- can never read shares or profiles that are not theirs.

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
  order by w.updated_at desc;
$$;

revoke all on function public.list_incoming_shared_writings() from public;
grant execute on function public.list_incoming_shared_writings() to authenticated;
