begin;

-- ODE-521: syncMarginsFromBodyJson (lib/margins/margins.ts) upserts margin
-- rows keyed by an `id` extracted from client-controlled body_json, using the
-- admin (service_role) client, which bypasses RLS. An attacker who embeds
-- another reader's real margin UUID in their own document's body_json can
-- have that row's reader_id/writing_id/content silently overwritten by
-- `upsert(..., { onConflict: "id" })` — a full cross-owner takeover.
--
-- The fix is a table-level trigger rather than an application-layer check:
-- it applies uniformly to both the modern and legacy column-list upserts
-- (requirement 4) with no JS duplication, and because a single multi-row
-- INSERT/UPSERT statement is one atomic Postgres command, an exception
-- raised for ANY row in the batch rolls back the ENTIRE statement — no
-- partial application of the safe rows while skipping the hostile one
-- (requirement 3), with zero extra round trips (requirement: O(1) database
-- calls, not one authorization query per annotation).

create or replace function public.margins_enforce_identity() returns trigger
language plpgsql
as $$
declare
  v_existing record;
begin
  select reader_id, writing_id into v_existing
  from public.margins
  where id = new.id;

  if found then
    if v_existing.reader_id is distinct from new.reader_id
       or v_existing.writing_id is distinct from new.writing_id then
      -- The id is already attacker-known (they supplied it), so echoing it
      -- back discloses nothing new; the victim's reader_id/writing_id never
      -- appear in this message.
      raise exception 'MARGIN_OWNERSHIP_CONFLICT: annotation % is already associated with a different reader or writing', new.id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists margins_enforce_identity on public.margins;
create trigger margins_enforce_identity
before insert or update on public.margins
for each row
execute function public.margins_enforce_identity();

commit;

-- Rollback reference (manual):
-- drop trigger if exists margins_enforce_identity on public.margins;
-- drop function if exists public.margins_enforce_identity();
