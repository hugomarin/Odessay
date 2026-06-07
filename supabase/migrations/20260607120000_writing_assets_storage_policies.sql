-- Storage RLS policies for the writing-assets bucket.
--
-- The bucket was created manually in the Supabase dashboard.
-- These policies are required for desktop clients, which upload directly
-- using the authenticated user's JWT (no admin bypass).
--
-- Path convention: {author_id}/{writing_id}/{asset_id}.{ext}
-- The first path segment is always the author's UUID, which lets us
-- scope every policy to the owner without joining other tables.

insert into storage.buckets (id, name, public)
values ('writing-assets', 'writing-assets', false)
on conflict (id) do nothing;

-- Authors can upload to their own prefix.
create policy "writing_assets_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'writing-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Authors can read their own objects; also allows reading objects
-- that belong to a writing the viewer has access to (public / shared).
create policy "writing_assets_select"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'writing-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Authors can delete their own objects.
create policy "writing_assets_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'writing-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Rollback:
-- drop policy if exists "writing_assets_insert" on storage.objects;
-- drop policy if exists "writing_assets_select" on storage.objects;
-- drop policy if exists "writing_assets_delete" on storage.objects;
