-- ONE-OFF DATA SEED — NOT a schema migration (no table/column/function
-- change here). Run this manually in Supabase Studio's SQL editor, AFTER
-- applying supabase/migrations/20261006_leadership_report_word_template_shape.sql,
-- to attach the supplied "WFG_Weekly_Leadership_Update 10 02 26.docx" as
-- the Leadership Report for Week Ending October 2, 2026, so the Leader
-- doesn't have to retype it.
--
-- Content is verbatim from the supplied .docx (extracted directly from
-- its own XML paragraphs, not retyped from memory or summarized) in the
-- new LeadershipReportContent shape (see
-- src/lib/leadershipReportContent.ts).
--
-- owner_id is Andria Grace's own profile — the authenticated account that
-- will actually open/view/edit this in the running app (leadership_report_
-- drafts is a private, owner-scoped table: RLS only ever lets an owner see
-- their own rows). `content.leader` ("Gene Rebadow") is plain report DATA,
-- independent of which account owns this row — exactly like
-- AtsReportView's own optional leaderName prop already treats "leader" as
-- display data, never an account binding. Gene Rebadow does have his own
-- real, separately-authorized profile (grebadow@wfgtitle.com) if this
-- should instead live under his own account — see the note at the bottom
-- of this file for how to redo it that way.
--
-- source_analysis_id / source_ats_fingerprint reference the REAL, already-
-- persisted Oct 2 2026 executive_analyses row (period_key='weekly',
-- period_start_date=2026-09-28) — fingerprint computed the same way
-- computeAtsContentFingerprint() does (SHA-256 hex of
-- JSON.stringify(sections)), read directly from that row rather than
-- invented.
--
-- Idempotent: safe to re-run — ON CONFLICT (owner_id, period_start_date)
-- updates in place rather than creating a duplicate row, matching
-- save_leadership_report_draft's own upsert behavior exactly.
INSERT INTO public.leadership_report_drafts (
  owner_id,
  period_start_date,
  period_end_date,
  period_label,
  source_analysis_id,
  source_ats_fingerprint,
  content,
  created_by,
  updated_by
)
VALUES (
  '0390e0a9-bb41-4285-8693-b06ed3dfdeda', -- Andria Grace (agrace@wfgtitle.com)
  '2026-09-28',
  '2026-10-02',
  'Week Ending Oct 2, 2026',
  'cdb326cb-a9a0-4b7f-923a-3a01470708da', -- executive_analyses: period_key='weekly', period_start_date=2026-09-28
  '8f7c4c45eef165d330c018a290dfe752a2e2a95c2989c31a27d6ae5067a45f06',
  '{
    "leader": "Gene Rebadow",
    "weekEnding": "October 02, 2026",
    "weeklyUpdateBullets": [
      "Net Premiums: September MTD net premiums exceeded prior MTD by 8%",
      "CPLs: September CPL''s increased 4% over prior MTD with 8 of 12 posted gains.",
      "Agency Commercial Expansion: Team met in the Lake Mary office to outline processes for handling commercial transactions across all of Agency. The process is 80% complete, and the team will reconvene in two weeks to finalize it. We also identified target agents to pursue.",
      "ATC Acquisition – LOI Approved: Investment Committee gave the green light to proceed with an LOI for America''s Title Corporation. Baron is finalizing the LOI to send to Dustin.",
      "Q3 Close – All 92 Agency employees were engaged in closing out the third quarter and we hit $6M in net remittances. Exceeded September budget prior years September results.",
      "Q4 Focus: Held a Zoom sales meeting with the sales reps to keep our sales reps proactively focused on the 97.5% average market share opportunity across all key states. The emphasis is on signing new agents and growing wallet share with our existing agents.",
      "ATS – . The team focused on production readiness, adoption, cloud migration, and expanding ATS capabilities. WFG Remit reached 17 active agents, though Phase 2 API delays are now the key concern. FieldMT made major progress on Azure, WFG Prompts continued clearing its final launch dependencies, and the Weekly Manager Report Portal expanded into AI-generated video reporting."
    ],
    "lookingAroundTheCornerBullets": [
      "Aligning Costs to Market Conditions: To stay ahead of current market conditions, we''re monitoring CPL, jackets pulled, and open orders in our production states to project Agency performance for Sept–Dec. Reassessing staffing levels across all regions.",
      "Weekly Rep Scorecards – Bottom 10% Focus: We post weekly sales rep activity for the whole team so everyone knows exactly where they stand against their peers, and we use these reports to identify and closely monitor the bottom 10%.",
      "Texas Production: Production errors and delays are now costing us agents and revenue. Five accounts have pulled back or left, including Acrisure Title and Destination Title, and CPLs and open orders are falling. I''ve asked Ana and Amanda for three things: a recovery plan for each account with Lauren and Jamie, a committed turn-time and quality standard with weekly reporting, and priority handling for ENV, Acrisure National Lending, and Lone Star. We meet early next week in the Lake Mary Office",
      "Production – Florida, Central, and Northeast: Production issues continue in Florida, the Central Region, and the Northeast. We are still sending quality and turn-time issues to Ana and Amanda as they come up, and I will meet with Ana next week when she returns from PTO.",
      "HubSpot Migration: The Agency Sales migration to HubSpot remains on track for completion by October 31, 2026. HubSpot has been deployed to New Jersey, Pennsylvania, Louisiana, New England, National, Central Region and the North Carolina and New York goes live next week.",
      "ATS – Outlook: ATS continues to move from development into adoption and scale. WFG Remit is gaining real agent usage, FieldMT has crossed a major Azure milestone, and WFG Prompts is clearing its final production dependencies. FAR/BAR and Survey Intelligence are being positioned for broader rollout."
    ],
    "nextWeekPrioritiesBullets": [
      "NYC Visit: Heading to New York City next Friday, October 9, for a face-to-face meeting with a large  revenue-attached underwriter  and visit top prosepcts.",
      "Commercial Expansion – Next Step: The Commercial team will continue building out the workflow process, with a goal of finalizing it by October 15",
      "Commercial Recruiting: : Interviewing two commercial candidates from a major competitor next week: a sales rep and a commercial closer.",
      "The Title Report Feature:  Agency Commercial will be the subject of our next feature article in The Title Report. The team is finalizing the article with Darcy this week.",
      "Agency Sales Rep Cost of Sales Report: Continue working with Jeff Moshier and John Wetzel to build a Cost of Sales report for every Agency sales rep, so we can pinpoint our top producers. We''ll use AI to generate the report monthly",
      "ATS –  Next Steps by Product:\nWFG Remit: Resolve the API timeline and AMS discrepancy, complete QA/UAT, and confirm outstanding workflow and API decisions.\nFieldMT: Enable cloud sign-in, build QA from code, resolve Alpha feedback, and complete the Beta User Guide.\nWFG Prompts: Clear Azure and Twilio dependencies, finalize legal review and launch content, validate integrations, and proceed with the production handoff.\nWeekly Manager Report Portal: Produce the first short motion-video proof of concept, evaluate quality, and refine the pipeline before expanding to full weekly leadership videos."
    ],
    "otherNotableItemsBullets": [
      "ATS – Key Highlight: The biggest story is adoption plus infrastructure readiness. WFG Remit reached 17 active agents, and FieldMT now runs end to end inside WFG''s own Azure environment, with only authentication remaining. ATS is also expanding beyond product development into public rollout planning and AI-powered leadership reporting, a step toward broader operational adoption.",
      "AI & Internal Process Improvement: Work closely with ATS on internal process improvements. We need to apply AI internally, with AI agents taking on decision-making and the work of roles we''ve eliminated, effectively functioning as part of our workforce.",
      "Rate Calculator Enhancements: Work on the rate calculator continues. We learned that the calculator on our website is tied to the calculator in ResWare, so our focus is on making the ResWare calculator more comprehensive, which will improve both tools at once.",
      "Accelerated Search Solution: We''re advancing a solution for accelerated searches and moving decisively to define the exact product we need",
      "New York Agent Retention: New York agents continue to name rate calculator, jacket generator, and integration issues as the main reasons they''ve stopped using WFG. Resolving these issues remains a priority for winning that business back.",
      "Leadership Update Cascade – 100% Completion: Every one of my direct reports completed the WFG Weekly Leadership Update this week and cascaded it to the entire sales teams. This keeps alignment and visibility strong across Agency. The Agency roll-up is reviewed with managers each Monday at the Morning Manager Huddle."
    ],
    "okrNotes": ""
  }'::jsonb,
  '0390e0a9-bb41-4285-8693-b06ed3dfdeda',
  '0390e0a9-bb41-4285-8693-b06ed3dfdeda'
)
ON CONFLICT (owner_id, period_start_date) DO UPDATE SET
  period_end_date        = EXCLUDED.period_end_date,
  period_label           = EXCLUDED.period_label,
  source_analysis_id     = EXCLUDED.source_analysis_id,
  source_ats_fingerprint = EXCLUDED.source_ats_fingerprint,
  content                = EXCLUDED.content,
  updated_at             = now(),
  updated_by             = EXCLUDED.updated_by;

-- To seed this under Gene Rebadow's own account instead (profile id
-- 8097c59b-f1c3-4b13-9c22-19e6c696f7b5, grebadow@wfgtitle.com — already
-- leadership_report_authorized=true): replace every occurrence of
-- '0390e0a9-bb41-4285-8693-b06ed3dfdeda' above with
-- '8097c59b-f1c3-4b13-9c22-19e6c696f7b5'.
