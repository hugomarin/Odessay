-- Migration: reinforce shared margins for preview and shared readers
-- Issue: ODE-97

-- 1. Add composite index for efficient lookup of shared margins by writing
CREATE INDEX IF NOT EXISTS idx_margins_writing_id_shared ON public.margins(writing_id, shared);

-- 2. Update RLS select policy so shared margins are visible to:
--    - the margin owner (reader_id)
--    - the writing author
--    - users with an active writing_share for the writing
--    - any authenticated user when the writing is public
DROP POLICY IF EXISTS margins_select_owner_or_shared_with_author ON public.margins;
CREATE POLICY margins_select_owner_or_shared_with_author
ON public.margins
FOR SELECT
USING (
  reader_id = auth.uid()
  OR (
    shared = true
    AND EXISTS (
      SELECT 1
      FROM public.writings w
      WHERE w.id = writing_id
        AND w.deleted_at IS NULL
        AND (
          w.author_id = auth.uid()
          OR (
            w.visibility = 'shared'
            AND EXISTS (
              SELECT 1
              FROM public.writing_shares ws
              WHERE ws.writing_id = w.id
                AND ws.shared_with_id = auth.uid()
            )
          )
          OR w.visibility = 'public'
        )
    )
  )
);

-- Rollback:
-- DROP INDEX IF EXISTS idx_margins_writing_id_shared;
-- DROP POLICY IF EXISTS margins_select_owner_or_shared_with_author ON public.margins;
-- CREATE POLICY margins_select_owner_or_shared_with_author
-- ON public.margins
-- FOR SELECT
-- USING (
--   reader_id = auth.uid()
--   OR (
--     shared = true
--     AND EXISTS (
--       SELECT 1
--       FROM public.writings w
--       WHERE w.id = writing_id
--         AND w.author_id = auth.uid()
--     )
--   )
-- );
