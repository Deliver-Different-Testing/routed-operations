import type { BulkJob } from '../types';

/**
 * Expands a set of selected job ids to include multibox siblings.
 * Direct port of legacy $scope.expandMultiboxSiblings (homeControl.js:1412-1429).
 *
 * Rule: if a selected job carries a MultiboxParentID, include every other
 * child job with the same MultiboxParentID. The parent EH/HD job itself is
 * NOT included - it's already filtered out of the visible jobs list and
 * doesn't belong on a Run Builder record. Legacy behaviour, matched exactly.
 *
 * ParentId (the EH/HD parent link, e.g. KDW-A01DEL -> KDW-A01) is deliberately
 * ignored: that relationship is resolved server-side by
 * UTL_stpJob_InsertFromRunBuilder at dispatch time, not by the operator when
 * building the run.
 */
export function expandMultiboxSiblings(jobIds: number[], allJobs: BulkJob[]): number[] {
  const result = new Set<number>(jobIds);
  const jobById = new Map<number, BulkJob>();
  allJobs.forEach((j) => jobById.set(j.bulkJobId, j));

  for (const id of jobIds) {
    const job = jobById.get(id);
    if (!job || job.multiboxParentId == null) continue;
    for (const other of allJobs) {
      if (other.multiboxParentId === job.multiboxParentId) {
        result.add(other.bulkJobId);
      }
    }
  }
  return Array.from(result);
}
