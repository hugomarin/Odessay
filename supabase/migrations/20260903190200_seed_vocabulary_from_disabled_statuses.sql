begin;

-- ODE-472: profiles.disabled_statuses is deprecated in favor of per-item
-- `hidden` on vocabulary_items, but its content survives — it is reflected
-- once into hidden status rows so no user's preference is lost. Only the
-- statuses a profile actually disabled get materialized; every other base
-- item (types and the remaining statuses) stays lazily materialized on first
-- write, per requirement 7. Literal values here must stay in sync by hand
-- with lib/vocabulary/base-items.ts (WRITING_STATUS_BASE), which SQL cannot
-- import.

insert into public.vocabulary_items
  (user_id, kind, key, name, description, icon, color, hidden, is_base, is_required, position)
select
  p.id,
  'status',
  disabled.key,
  case disabled.key
    when 'new' then 'New'
    when 'exploring' then 'Exploring'
    when 'draft' then 'Draft'
    when 'in_review' then 'In Review'
    when 'done' then 'Done'
    when 'archived' then 'Archived'
    when 'canceled' then 'Canceled'
  end,
  case disabled.key
    when 'new' then 'It exists but nobody has worked on it yet.'
    when 'exploring' then 'Trying ideas out: it can still change shape completely.'
    when 'draft' then 'It has a shape and can be read end to end.'
    when 'in_review' then 'Waiting on other eyes before closing it.'
    when 'done' then 'Finished. Touched again only if the context changes.'
    when 'archived' then 'Out of circulation, but kept.'
    when 'canceled' then ''
  end,
  case disabled.key
    when 'new' then 'circle-dot'
    when 'exploring' then 'circle-dashed'
    when 'draft' then 'circle-dashed'
    when 'in_review' then 'eye'
    when 'done' then 'circle-check'
    when 'archived' then 'archive'
    when 'canceled' then 'circle-x'
  end,
  case disabled.key
    when 'new' then '#8E837B'
    when 'exploring' then '#5B5BD6'
    when 'draft' then '#C07B2A'
    when 'in_review' then '#96532C'
    when 'done' then '#2E7D4F'
    when 'archived' then '#1E1915'
    when 'canceled' then '#8E837B'
  end,
  true,
  true,
  (disabled.key = 'draft'),
  case disabled.key
    when 'new' then 0
    when 'exploring' then 1
    when 'draft' then 2
    when 'in_review' then 3
    when 'done' then 4
    when 'archived' then 5
    when 'canceled' then 6
  end
from public.profiles p
cross join lateral jsonb_array_elements_text(coalesce(p.disabled_statuses, '[]'::jsonb)) as disabled(key)
where p.disabled_statuses is not null
  and jsonb_array_length(p.disabled_statuses) > 0
  and disabled.key <> 'draft'
on conflict (user_id, kind, key) do nothing;

comment on column public.profiles.disabled_statuses is
  'Deprecated by ODE-472 in favor of vocabulary_items.hidden — kept for rollback safety, seeded once into vocabulary_items.';

commit;

-- rollback:
-- begin;
-- delete from public.vocabulary_items where is_base = true and hidden = true;
-- comment on column public.profiles.disabled_statuses is
--   'JSON array of writing status values the user has disabled from pickers and filters';
-- commit;
