import { RouteViewerPlaceholder } from './RouteViewerPlaceholder';

export default function Linehaul() {
  return (
    <RouteViewerPlaceholder
      title="Linehaul"
      buildPhase="P11 - L, cross-city trunk moves"
      summary="Cross-city trunk-move (linehaul) run management. Groups jobs into named runs between fromDepot and toDepot, tracks packing / pallet counts, per-leg scanning progress (LHP -> LH1 -> LH2 -> ... -> DEL). Assign courier or route to a whole linehaul run. NZ-only Export Linehaul Report + LineHaul Manifest CSV. LinehaulRunId discriminator (2026-06-30) drives per-leg tote association."
      endpointsReady={[
        'GET /api/runviewer/runs/linehaul?runDate=&clientInternal=',
        'GET /api/runviewer/runs/linehaul/overview?runDate=',
        'GET /api/runviewer/jobs/linehaul?depotId=&name=&runDate=',
        'GET /api/runviewer/labels/linehaul-manifest (501 scaffold - P14)',
        'POST /api/runviewer/labels/linehaul-jobs (501 scaffold - P14)',
      ]}
    />
  );
}
