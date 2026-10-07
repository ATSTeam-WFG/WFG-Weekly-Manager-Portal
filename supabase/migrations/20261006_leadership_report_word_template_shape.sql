-- Leadership Report — Word-template rebuild. Replaces the content
-- validator only: no table/column changes, no RLS changes, no change to
-- save_leadership_report_draft's signature or its caller-facing contract
-- (FORBIDDEN/INVALID_SECTIONS/INVALID_REQUEST error codes are unchanged).
-- `content` has always been a schema-flexible jsonb column — this
-- validator is the only place the old AtsReport shape
-- (openingParagraph/topics) was enforced, and it is replaced wholesale
-- with the new WFG Weekly Leadership Update shape so future saves use the
-- document's own field structure instead.
--
-- HISTORICAL ROWS ARE UNTOUCHED: this function only runs inside
-- save_leadership_report_draft at WRITE time (it is not a table CHECK
-- constraint), so existing rows saved under the old shape are not
-- re-validated, modified, or migrated by this file — they simply can no
-- longer be re-saved as-is through the RPC. The application's read paths
-- (LeadershipReportCurrent.tsx, LeadershipReportHistory.tsx,
-- VideoCreationSource.tsx) all runtime-check the shape of what they read
-- and render a safe fallback for a legacy-shaped row rather than assuming
-- the new shape.
--
-- New shape, exactly matching src/lib/leadershipReportContent.ts's
-- LeadershipReportContent interface:
--   { leader: string, weekEnding: string,
--     weeklyUpdateBullets: string[], lookingAroundTheCornerBullets: string[],
--     nextWeekPrioritiesBullets: string[], otherNotableItemsBullets: string[],
--     okrNotes: string }
-- Every bullet array may be EMPTY (a blank template, or a section with
-- nothing to report that week) — unlike the old validator's AtsTopicSection
-- bullets (1-5 required), so this uses COALESCE(..., true) around each
-- bool_and over a jsonb_array_elements set, since bool_and over zero rows
-- returns NULL (which would otherwise make an empty array fail validation).
CREATE OR REPLACE FUNCTION public.is_valid_leadership_report_content(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    p ?& array[
      'leader', 'weekEnding',
      'weeklyUpdateBullets', 'lookingAroundTheCornerBullets',
      'nextWeekPrioritiesBullets', 'otherNotableItemsBullets',
      'okrNotes'
    ]
    AND (SELECT count(*) FROM jsonb_object_keys(p)) = 7
    AND jsonb_typeof(p -> 'leader') = 'string'
    AND jsonb_typeof(p -> 'weekEnding') = 'string'
    AND jsonb_typeof(p -> 'okrNotes') = 'string'
    AND jsonb_typeof(p -> 'weeklyUpdateBullets') = 'array'
    AND jsonb_typeof(p -> 'lookingAroundTheCornerBullets') = 'array'
    AND jsonb_typeof(p -> 'nextWeekPrioritiesBullets') = 'array'
    AND jsonb_typeof(p -> 'otherNotableItemsBullets') = 'array'
    AND COALESCE(
      (SELECT bool_and(jsonb_typeof(b) = 'string') FROM jsonb_array_elements(p -> 'weeklyUpdateBullets') AS b),
      true
    )
    AND COALESCE(
      (SELECT bool_and(jsonb_typeof(b) = 'string') FROM jsonb_array_elements(p -> 'lookingAroundTheCornerBullets') AS b),
      true
    )
    AND COALESCE(
      (SELECT bool_and(jsonb_typeof(b) = 'string') FROM jsonb_array_elements(p -> 'nextWeekPrioritiesBullets') AS b),
      true
    )
    AND COALESCE(
      (SELECT bool_and(jsonb_typeof(b) = 'string') FROM jsonb_array_elements(p -> 'otherNotableItemsBullets') AS b),
      true
    );
$$;
