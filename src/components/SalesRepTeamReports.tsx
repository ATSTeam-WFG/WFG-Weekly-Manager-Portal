import { useEffect, useState } from 'react'
import { fetchMyCurrentManagerAssignment, fetchMyTeammateAssignments, fetchRepReport, type RepReport } from '../lib/repReportsService'
import { fetchProfilesByIds, type RepProfileSummary } from '../lib/repRosterService'
import { getInitials } from '../utils/initials'
import { ReadOnlyReportSummary } from './SalesRepDashboard'
import './SalesRepTeamReports.css'

interface SalesRepTeamReportsProps {
  repId: string
  weekStartDate: string
  weekLabel: string
}

type LoadState = 'loading' | 'error' | 'ready'

interface TeammateRow {
  profile: RepProfileSummary
  report: RepReport | null // null = nothing SUBMITTED yet this week (never distinguishes draft vs not-started to a peer)
}

// Reporting hierarchy & access phase (2026-11-24) — Sales Rep "Team
// Reports": a rep's teammates (other reps sharing their own CURRENT
// manager) and each teammate's SUBMITTED-only report for the selected
// week. Every row of data here comes from functions already scoped by the
// new rep_manager_assignments_select_teammate / profiles_select_teammate /
// rep_reports_select_teammate RLS policies — this component never adds
// its own filtering for "submitted only" or "same manager only"; if those
// policies were ever missing, this would simply show nothing; it could
// never show more than it should.
export default function SalesRepTeamReports({ repId, weekStartDate, weekLabel }: SalesRepTeamReportsProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [rows, setRows] = useState<TeammateRow[]>([])
  const [selected, setSelected] = useState<TeammateRow | null>(null)

  useEffect(() => {
    let active = true
    setLoadState('loading')
    setSelected(null)

    async function load() {
      const myAssignment = await fetchMyCurrentManagerAssignment(repId)
      if (!active) return
      if (!myAssignment) {
        setRows([])
        setLoadState('ready')
        return
      }

      const teammateAssignments = await fetchMyTeammateAssignments(myAssignment.managerId, repId)
      if (!active) return
      if (teammateAssignments.length === 0) {
        setRows([])
        setLoadState('ready')
        return
      }

      const teammateIds = teammateAssignments.map((a) => a.repId)
      const profiles = await fetchProfilesByIds(teammateIds)
      const profileById = new Map(profiles.map((p) => [p.id, p]))

      const reports = await Promise.all(teammateIds.map((id) => fetchRepReport(id, weekStartDate)))
      if (!active) return

      const nextRows: TeammateRow[] = teammateAssignments
        .map((a, i) => {
          const profile = profileById.get(a.repId)
          if (!profile) return null
          return { profile, report: reports[i] }
        })
        .filter((r): r is TeammateRow => r !== null)

      setRows(nextRows)
      setLoadState('ready')
    }

    load().catch(() => {
      if (active) setLoadState('error')
    })

    return () => {
      active = false
    }
  }, [repId, weekStartDate])

  if (selected) {
    const name = selected.profile.fullName ?? 'Unnamed teammate'
    return (
      <div className="srtr-card">
        <button type="button" className="link-btn back-link" onClick={() => setSelected(null)}>
          ← Back to Team Reports
        </button>
        <h2>{name}&apos;s Report</h2>
        <p className="srtr-subtitle">Week of {weekLabel} · read-only</p>
        {selected.report ? (
          <ReadOnlyReportSummary content={selected.report.content} />
        ) : (
          <p className="srtr-empty">Not submitted yet.</p>
        )}
      </div>
    )
  }

  return (
    <div className="srtr-card">
      <h2>Team Reports</h2>
      <p className="srtr-subtitle">Week of {weekLabel} · your teammates&apos; completed reports, read-only</p>

      {loadState === 'loading' && <p className="srtr-loading">Loading…</p>}
      {loadState === 'error' && <p className="srtr-empty">Could not load your team&apos;s reports. Please try again.</p>}
      {loadState === 'ready' && rows.length === 0 && <p className="srtr-empty">No teammates to show yet.</p>}

      {loadState === 'ready' && rows.length > 0 && (
        <ul className="srtr-list">
          {rows.map((row) => {
            const name = row.profile.fullName ?? 'Unnamed teammate'
            const submitted = row.report !== null
            return (
              <li key={row.profile.id} className="srtr-row">
                <span className="srtr-person">
                  <span className="srtr-avatar" aria-hidden="true">
                    {getInitials(name)}
                  </span>
                  <span className="srtr-person-info">
                    <span className="srtr-person-name">{name}</span>
                    <span className="srtr-person-email">{row.profile.email}</span>
                  </span>
                </span>
                <span className={`srtr-status-badge ${submitted ? 'srtr-status-submitted' : 'srtr-status-pending'}`}>
                  {submitted ? 'Submitted' : 'Not yet submitted'}
                </span>
                {submitted && (
                  <button type="button" className="btn btn-secondary srtr-view-btn" onClick={() => setSelected(row)}>
                    View
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
