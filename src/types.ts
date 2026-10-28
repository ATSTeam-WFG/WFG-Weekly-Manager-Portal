export type ReportStatus = 'not_started' | 'draft' | 'submitted'

export type SubmissionSource = 'manual' | 'automatic'

export type ProfileRole = 'manager' | 'admin' | 'sales_rep'

export interface Profile {
  id: string
  fullName: string | null
  role: ProfileRole
  isActive: boolean
  // True for every Manager (backfilled) and for a dual-role admin submitter
  // — an Admin explicitly designated as also submitting their own weekly
  // report — never inferred from role alone. See
  // src/lib/adminUserManagement.ts and the submits_weekly_report column on
  // profiles/approved_employees.
  submitsWeeklyReport: boolean
}

export interface ReportSections {
  topPriorities: string
  wins: string
  challenges: string
  nextWeekPriorities: string
}

// The approved "WFG Weekly Leadership Update" format. Distinct from
// ReportSections above (not a replacement for it) — the two formats are not
// semantically equivalent field-for-field, and historical legacy reports
// must keep displaying via ReportSections exactly as they always have. See
// src/lib/reportsService.ts for how a report row is classified as one or the
// other.
export interface ManagerReportSectionsV2 {
  whatMattersNow: string[]
  lookingAroundCorner: string[]
  nextWeekPriorities: string[]
  otherNotableItems: string
  okrNotes: string
}

export type ReportContent =
  | { version: 'legacy'; sections: ReportSections }
  | { version: 'v2'; sections: ManagerReportSectionsV2 }

// Phase 1B — the Sales Rep weekly report. Stored as a single `content jsonb`
// column on `rep_reports` (see
// supabase/migrations/20261027140300_rep_reports.sql's own header: the
// field shape was deliberately left open at the schema level, finalized
// here). Five bullet-list sections reuse BulletListInput exactly like
// ManagerReportSectionsV2 above; "manager support needed" is free text, not
// a list, since it is typically a single ask/note rather than several
// discrete items.
export interface SalesRepReportSections {
  accomplishments: string[]
  salesMetrics: string[]
  pipelineUpdates: string[]
  blockers: string[]
  nextWeekPriorities: string[]
  managerSupportNeeded: string
}

export const EMPTY_SALES_REP_REPORT_SECTIONS: SalesRepReportSections = {
  accomplishments: [],
  salesMetrics: [],
  pipelineUpdates: [],
  blockers: [],
  nextWeekPriorities: [],
  managerSupportNeeded: '',
}

export type RepReportStatus = 'draft' | 'submitted'
export type RepReportReviewStatus = 'pending' | 'approved' | 'rejected'
