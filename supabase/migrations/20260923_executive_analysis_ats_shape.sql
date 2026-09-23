-- Phase 3 — ATS Executive Analysis migration. Widens
-- is_valid_executive_analysis_sections(jsonb) to accept EITHER the existing
-- legacy fixed 7-key ReportingAnalysisSections shape (byte-identical logic
-- to the currently-deployed function, confirmed directly via
-- pg_get_functiondef() — not just black-box tested) OR the new dynamic ATS
-- shape (openingParagraph + topics[]).
--
-- This function is called only at WRITE time, from
-- regenerate_executive_analysis() and save_executive_analysis_edit() —
-- confirmed via direct inspection to be its only two callers — and never on
-- read. Direct inspection also confirmed neither executive_analyses nor
-- executive_analysis_versions carries a table-level CHECK constraint.
-- Replacing this one function therefore cannot invalidate, corrupt, or even
-- re-touch any existing row: it only changes what a NEW write is permitted
-- to contain. No ALTER TABLE, no data migration, no RLS change, and neither
-- RPC function's own body is touched — both continue to call this function
-- generically as a boolean gate and don't need to know which shape passed.
--
-- Legacy branch is unchanged from the live definition: an object with
-- exactly the 7 named keys, each a string (including empty strings).
--
-- ATS branch: an object with exactly `openingParagraph` (string) and
-- `topics` (a non-empty array). Each topic is an object with exactly
-- `title`, `statusSummary`, `bullets`, `next` — title/statusSummary/next
-- strings, `bullets` a non-empty array of strings with AT MOST 5 elements.
-- No minimum below 1 is enforced beyond non-empty: factual grounding takes
-- priority over a fixed bullet count, so the AI is guided (at the prompt
-- and schema level, see api/executive-summary.ts) to use 3-5 bullets when
-- the source material supports it and fewer when it doesn't — this
-- database-level gate only guards against structurally malformed data, not
-- against a topic that legitimately has only 1 or 2 supported facts.
--
-- The two shapes can never be mistaken for one another: their top-level key
-- sets are completely disjoint (legacy's 7 keys vs. ATS's 2), so there is no
-- ambiguity in this function or in the client-side shape guard
-- (isAtsShapedSections in src/lib/executiveSummaryService.ts).
--
-- This is the sole canonical migration for this change — not run yet.
-- Verification of this function's exact behavior (legacy accepted, ATS
-- accepted, malformed/mixed/empty variants rejected, bullet-count bounds)
-- lives in test code as an executable JS mirror of this same logic, not as
-- a second SQL file or an embedded self-test block — see
-- src/lib/executiveAnalysisAtsShapeWiring.test.ts.
CREATE OR REPLACE FUNCTION is_valid_executive_analysis_sections(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    -- Legacy shape: exactly these 7 keys, each a string.
    (
      p ?& array[
        'executiveSummary','keyPriorities','majorWins','challengesRisks',
        'challengeProgress','opportunities','prioritiesGoingForward'
      ]
      AND (SELECT count(*) FROM jsonb_object_keys(p)) = 7
      AND (
        SELECT bool_and(jsonb_typeof(p -> key) = 'string')
        FROM jsonb_object_keys(p) AS key
      )
    )
    OR
    -- ATS shape: exactly openingParagraph (string) + topics (non-empty
    -- array of well-shaped objects, each with 1-5 string bullets).
    (
      p ?& array['openingParagraph', 'topics']
      AND (SELECT count(*) FROM jsonb_object_keys(p)) = 2
      AND jsonb_typeof(p -> 'openingParagraph') = 'string'
      AND jsonb_typeof(p -> 'topics') = 'array'
      AND jsonb_array_length(p -> 'topics') >= 1
      AND (
        SELECT bool_and(
          jsonb_typeof(topic) = 'object'
          AND (topic ?& array['title','statusSummary','bullets','next'])
          AND (SELECT count(*) FROM jsonb_object_keys(topic)) = 4
          AND jsonb_typeof(topic -> 'title') = 'string'
          AND jsonb_typeof(topic -> 'statusSummary') = 'string'
          AND jsonb_typeof(topic -> 'next') = 'string'
          AND jsonb_typeof(topic -> 'bullets') = 'array'
          AND jsonb_array_length(topic -> 'bullets') >= 1
          AND jsonb_array_length(topic -> 'bullets') <= 5
          AND (
            SELECT bool_and(jsonb_typeof(b) = 'string')
            FROM jsonb_array_elements(topic -> 'bullets') AS b
          )
        )
        FROM jsonb_array_elements(p -> 'topics') AS topic
      )
    );
$$;
