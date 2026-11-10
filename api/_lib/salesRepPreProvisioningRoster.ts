// The exact approved roster-to-manager mapping, verified read-only against
// PREVIEW's real approved_employees/rep_manager_assignments/profiles tables
// (not retyped from memory, not reconstructed by hand) — scoped to exactly
// the 29 conflict-free Sales Reps approved for tonight's pre-provisioning.
// Deliberately excludes: Gene Rebadow's 3 reps (Holly Helfrich, Honora
// Ferris, Jackie Medeiros — pending a separate role/assignment decision),
// Austin Rozier (existing production role conflict, held), and anyone
// already resolved via Joey Grampa's situation (not a Sales Rep at all).
export interface PreProvisioningRosterEntry {
  repEmail: string
  repFullName: string
  managerEmail: string
}

export const APPROVED_PRE_PROVISIONING_ROSTER: readonly PreProvisioningRosterEntry[] = [
  { repEmail: 'kcampbell@wfgtitle.com', repFullName: 'Kristy Campbell', managerEmail: 'chansen@wfgtitle.com' },
  { repEmail: 'amahana@wfgtitle.com', repFullName: 'Aaron Mahana', managerEmail: 'chansen@wfgtitle.com' },
  { repEmail: 'dhoffman@wfgtitle.com', repFullName: 'David Hoffman', managerEmail: 'chansen@wfgtitle.com' },
  { repEmail: 'dsommer@wfgtitle.com', repFullName: 'Devon Sommer', managerEmail: 'chansen@wfgtitle.com' },
  { repEmail: 'gszafranski@wfgtitle.com', repFullName: 'Gary Szafranski', managerEmail: 'chansen@wfgtitle.com' },
  { repEmail: 'ldonnelly@wfgtitle.com', repFullName: 'Lois Donnelly', managerEmail: 'chansen@wfgtitle.com' },
  { repEmail: 'pmalone@wfgtitle.com', repFullName: 'Patrick Malone', managerEmail: 'chansen@wfgtitle.com' },
  { repEmail: 'theresakanemackenzie@wfgtitle.com', repFullName: 'Theresa Kane-Mackenzie', managerEmail: 'chansen@wfgtitle.com' },
  { repEmail: 'bkeene@wfgtitle.com', repFullName: 'Bradley Keene', managerEmail: 'rutecht@wfgtitle.com' },
  { repEmail: 'jpell@wfgtitle.com', repFullName: 'John Pellecchia', managerEmail: 'rutecht@wfgtitle.com' },
  { repEmail: 'ndiaz@wfgtitle.com', repFullName: 'Natalie Diaz', managerEmail: 'rutecht@wfgtitle.com' },
  { repEmail: 'smarch@wfgtitle.com', repFullName: 'Sundi March', managerEmail: 'rutecht@wfgtitle.com' },
  { repEmail: 'dslomins@wfgtitle.com', repFullName: 'Donna Slomins', managerEmail: 'rutecht@wfgtitle.com' },
  { repEmail: 'eperez@wfgtitle.com', repFullName: 'Elissa Perez', managerEmail: 'cwilliams@wfgtitle.com' },
  { repEmail: 'erebadow@wfgtitle.com', repFullName: 'Evan Rebadow', managerEmail: 'cwilliams@wfgtitle.com' },
  { repEmail: 'ibartlett@wfgtitle.com', repFullName: 'Ian Bartlett', managerEmail: 'cwilliams@wfgtitle.com' },
  { repEmail: 'jgiles@wfgtitle.com', repFullName: 'Jennifer Giles', managerEmail: 'cwilliams@wfgtitle.com' },
  { repEmail: 'lciambriello@wfgtitle.com', repFullName: 'Lori Ciambriello', managerEmail: 'cwilliams@wfgtitle.com' },
  { repEmail: 'drodriguez2@wfgtitle.com', repFullName: 'Danny Rodriguez', managerEmail: 'tarcarese@wfgtitle.com' },
  { repEmail: 'lfox@wfgtitle.com', repFullName: 'Liz Fox', managerEmail: 'tarcarese@wfgtitle.com' },
  { repEmail: 'tpolito@wfgtitle.com', repFullName: 'Tony Polito', managerEmail: 'tarcarese@wfgtitle.com' },
  { repEmail: 'djohnson2@wfgtitle.com', repFullName: 'Danielle Johnson', managerEmail: 'drebadow@wfgtitle.com' },
  { repEmail: 'ldunlap@wfgtitle.com', repFullName: 'Liz Dunlap', managerEmail: 'drebadow@wfgtitle.com' },
  { repEmail: 'scoppage@wfgtitle.com', repFullName: 'Stephanie Coppage', managerEmail: 'drebadow@wfgtitle.com' },
  { repEmail: 'jtomlinson@wfgtitle.com', repFullName: 'Julie Tomlinson', managerEmail: 'dsilverstein@wfgtitle.com' },
  { repEmail: 'sthibodeaux@wfgtitle.com', repFullName: 'Sadie Thibodeaux', managerEmail: 'dsilverstein@wfgtitle.com' },
  { repEmail: 'jbarker@wfgtitle.com', repFullName: 'Jamie Barker', managerEmail: 'lmccaskill@wfgtitle.com' },
  { repEmail: 'tholmes@wfgtitle.com', repFullName: 'Tori Holmes', managerEmail: 'lmccaskill@wfgtitle.com' },
  { repEmail: 'srunnels@wfgtitle.com', repFullName: 'Stephanie Runnels', managerEmail: 'cyarborough@wfgtitle.com' },
]
