begin;

-- Supabase security advisor run (2026-10-09). Closes the two ERROR-level
-- rls_disabled_in_public findings and the function-hardening warnings that
-- can be fixed without changing behavior.

-- 1. ERROR rls_disabled_in_public: the two ODE-524 admission tables were
-- created without RLS, so Supabase's default grants let anon/authenticated
-- read, edit and delete them through the REST API — e.g. deleting your own
-- rate-limit window or leases bypasses the AI quota, and every account_id is
-- readable. Both tables are only touched by the security-definer functions
-- ai_admission_try_acquire / ai_admission_release (service_role only); the
-- function owner bypasses RLS, so no policies are needed.
alter table public.ai_rate_limit_windows enable row level security;
alter table public.ai_concurrency_leases enable row level security;

revoke all on table public.ai_rate_limit_windows from anon, authenticated;
revoke all on table public.ai_concurrency_leases from anon, authenticated;

-- 2. WARN function_search_path_mutable: pin search_path. Every one of these
-- only references public objects or schema-qualified ones (auth.uid()).
alter function public.set_updated_at() set search_path = public;
alter function public.normalize_slug(text) set search_path = public;
alter function public.writings_set_derived_fields() set search_path = public;
alter function public.extract_tiptap_text(jsonb) set search_path = public;
alter function public.margins_set_shared_at() set search_path = public;
alter function public.set_writing_content_updated_at() set search_path = public;
alter function public.set_writing_metadata_updated_at() set search_path = public;
alter function public.margins_enforce_identity() set search_path = public;

-- 3. WARN *_security_definer_function_executable.
-- 3a. Trigger functions: never meant to be called through /rest/v1/rpc.
-- EXECUTE is only checked at CREATE TRIGGER time, so existing triggers keep
-- firing.
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.set_writing_content_updated_at() from public, anon, authenticated;
revoke execute on function public.set_writing_metadata_updated_at() from public, anon, authenticated;
revoke execute on function public.touch_correspondence_updated_at() from public, anon, authenticated;
revoke execute on function public.writings_assign_correspondence() from public, anon, authenticated;
revoke execute on function public.expire_ux_eval_invitations_on_writing_soft_delete() from public, anon, authenticated;

-- 3b. Internal helpers only called from security-definer functions
-- (handle_new_auth_user, touch_correspondence_updated_at), which run as the
-- owner. sync_correspondence_metadata let any caller rewrite a
-- correspondence's title/updated_at.
revoke execute on function public.ensure_unique_username(text, uuid) from public, anon, authenticated;
revoke execute on function public.sync_correspondence_metadata(uuid) from public, anon, authenticated;

-- 3c. generate_unique_writing_slug is called from the security-invoker
-- trigger writings_set_derived_fields, so authenticated must keep EXECUTE;
-- anon never writes writings.
revoke execute on function public.generate_unique_writing_slug(uuid, text, uuid) from public, anon;
grant execute on function public.generate_unique_writing_slug(uuid, text, uuid) to authenticated;

-- 3d. Signed-in RPCs: they already reject a null auth.uid(), drop anon anyway.
revoke execute on function public.claim_profile_username(text) from public, anon;
grant execute on function public.claim_profile_username(text) to authenticated;
revoke execute on function public.list_incoming_shared_writings() from public, anon;
grant execute on function public.list_incoming_shared_writings() to authenticated;
revoke execute on function public.replace_writing_collections(uuid, uuid[], timestamptz) from public, anon;
grant execute on function public.replace_writing_collections(uuid, uuid[], timestamptz) to authenticated;

-- Intentionally unchanged:
-- * can_read_writing / can_access_correspondence: evaluated inside RLS
--   policies, including anon reads of public writings.
-- * public_profiles (security_definer_view): deliberate public projection of
--   id/username/display_name/bio over the self-only profiles table.

commit;
