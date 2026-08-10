import { RouteViewerPlaceholder } from './RouteViewerPlaceholder';

export default function ScanManager() {
  return (
    <RouteViewerPlaceholder
      title="Scan Manager"
      buildPhase="P10 - L, Bulk + Routed modes"
      summary="Depot / leg scan-tracking dashboard with two swappable modes: Bulk (parent-child-item tree with 6 tri-state icon columns - Sort/Run/Pickup/InvalidPickup/Transfer/InTransit) and Routed (shipment rows with X-of-Y reconciliation, leg progress chip strip, tote list, exception count). Includes Remove Missing Boxes admin bulk action."
      endpointsReady={[
        'GET /api/runviewer/scans?runDate=&clientInternal= (Bulk mode)',
        'GET /api/runviewer/scans/routed?runDate=',
        'GET /api/runviewer/scans/detail?runDate=&scan=&rootJobId=',
        'GET /api/runviewer/scans/item-progress?rootJobId=',
        'GET /api/runviewer/scans/routed-detail?rootJobId=&runDate=',
      ]}
    />
  );
}
