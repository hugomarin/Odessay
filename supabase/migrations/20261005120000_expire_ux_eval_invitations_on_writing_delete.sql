begin;

create or replace function public.expire_ux_eval_invitations_on_writing_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.invitations as invitation
  set status = 'expired'
  where invitation.status = 'pending'
    and invitation.email = 'ux-eval+' || new.id::text || '@odessay.local';

  return new;
end;
$$;

drop trigger if exists writings_expire_ux_eval_invitations_after_soft_delete on public.writings;
create trigger writings_expire_ux_eval_invitations_after_soft_delete
after update of deleted_at on public.writings
for each row
when (old.deleted_at is null and new.deleted_at is not null)
execute function public.expire_ux_eval_invitations_on_writing_soft_delete();

update public.invitations as invitation
set status = 'expired'
from public.writings as writing
where writing.deleted_at is not null
  and invitation.status = 'pending'
  and invitation.email = 'ux-eval+' || writing.id::text || '@odessay.local';

commit;

-- Rollback reference (manual):
-- drop trigger if exists writings_expire_ux_eval_invitations_after_soft_delete on public.writings;
-- drop function if exists public.expire_ux_eval_invitations_on_writing_soft_delete();
-- Invitations expired by the trigger/backfill stay expired; reactivation requires an explicit token audit.
