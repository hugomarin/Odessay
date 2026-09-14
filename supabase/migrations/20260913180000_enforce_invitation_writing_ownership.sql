begin;

-- ODE-520: invitations_insert_inviter only checked inviter_id = auth.uid(),
-- never that the inviter actually owns writing_id. Any authenticated user
-- could INSERT an invitation row (with themselves as inviter_id, satisfying
-- the old check) pointing at any writing UUID they knew, forging the same
-- ux-eval marker email and a token of their choosing — a path entirely
-- independent of the rotate_test_preview_link RPC closed in ODE-519.
-- invitations_update_inviter_or_service_role had the same gap on UPDATE, so
-- an attacker's own (legitimately created) invitation could be retargeted at
-- someone else's writing after the fact.

drop policy if exists invitations_insert_inviter on public.invitations;
create policy invitations_insert_inviter
on public.invitations
for insert
with check (
  inviter_id = auth.uid()
  and exists (
    select 1
    from public.writings w
    where w.id = writing_id
      and w.author_id = auth.uid()
      and w.deleted_at is null
  )
);

-- Requirement 1: UPDATE must protect both the old and new relationship. USING
-- re-checks ownership against the row as it stands before the update (so a
-- historical forged row, or one whose writing changed hands, is not even a
-- candidate for update); WITH CHECK evaluates the full row after the update,
-- so it also covers writing_id being changed to a UUID the caller does not
-- own.
drop policy if exists invitations_update_inviter_or_service_role on public.invitations;
create policy invitations_update_inviter_or_service_role
on public.invitations
for update
using (
  auth.role() = 'service_role'
  or (
    inviter_id = auth.uid()
    and exists (
      select 1
      from public.writings w
      where w.id = writing_id
        and w.author_id = auth.uid()
        and w.deleted_at is null
    )
  )
)
with check (
  status in ('pending', 'accepted', 'expired')
  and (
    auth.role() = 'service_role'
    or (
      inviter_id = auth.uid()
      and exists (
        select 1
        from public.writings w
        where w.id = writing_id
          and w.author_id = auth.uid()
          and w.deleted_at is null
      )
    )
  )
);

commit;

-- Rollback reference (manual):
-- Restoring the pre-ODE-520 policies re-introduces the vulnerability; there
-- is no safe rollback beyond re-deploying the previous policy bodies
-- (20260317223000_fix_reviewed_correspondence_and_status_guards.sql) without
-- a matching decision to accept the risk.
