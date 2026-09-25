import type { BulkJob, Run } from '../types';
import type { ListSort } from '../components/cockpit/CockpitState';

/**
 * Column-click sort helpers for the Jobs and Runs lists. Legacy analogue:
 * $scope.orderList(list, prop) in homeControl.js. Toggling the same column
 * flips the direction; clicking a different column starts at ascending.
 */

export function nextSortDirection(current: ListSort | null, field: string): ListSort | null {
  if (!current || current.field !== field) return { field, direction: 'asc' };
  if (current.direction === 'asc') return { field, direction: 'desc' };
  return null;
}

export function sortIndicator(sort: ListSort | null, field: string): string {
  if (!sort || sort.field !== field) return '';
  return sort.direction === 'asc' ? ' ▲' : ' ▼';
}

export function sortJobs(jobs: BulkJob[], sort: ListSort | null): BulkJob[] {
  if (!sort) return jobs;
  const mult = sort.direction === 'asc' ? 1 : -1;
  const getter = jobFieldGetter(sort.field);
  return [...jobs].sort((a, b) => compareValues(getter(a), getter(b)) * mult);
}

export function sortRuns(runs: Run[], sort: ListSort | null): Run[] {
  if (!sort) return runs;
  const mult = sort.direction === 'asc' ? 1 : -1;
  const getter = runFieldGetter(sort.field);
  return [...runs].sort((a, b) => compareValues(getter(a), getter(b)) * mult);
}

function jobFieldGetter(field: string): (j: BulkJob) => unknown {
  switch (field) {
    case 'clientCode': return (j) => j.clientCode ?? '';
    case 'jobNumber': return (j) => j.jobNumber ?? '';
    case 'toSuburb': return (j) => j.toSuburb ?? '';
    case 'toPostCode': return (j) => j.toPostCode ?? 0;
    case 'bookTime': return (j) => (j.bookTime ? new Date(j.bookTime).getTime() : 0);
    case 'speedName': return (j) => j.speedName ?? j.speed;
    case 'runName': return (j) => j.runName ?? '';
    default: return () => 0;
  }
}

function runFieldGetter(field: string): (r: Run) => unknown {
  switch (field) {
    case 'name': return (r) => r.name ?? '';
    case 'jobs': return (r) => r.jobs.length;
    case 'mins': return (r) => r.mins ?? 0;
    case 'kms': return (r) => r.kms ?? 0;
    case 'courierPercentage': return (r) => r.courierPercentage ?? 0;
    case 'courierName': return (r) => r.courierName ?? '';
    case 'status': return (r) => r.status ?? 0;
    default: return () => 0;
  }
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}
