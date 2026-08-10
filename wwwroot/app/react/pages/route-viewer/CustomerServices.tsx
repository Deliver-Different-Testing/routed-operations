import { RouteViewerPlaceholder } from './RouteViewerPlaceholder';

export default function CustomerServices() {
  return (
    <RouteViewerPlaceholder
      title="Customer Services"
      buildPhase="P12 - M, event tracker (T.1 SECURITY blocked for NP)"
      summary="Customer service incident / event tracker for jobs. Operators log events with follow-up ownership (Client vs UCL), notes, reply threading, and direct-link email. Deep-link entry ?eid=. Include Closed checkbox + admin-only Follow-up radio (All / UCL / Client). SECURITY interim (T.1): endpoint short-circuits to empty for NP users pending tblBulkEvent.NpAgentId backfill decision."
      endpointsReady={[
        'GET /api/runviewer/events?runDate=&clientInternal=&includeClosed=',
        'GET /api/runviewer/events/jobs?clientId=&clientInternal=',
        'GET /api/runviewer/events/direct-link?eventId=&clientId=',
        'GET /api/runviewer/jobs/{bulkJobId} (reused for CS drill-down)',
        'GET /api/runviewer/jobs/pod-photos?bulkJobId=',
      ]}
    />
  );
}
