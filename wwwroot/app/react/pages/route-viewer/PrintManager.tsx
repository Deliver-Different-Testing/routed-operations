import { RouteViewerPlaceholder } from './RouteViewerPlaceholder';

export default function PrintManager() {
  return (
    <RouteViewerPlaceholder
      title="Print Manager"
      buildPhase="P9 - L, bulk labels + item edit"
      summary="Bulk label print centre + per-job detail editor with 13-column grid (Client / Job# / D Date / R Time / Speed / Qty / RefA / RefB / OurRef / Mobile / Email / To / Notes). Sort mode drives labelsSortMode 1-4. Multibox chevron expand, item-count edit -> WS_stpBulkJob_Update cascade (Amount recalc + item barcode regeneration). Scoped GPS-form Select2 suburb picker with addressLine1..8 payload."
      endpointsReady={[
        'GET /api/runviewer/jobs/print-list?runDate=&clientInternal=',
        'GET /api/runviewer/jobs/print-children?runDate=&bulkJobId=',
        'GET /api/runviewer/jobs/items?bulkJobId=&runDate=',
        'GET /api/runviewer/labels/bulk?bulkJobId= (501 scaffold - P14 AlertLabel package)',
        'POST /api/runviewer/labels/bulk-jobs-by-speed (501 scaffold - P14)',
      ]}
    />
  );
}
