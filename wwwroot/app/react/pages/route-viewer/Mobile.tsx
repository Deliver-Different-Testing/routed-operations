import { RouteViewerPlaceholder } from './RouteViewerPlaceholder';

export default function Mobile() {
  return (
    <RouteViewerPlaceholder
      title="Mobile (driver / handheld)"
      buildPhase="P13 - L, handheld surface"
      summary="Handheld / tablet driver surface. Top-bar with logo + full-text job search + bottom nav (Overview / Filters / Runs) + slide-up popup drawer. Run drill flow: Overview -> region tile -> Runs list -> Run -> Job -> Details / Map. Editable job detail (address, phone, GPS via iframe). 25s auto-poll on driver position. Section U.3 flags hardcoded Google Maps embed API key for rotation before ship."
      endpointsReady={[
        'GET /api/runviewer/runs (reused for the mobile run list)',
        'GET /api/runviewer/runs/overview',
        'GET /api/runviewer/couriers/position?jobId= (25s poll)',
        'GET /api/runviewer/filters/{clients,regions,suburbs}',
      ]}
    />
  );
}
