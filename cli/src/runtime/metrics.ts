type ControlTrialEvidence = {
  routedAssignments: number;
  acceptedInterventions: number;
  stopControls: number;
  retryControls: number;
  redirectControls: number;
  replaceControls: number;
  integrationConflicts: number;
  permissionRenewals: number;
  verifiedIntegrations: number;
};

export function fiveWorkingDayWindowStart(now: Date): Date {
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  let workingDays = 0;
  while (workingDays < 5) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) workingDays += 1;
    if (workingDays < 5) cursor.setDate(cursor.getDate() - 1);
  }
  return cursor;
}

export function hasControlTrialEvidence(metrics: ControlTrialEvidence): boolean {
  return metrics.routedAssignments > 0
    || metrics.acceptedInterventions > 0
    || metrics.stopControls > 0
    || metrics.retryControls > 0
    || metrics.redirectControls > 0
    || metrics.replaceControls > 0
    || metrics.integrationConflicts > 0
    || metrics.permissionRenewals > 0
    || metrics.verifiedIntegrations > 0;
}
