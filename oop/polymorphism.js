// PILLAR 4: POLYMORPHISM
// These are real call sites, not duplicate or pretend classes.
// The runtime object determines which overridden implementation is executed.

// Student and Librarian override getDashboardPath().
// LoginService.openDashboard(account) calls this dispatcher.
export function dashboardPath(account) {
  return account.getDashboardPath();
}

// Book, StudentProfile, AdminBook and AdminProfile override getSummary().
// Both dashboards use this dispatcher in recordHeading(record).
export function recordSummary(record) {
  return record.getSummary();
}
