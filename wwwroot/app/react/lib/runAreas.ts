import type { BulkJob, Run } from '../types';

/**
 * Distinct area label for a run - comma-separated postcodes, falling back to
 * suburbs when postcode is missing. Direct port of legacy $scope.runAreas.
 *
 * Truncates at 4 distinct areas to keep the column narrow; adds an ellipsis
 * marker when clipped.
 */
export function runAreas(run: Run, allJobs: BulkJob[]): string {
  const jobById = new Map<number, BulkJob>();
  allJobs.forEach((j) => jobById.set(j.bulkJobId, j));

  const distinct = new Set<string>();
  for (const rj of run.jobs) {
    const j = jobById.get(rj.bulkJobId);
    if (!j) continue;
    const label = j.toPostCode != null && j.toPostCode !== 0
      ? String(j.toPostCode)
      : (j.toSuburb ?? '').trim();
    if (label) distinct.add(label);
  }

  const items = Array.from(distinct);
  if (items.length === 0) return '';
  if (items.length <= 4) return items.join(', ');
  return items.slice(0, 4).join(', ') + `...+${items.length - 4}`;
}
