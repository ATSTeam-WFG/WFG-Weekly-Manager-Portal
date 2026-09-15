export type ReportStatus = 'not_started' | 'draft' | 'submitted'

export type SubmissionSource = 'manual' | 'automatic'

export type ProfileRole = 'manager' | 'admin'

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
