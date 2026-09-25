// Route Viewer direction filter (Inbound / Outbound / Combined).
//
// Extracted 2026-09-18 from RunViewer.tsx after George's Medical-Prod
// report that "Assign Route" was dispatching both inbound AND outbound
// jobs regardless of the view the operator was on. The RunViewer's
// display filter was correct; the Assign Route flow was fetching with a
// hardcoded group='Combined'. Adopting the legacy Run Viewer pattern
// (RunViwer_Claude/wwwroot/app/components/dialogs/assign-route-dialog/
// assignRouteDialogController.js) - the caller pre-filters the jobIds
// and the dialog just uses what it is given. This helper is the shared
// filter predicate every caller uses so the display list and the
// assign scope always agree.
//
// Predicate rules (per RunViewer.tsx and the legacy homeControl.js
// viewMode filter behaviour):
//   Combined - every job passes
//   Inbound  - jobs whose jobNumber ends with the "LHP" suffix
//              (Linehaul Pickup rows, always the inbound leg)
//   Outbound - non-LHP rows that carry a delivery destination. Rows
//              that only have pickup coordinates are pickup-only (a
//              leg feeding the linehaul) and belong on Inbound instead.

export type ViewMode = 'Combined' | 'Inbound' | 'Outbound';

/** Minimal shape needed for the direction filter. Any object with the
 *  standard BulkJob field names satisfies it, so callers can pass raw
 *  BulkJob rows without mapping. */
export interface ViewModeJobShape {
  jobNumber?: string | null;
  pickUpLatitude?: number | string | null;
  pickUpLongitude?: number | string | null;
  deliveryLatitude?: number | string | null;
  deliveryLongitude?: number | string | null;
  toLat?: number | null;
  toLng?: number | null;
}

export function matchesViewMode(job: ViewModeJobShape, viewMode: ViewMode): boolean {
  if (viewMode === 'Combined') return true;
  const jn = (job.jobNumber ?? '').trim().toUpperCase();
  const isLhp = jn.endsWith('LHP');
  if (viewMode === 'Inbound') return isLhp;
  // Outbound: drop LHP rows + pickup-only rows (they belong on Inbound).
  if (isLhp) return false;
  const hasFrom = job.pickUpLatitude != null && job.pickUpLongitude != null;
  const hasTo = (job.deliveryLatitude != null && job.deliveryLongitude != null)
    || (job.toLat != null && job.toLng != null);
  const kind = hasFrom && hasTo ? 'both' : hasFrom ? 'pickup' : hasTo ? 'delivery' : 'none';
  return kind !== 'pickup';
}
