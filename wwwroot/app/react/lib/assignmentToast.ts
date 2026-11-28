// Cheetah R1 (2026-11-28): the toast after a courier assign says what
// actually happened, e.g. "Moved 3 jobs from 22 to 2.", and names the
// jobs left alone (completed, not found) instead of claiming
// they were assigned. Pure so it can be unit-tested; the backend fills the
// fields on BulkAssignmentResult.

export interface RejectedJob {
  jobId: number;
  jobNumber: string | null;
  reason: string;
}

export interface FailedJob {
  jobId: number;
  jobNumber: string | null;
  /** No courier after the failure: restored off the old driver, not despatched. */
  nowUnassigned: boolean;
}

export interface AssignmentOutcome {
  succeeded: number;
  failed: number;
  moved: number;
  fromCourierCodes: string[];
  targetCode: string | null;
  rejected: RejectedJob[];
  failedJobs?: FailedJob[];
}

const MAX_LISTED = 5;

const jobs = (n: number) => `${n} job${n === 1 ? '' : 's'}`;

const stripStop = (s: string) => s.replace(/\.$/, '');

const numbers = (list: { jobId: number; jobNumber: string | null }[]) =>
  list.map((j) => j.jobNumber ?? `#${j.jobId}`).join(', ');

// Restore and despatch are two calls with no transaction around them, so a
// failed despatch can leave a job on nobody's phone. Name those jobs and
// say what to do; the operator cannot see it any other way.
function failedPart(r: AssignmentOutcome): string[] {
  const listed = r.failedJobs ?? [];
  if (listed.length === 0) {
    // No per-job detail: still warn, because some may now be unassigned.
    return r.failed > 0 ? [`${jobs(r.failed)} failed and may now be unassigned. Check and assign again`] : [];
  }
  const parts: string[] = [];
  const unassigned = listed.filter((j) => j.nowUnassigned);
  const kept = listed.filter((j) => !j.nowUnassigned);
  if (unassigned.length > 0) {
    const one = unassigned.length === 1;
    parts.push(`${numbers(unassigned)} failed and ${one ? 'is' : 'are'} now unassigned. Assign ${one ? 'it' : 'them'} again`);
  }
  if (kept.length > 0) parts.push(`${numbers(kept)} failed`);
  return parts;
}

/** One-line summary of an assign outcome. */
export function formatAssignmentToast(r: AssignmentOutcome): string {
  const to = r.targetCode ?? 'the driver';
  const parts: string[] = [];
  if (r.moved > 0) {
    const from = r.fromCourierCodes.length > 0 ? ` from ${r.fromCourierCodes.join(', ')}` : '';
    parts.push(`Moved ${jobs(r.moved)}${from} to ${to}`);
  }
  const others = r.succeeded - r.moved;
  if (others > 0) parts.push(`Assigned ${jobs(others)} to ${to}`);
  parts.push(...failedPart(r));
  if (r.rejected.length > 0) {
    const listed = r.rejected.slice(0, MAX_LISTED)
      .map((j) => `${j.jobNumber ?? `#${j.jobId}`} (${stripStop(j.reason)})`)
      .join(', ');
    const more = r.rejected.length > MAX_LISTED ? ` and ${r.rejected.length - MAX_LISTED} more` : '';
    parts.push(`Skipped ${jobs(r.rejected.length)}: ${listed}${more}`);
  }
  if (parts.length === 0) return 'No jobs were changed.';
  return `${parts.join('. ')}.`;
}

/** Run Pre-assign / Re-assign / drag. A route run (id < 0) comes back with
 *  per-job counts from RVW_stpTransferRun; a normal run comes back "ok",
 *  so it keeps its old text. */
export function formatRunAssignToast(res: AssignmentOutcome | string | null | undefined, fallback: string): string {
  return res && typeof res === 'object' ? formatAssignmentToast(res) : fallback;
}
