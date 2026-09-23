// Pure display helper — derives up to two uppercase initials from a
// person's existing full name. Never fabricates data: given an empty/blank
// name it returns an empty string rather than a placeholder. Shared by
// Header.tsx (the signed-in user) and AdminDashboard.tsx (each manager row)
// so there is exactly one implementation of this presentation-only logic.
export function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
