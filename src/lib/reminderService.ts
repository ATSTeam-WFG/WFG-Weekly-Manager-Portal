import type { ManagerSummary } from './adminService.js'
import type { ReportingWeek } from '../utils/week.js'

export type ReminderTargetStatus = 'draft' | 'not_started'

export interface ReminderTarget {
  id: string
  fullName: string
  email: string | null
  status: ReminderTargetStatus
}

// Reminder recipients are Draft + Not Started only — a manager who has
// already submitted never receives a reminder.
export function getReminderTargets(managers: ManagerSummary[]): ReminderTarget[] {
  return managers
    .filter(
      (m): m is ManagerSummary & { status: ReminderTargetStatus } =>
        m.status === 'draft' || m.status === 'not_started',
    )
    .map((m) => ({ id: m.id, fullName: m.fullName, email: m.email, status: m.status }))
}

export interface ReminderEmailContent {
  subject: string
  body: string
}

// Draft and Not Started deliberately get different copy: only a saved Draft
// is auto-submitted at the 3:00 PM Eastern Time (ET) deadline, so only Draft
// managers are told that will happen. A manager who hasn't started must
// never be told their (nonexistent) report will be auto-submitted.
export function buildFridayReminderEmail(target: ReminderTarget, week: ReportingWeek): ReminderEmailContent {
  const firstName = target.fullName.split(' ')[0] || target.fullName
  const subject = 'Reminder: Your Weekly Manager Report is due today at 3:00 PM ET'

  const statusParagraph =
    target.status === 'draft'
      ? `You have a draft saved for the week of ${week.label}, but it hasn't been submitted yet. If it's still not submitted by 3:00 PM ET today, it will be automatically submitted for you using what you've saved so far — you'll still be able to edit it until 3:30 PM ET.`
      : `Your Weekly Manager Report for the week of ${week.label} hasn't been started yet. Reports that haven't been started are not automatically submitted, so please start and submit yours manually before the deadline.`

  const body = [
    `Hi ${firstName},`,
    '',
    'This is a reminder that your Weekly Manager Report is still pending.',
    '',
    statusParagraph,
    '',
    `Deadline: ${week.deadlineLabel}.`,
    '',
    'Thank you!',
  ].join('\n')

  return { subject, body }
}
