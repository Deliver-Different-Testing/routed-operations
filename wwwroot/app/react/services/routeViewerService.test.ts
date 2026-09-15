import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { routeViewerService } from './routeViewerService';

const wrapGet = (path: string, body: unknown, capture?: (url: URL) => void) =>
  http.get(path, ({ request }) => {
    if (capture) capture(new URL(request.url));
    return HttpResponse.json({ response: body });
  });

const wrapPost = (path: string, body: unknown, capture?: (payload: unknown) => void) =>
  http.post(path, async ({ request }) => {
    if (capture) capture(await request.json());
    return HttpResponse.json({ response: body });
  });

describe('routeViewerService - filters', () => {
  it('getClients GETs /runviewer/filters/clients forwarding multipleClients + contactId', async () => {
    let seen!: URL;
    server.use(wrapGet('/api/runviewer/filters/clients', [], (u) => (seen = u)));
    await routeViewerService.getClients('2026-08-13', true, 555);
    expect(seen.searchParams.get('runDate')).toBe('2026-08-13');
    expect(seen.searchParams.get('multipleClients')).toBe('true');
    expect(seen.searchParams.get('contactId')).toBe('555');
    // clientInternal used to be sent but the SP ignores it; the DTO
    // dropped it so it must NOT appear on the wire anymore.
    expect(seen.searchParams.has('clientInternal')).toBe(false);
  });

  it('getClients omits contactId when the auth claim is null', async () => {
    let seen!: URL;
    server.use(wrapGet('/api/runviewer/filters/clients', [], (u) => (seen = u)));
    await routeViewerService.getClients('2026-08-13', false, null);
    expect(seen.searchParams.has('contactId')).toBe(false);
  });

  it('getSpeeds GETs /runviewer/filters/speeds', async () => {
    let seen!: URL;
    server.use(wrapGet('/api/runviewer/filters/speeds', [], (u) => (seen = u)));
    await routeViewerService.getSpeeds('2026-08-13');
    expect(seen.searchParams.get('runDate')).toBe('2026-08-13');
  });

  it('getRegions GETs /runviewer/filters/regions', async () => {
    server.use(wrapGet('/api/runviewer/filters/regions', []));
    const r = await routeViewerService.getRegions('2026-08-13');
    expect(r).toEqual([]);
  });

  it('getSuburbs GETs /runviewer/filters/suburbs', async () => {
    server.use(wrapGet('/api/runviewer/filters/suburbs', [{ id: 1, label: 'AKL' }]));
    const r = await routeViewerService.getSuburbs();
    expect(r).toEqual([{ id: 1, label: 'AKL' }]);
  });

  it('getTopUpServices GETs /runviewer/filters/topup-services', async () => {
    server.use(wrapGet('/api/runviewer/filters/topup-services', []));
    await routeViewerService.getTopUpServices();
  });
});

describe('routeViewerService - runs', () => {
  it('getRuns joins numeric arrays as CSV and passes filters', async () => {
    let seen!: URL;
    server.use(wrapGet('/api/runviewer/runs', [], (u) => (seen = u)));
    await routeViewerService.getRuns({
      runDate: '2026-08-13', clientInternal: true, multipleClients: false,
      clientIds: [1, 2], regionIds: [3], speedIds: [4, 5], group: 'Combined',
    });
    expect(seen.searchParams.get('runDate')).toBe('2026-08-13');
    expect(seen.searchParams.get('clientInternal')).toBe('true');
    expect(seen.searchParams.get('multipleClients')).toBe('false');
    expect(seen.searchParams.get('clientIds')).toBe('1,2');
    expect(seen.searchParams.get('regionIds')).toBe('3');
    expect(seen.searchParams.get('speedIds')).toBe('4,5');
    expect(seen.searchParams.get('group')).toBe('Combined');
  });

  it('getRuns omits CSV params when arrays are empty', async () => {
    let seen!: URL;
    server.use(wrapGet('/api/runviewer/runs', [], (u) => (seen = u)));
    await routeViewerService.getRuns({ runDate: '2026-08-13', clientIds: [], regionIds: [] });
    expect(seen.searchParams.has('clientIds')).toBe(false);
    expect(seen.searchParams.has('regionIds')).toBe(false);
  });

  it('getRunJobs GETs /runviewer/runs/:runId/jobs', async () => {
    let seenPath: string | null = null;
    let seen!: URL;
    server.use(http.get('/api/runviewer/runs/:runId/jobs', ({ request }) => {
      seen = new URL(request.url);
      seenPath = seen.pathname;
      return HttpResponse.json({ response: [] });
    }));
    await routeViewerService.getRunJobs(7, '2026-08-13', {
      group: 'Combined',
      regionIds: [11, 22],
      speedIds: [3],
      clientIds: [999],
      courierId: 42,
    });
    expect(seenPath).toBe('/api/runviewer/runs/7/jobs');
    expect(seen.searchParams.get('runDate')).toBe('2026-08-13');
    expect(seen.searchParams.get('group')).toBe('Combined');
    expect(seen.searchParams.get('regionIds')).toBe('11,22');
    expect(seen.searchParams.get('speedIds')).toBe('3');
    expect(seen.searchParams.get('clientIds')).toBe('999');
    expect(seen.searchParams.get('courierId')).toBe('42');
  });

  it('getJobSiblings GETs /runviewer/runs/job-siblings?jobId=', async () => {
    let seen!: URL;
    server.use(wrapGet('/api/runviewer/runs/job-siblings', [], (u) => (seen = u)));
    await routeViewerService.getJobSiblings(42);
    expect(seen.searchParams.get('jobId')).toBe('42');
  });

  it('getRegionOverview GETs /runviewer/runs/overview with the filter panel state forwarded', async () => {
    let seen!: URL;
    server.use(wrapGet('/api/runviewer/runs/overview', [], (u) => (seen = u)));
    await routeViewerService.getRegionOverview('2026-08-13', {
      group: 'Combined',
      clientIds: [7],
      regionIds: [11, 22],
      speedIds: [3],
    });
    expect(seen.searchParams.get('runDate')).toBe('2026-08-13');
    expect(seen.searchParams.get('group')).toBe('Combined');
    expect(seen.searchParams.get('clientIds')).toBe('7');
    expect(seen.searchParams.get('regionIds')).toBe('11,22');
    expect(seen.searchParams.get('speedIds')).toBe('3');
  });
});

describe('routeViewerService - jobs', () => {
  it('getBulkJob GETs /runviewer/jobs/:bulkJobId', async () => {
    server.use(http.get('/api/runviewer/jobs/:bulkJobId', ({ params }) => {
      expect(params.bulkJobId).toBe('9');
      return HttpResponse.json({ response: { bulkJobId: 9 } });
    }));
    const r = await routeViewerService.getBulkJob(9);
    expect(r.bulkJobId).toBe(9);
  });

  it('searchByJobNumber GETs /runviewer/jobs/search', async () => {
    let seen!: URL;
    server.use(wrapGet('/api/runviewer/jobs/search', [], (u) => (seen = u)));
    await routeViewerService.searchByJobNumber('A1');
    expect(seen.searchParams.get('jobNumber')).toBe('A1');
  });

  it('getJobItems GETs /runviewer/jobs/items', async () => {
    let seen!: URL;
    server.use(wrapGet('/api/runviewer/jobs/items', [], (u) => (seen = u)));
    await routeViewerService.getJobItems(1);
    expect(seen.searchParams.get('bulkJobId')).toBe('1');
  });

  it('getPodPhotos GETs /runviewer/jobs/pod-photos', async () => {
    server.use(wrapGet('/api/runviewer/jobs/pod-photos', ['b64']));
    const r = await routeViewerService.getPodPhotos(1);
    expect(r).toEqual(['b64']);
  });
});

describe('routeViewerService - couriers', () => {
  it('getActiveCouriers GETs /runviewer/couriers', async () => {
    let seen!: URL;
    server.use(wrapGet('/api/runviewer/couriers', [], (u) => (seen = u)));
    await routeViewerService.getActiveCouriers('2026-08-13');
    expect(seen.searchParams.get('runDate')).toBe('2026-08-13');
  });

  it('searchCouriers GETs /runviewer/couriers/search', async () => {
    let seen!: URL;
    server.use(wrapGet('/api/runviewer/couriers/search', [], (u) => (seen = u)));
    await routeViewerService.searchCouriers('foo');
    expect(seen.searchParams.get('q')).toBe('foo');
  });

  it('searchAgents GETs /runviewer/jobs/{jobId}/assignable-targets/agents with isNetworkPartner=false', async () => {
    let seen!: URL;
    server.use(
      http.get(
        '/api/runviewer/jobs/:jobId/assignable-targets/agents',
        ({ request }) => {
          seen = new URL(request.url);
          return HttpResponse.json({ response: [] });
        },
      ),
    );
    await routeViewerService.searchAgents(42, 'north', false, 200);
    expect(seen.pathname).toBe('/api/runviewer/jobs/42/assignable-targets/agents');
    expect(seen.searchParams.get('q')).toBe('north');
    expect(seen.searchParams.get('isNetworkPartner')).toBe('false');
    expect(seen.searchParams.get('limit')).toBe('200');
  });

  it('searchAgents forwards isNetworkPartner=true for the NP bucket', async () => {
    let seen!: URL;
    server.use(
      http.get(
        '/api/runviewer/jobs/:jobId/assignable-targets/agents',
        ({ request }) => {
          seen = new URL(request.url);
          return HttpResponse.json({ response: [] });
        },
      ),
    );
    await routeViewerService.searchAgents(7, '', true, 200);
    expect(seen.searchParams.get('isNetworkPartner')).toBe('true');
  });

  it('getCourierPosition GETs /runviewer/couriers/position', async () => {
    server.use(wrapGet('/api/runviewer/couriers/position', null));
    const r = await routeViewerService.getCourierPosition(1);
    expect(r).toBeNull();
  });

  it('getAvailableCouriers GETs /runviewer/couriers/available with bounds', async () => {
    let seen: URL | null = null;
    server.use(
      http.get('/api/runviewer/couriers/available', ({ request }) => {
        seen = new URL(request.url);
        return HttpResponse.json({ response: [] });
      }),
    );
    await routeViewerService.getAvailableCouriers({
      minLng: -180, minLat: -90, maxLng: 180, maxLat: 90,
    });
    expect(seen).not.toBeNull();
    expect(seen!.searchParams.get('minLng')).toBe('-180');
    expect(seen!.searchParams.get('minLat')).toBe('-90');
    expect(seen!.searchParams.get('maxLng')).toBe('180');
    expect(seen!.searchParams.get('maxLat')).toBe('90');
  });
});

describe('routeViewerService - scans / events', () => {
  it('getScanDetail GETs /runviewer/scans/detail', async () => {
    server.use(wrapGet('/api/runviewer/scans/detail', []));
    await routeViewerService.getScanDetail(1);
  });

  it('getBulkScanJobs GETs /runviewer/scans', async () => {
    let seen!: URL;
    server.use(wrapGet('/api/runviewer/scans', [], (u) => (seen = u)));
    await routeViewerService.getBulkScanJobs('2026-08-13', true);
    expect(seen.searchParams.get('runDate')).toBe('2026-08-13');
    expect(seen.searchParams.get('clientInternal')).toBe('true');
  });

  it('getPrintJobList GETs /runviewer/jobs/print-list with filters', async () => {
    let seen!: URL;
    server.use(wrapGet('/api/runviewer/jobs/print-list', [], (u) => (seen = u)));
    await routeViewerService.getPrintJobList('2026-08-14', {
      clientInternal: true,
      clientIds: [1, 2],
      regionIds: [7],
    });
    expect(seen.searchParams.get('runDate')).toBe('2026-08-14');
    expect(seen.searchParams.get('clientInternal')).toBe('true');
    expect(seen.searchParams.get('clientIds')).toBe('1,2');
    expect(seen.searchParams.get('regionIds')).toBe('7');
  });

  it('getRoutedScanJobs GETs /runviewer/scans/routed', async () => {
    server.use(wrapGet('/api/runviewer/scans/routed', []));
    await routeViewerService.getRoutedScanJobs('2026-08-13');
  });

  it('closeEvent POSTs /runviewer/events/:eventId/close', async () => {
    let seen: unknown;
    server.use(wrapPost('/api/runviewer/events/:eventId/close', 'ok', (p) => (seen = p)));
    const r = await routeViewerService.closeEvent(1, 'kevin');
    expect(seen).toEqual({ closedBy: 'kevin' });
    expect(r).toBe('ok');
  });

  it('addEventReply POSTs /runviewer/events/:eventId/reply', async () => {
    let seen: unknown;
    server.use(wrapPost('/api/runviewer/events/:eventId/reply', 'ok', (p) => (seen = p)));
    await routeViewerService.addEventReply(1, 'hi', 'kevin');
    expect(seen).toEqual({ note: 'hi', userName: 'kevin' });
  });

  it('removeMissingScanJobs POSTs /runviewer/scans/remove-missing', async () => {
    let seen: unknown;
    server.use(wrapPost('/api/runviewer/scans/remove-missing', 'ok', (p) => (seen = p)));
    await routeViewerService.removeMissingScanJobs({ runDate: '2026-08-13' });
    expect(seen).toEqual({ runDate: '2026-08-13' });
  });

  it('getItemProgress GETs /runviewer/scans/item-progress', async () => {
    let seen!: URL;
    server.use(wrapGet('/api/runviewer/scans/item-progress', [], (u) => (seen = u)));
    await routeViewerService.getItemProgress(9);
    expect(seen.searchParams.get('rootJobId')).toBe('9');
  });

  it('getScanDetailRows GETs /runviewer/scans/detail with runDate + optional filters', async () => {
    let seen!: URL;
    server.use(wrapGet('/api/runviewer/scans/detail', [], (u) => (seen = u)));
    await routeViewerService.getScanDetailRows('2026-08-13', 'S1', 7);
    expect(seen.searchParams.get('runDate')).toBe('2026-08-13');
    expect(seen.searchParams.get('scan')).toBe('S1');
    expect(seen.searchParams.get('rootJobId')).toBe('7');
  });

  it('getEvents GETs /runviewer/events with booleans stringified', async () => {
    let seen!: URL;
    server.use(wrapGet('/api/runviewer/events', [], (u) => (seen = u)));
    await routeViewerService.getEvents('2026-08-13', true, true);
    expect(seen.searchParams.get('includeClosed')).toBe('true');
    expect(seen.searchParams.get('clientInternal')).toBe('true');
  });
});

describe('routeViewerService - assignment / actions', () => {
  it('assignRoute POSTs /runviewer/jobs/assign with targetType + targetId', async () => {
    // Regression guard: the backend BulkAssignRequest DTO binds
    // TargetType + TargetId. Sending courierId / agentId / npAgentId
    // instead (the pre-2026-09-15 shape) silently dropped the id and
    // triggered FK_tucJob_Courier violations because @CourierID
    // defaulted to 0 on the SP call.
    let seen: unknown;
    server.use(
      wrapPost(
        '/api/runviewer/jobs/assign',
        { succeeded: 3, failed: 0, errors: [], targetType: 'Courier', targetId: 5, displayName: null },
        (p) => (seen = p),
      ),
    );
    const r = await routeViewerService.assignRoute({
      jobIds: [1, 2, 3], targetType: 'Courier', targetId: 5,
    });
    expect(seen).toEqual({ jobIds: [1, 2, 3], targetType: 'Courier', targetId: 5 });
    expect(r.succeeded).toBe(3);
  });

  it('getLinehaulOverview GETs /runviewer/runs/linehaul/overview', async () => {
    let seen!: URL;
    server.use(wrapGet('/api/runviewer/runs/linehaul/overview', [], (u) => (seen = u)));
    await routeViewerService.getLinehaulOverview('2026-08-13', '1,2', '10');
    expect(seen.searchParams.get('clientIds')).toBe('1,2');
    expect(seen.searchParams.get('speedIds')).toBe('10');
  });

  it('getLinehaulJobs GETs /runviewer/jobs/linehaul', async () => {
    let seen!: URL;
    server.use(wrapGet('/api/runviewer/jobs/linehaul', [], (u) => (seen = u)));
    await routeViewerService.getLinehaulJobs(1, 'AKL', '2026-08-13');
    expect(seen.searchParams.get('depotId')).toBe('1');
    expect(seen.searchParams.get('name')).toBe('AKL');
  });

  it('getLinehaulRuns GETs /runviewer/runs/linehaul with joined ids or nothing', async () => {
    let seen!: URL;
    server.use(wrapGet('/api/runviewer/runs/linehaul', [], (u) => (seen = u)));
    await routeViewerService.getLinehaulRuns('2026-08-13', [1, 2], [3], []);
    expect(seen.searchParams.get('clientIds')).toBe('1,2');
    expect(seen.searchParams.get('fromRegionIds')).toBe('3');
    expect(seen.searchParams.has('regionIds')).toBe(false);
  });

  it('preAssignRun POSTs /runviewer/jobs/preassign-run', async () => {
    let seen: unknown;
    server.use(wrapPost('/api/runviewer/jobs/preassign-run', 'ok', (p) => (seen = p)));
    await routeViewerService.preAssignRun(1, 'C1', 'C0');
    expect(seen).toEqual({ runId: 1, toCourierCode: 'C1', fromCourierCode: 'C0' });
  });

  it('transferRun POSTs /runviewer/jobs/transfer-run', async () => {
    let seen: unknown;
    server.use(wrapPost('/api/runviewer/jobs/transfer-run', 'ok', (p) => (seen = p)));
    await routeViewerService.transferRun(1, 'C1');
    expect(seen).toEqual({ runId: 1, toCourierCode: 'C1', fromCourierCode: null });
  });

  it('releaseRun POSTs /runviewer/jobs/release-run', async () => {
    let seen: unknown;
    server.use(wrapPost('/api/runviewer/jobs/release-run', 'ok', (p) => (seen = p)));
    await routeViewerService.releaseRun(1, 'C1');
    expect(seen).toEqual({ runId: 1, courierCode: 'C1' });
  });

  it('unassignRun POSTs /runviewer/jobs/unassign-run', async () => {
    let seen: unknown;
    server.use(wrapPost('/api/runviewer/jobs/unassign-run', 'ok', (p) => (seen = p)));
    await routeViewerService.unassignRun(1, 'C1');
    expect(seen).toEqual({ runId: 1, courierCode: 'C1' });
  });

  it('activateJob / pickupJob / missingJob / releaseJob each POST their endpoint with { jobId }', async () => {
    const seen: Record<string, unknown> = {};
    server.use(
      wrapPost('/api/runviewer/jobs/activate', 'ok', (p) => (seen.activate = p)),
      wrapPost('/api/runviewer/jobs/pickup', 'ok', (p) => (seen.pickup = p)),
      wrapPost('/api/runviewer/jobs/missing', 'ok', (p) => (seen.missing = p)),
      wrapPost('/api/runviewer/jobs/release', 'ok', (p) => (seen.release = p)),
    );
    await routeViewerService.activateJob(1);
    await routeViewerService.pickupJob(2);
    await routeViewerService.missingJob(3);
    await routeViewerService.releaseJob(4);
    expect(seen).toEqual({
      activate: { jobId: 1 }, pickup: { jobId: 2 }, missing: { jobId: 3 }, release: { jobId: 4 },
    });
  });

  it('completeJob POSTs /runviewer/jobs/complete with { jobId, podName, completedTime? }', async () => {
    let seen: unknown;
    server.use(wrapPost('/api/runviewer/jobs/complete', 'ok', (p) => (seen = p)));
    await routeViewerService.completeJob(1, 'kevin', '10:00');
    expect(seen).toEqual({ jobId: 1, podName: 'kevin', completedTime: '10:00' });
  });

  it('lmcJob POSTs /runviewer/jobs/lmc', async () => {
    let seen: unknown;
    server.use(wrapPost('/api/runviewer/jobs/lmc', 'ok', (p) => (seen = p)));
    await routeViewerService.lmcJob(1, 2, 'C1');
    expect(seen).toEqual({ jobId: 1, bulkJobId: 2, fromCourierCode: 'C1' });
  });

  it('transferJob POSTs /runviewer/jobs/transfer-courier', async () => {
    let seen: unknown;
    server.use(wrapPost('/api/runviewer/jobs/transfer-courier', 'ok', (p) => (seen = p)));
    await routeViewerService.transferJob(1, 'C1', 'C2');
    expect(seen).toEqual({ jobId: 1, fromCourierCode: 'C1', toCourierCode: 'C2' });
  });

  it('sendSmsToJob + sendSmsToRun POST their endpoints', async () => {
    const seen: Record<string, unknown> = {};
    server.use(
      wrapPost('/api/runviewer/jobs/send-sms', 'ok', (p) => (seen.job = p)),
      wrapPost('/api/runviewer/jobs/send-sms-run', 'ok', (p) => (seen.run = p)),
    );
    await routeViewerService.sendSmsToJob(1, '021', 'hi');
    await routeViewerService.sendSmsToRun(2, 'crew');
    expect(seen.job).toEqual({ jobId: 1, mobile: '021', message: 'hi' });
    expect(seen.run).toEqual({ runId: 2, message: 'crew' });
  });

  it('cancelJobs POSTs /runviewer/jobs/cancel', async () => {
    let seen: unknown;
    server.use(wrapPost('/api/runviewer/jobs/cancel', 'ok', (p) => (seen = p)));
    await routeViewerService.cancelJobs([1, 2]);
    expect(seen).toEqual({ bulkJobIds: [1, 2] });
  });

  it('moveJobsBackToRunBuilder POSTs with `void` rename of voidOriginal', async () => {
    let seen: any;
    server.use(wrapPost('/api/runviewer/jobs/move-back-to-runbuilder', 'ok', (p) => (seen = p)));
    await routeViewerService.moveJobsBackToRunBuilder([1], '2026-08-14T00:00', 5, true);
    expect(seen.bulkJobIds).toEqual([1]);
    expect(seen.void).toBe(true);
    expect(seen.newSpeed).toBe(5);
  });

  it('addJobNote + addBulkJobNote POST their endpoints', async () => {
    const seen: Record<string, unknown> = {};
    server.use(
      wrapPost('/api/runviewer/jobs/add-note', 'ok', (p) => (seen.j = p)),
      wrapPost('/api/runviewer/jobs/add-bulk-note', 'ok', (p) => (seen.b = p)),
    );
    await routeViewerService.addJobNote(1, 'n');
    await routeViewerService.addBulkJobNote(2, 'n2');
    expect(seen.j).toEqual({ jobId: 1, notes: 'n' });
    expect(seen.b).toEqual({ bulkJobId: 2, notes: 'n2' });
  });

  it('printLabels POSTs /runviewer/labels/bulk-jobs', async () => {
    let seen: unknown;
    server.use(wrapPost('/api/runviewer/labels/bulk-jobs', 'ok', (p) => (seen = p)));
    await routeViewerService.printLabels([1, 2]);
    expect(seen).toEqual({ bulkJobIds: [1, 2] });
  });

  it('sendPodEmail POSTs /runviewer/jobs/:id/send-pod?toEmail= (URL-encoded)', async () => {
    let seenUrl!: URL; let seenBody: unknown;
    server.use(http.post('/api/runviewer/jobs/:id/send-pod', async ({ request }) => {
      seenUrl = new URL(request.url);
      seenBody = await request.json();
      return HttpResponse.json({ response: 'ok' });
    }));
    await routeViewerService.sendPodEmail(1, 'foo@bar.com');
    expect(seenUrl.searchParams.get('toEmail')).toBe('foo@bar.com');
    expect(seenBody).toEqual({});
  });

  it('getClientIntel GETs /runviewer/jobs/client-intel', async () => {
    let seen!: URL;
    server.use(wrapGet('/api/runviewer/jobs/client-intel', null, (u) => (seen = u)));
    await routeViewerService.getClientIntel('021');
    expect(seen.searchParams.get('mobile')).toBe('021');
  });

  it('getClientIntelImages GETs /runviewer/jobs/client-intel-images', async () => {
    server.use(wrapGet('/api/runviewer/jobs/client-intel-images', []));
    const r = await routeViewerService.getClientIntelImages('021');
    expect(r).toEqual([]);
  });

  it('updateJobGps POSTs /runviewer/jobs/gps with the payload', async () => {
    let seen: any;
    server.use(wrapPost('/api/runviewer/jobs/gps', 'ok', (p) => (seen = p)));
    await routeViewerService.updateJobGps({
      bulkJobId: 1, leg: 'pickup', address: 'a', suburb: 's', latitude: -36.8, longitude: 174.7,
    });
    expect(seen.leg).toBe('pickup');
    expect(seen.latitude).toBe(-36.8);
  });

  it('updateJobTextFields POSTs /runviewer/jobs/:bulkJobId/text-fields with the partial', async () => {
    let seen: any;
    server.use(http.post('/api/runviewer/jobs/:bulkJobId/text-fields', async ({ request }) => {
      seen = await request.json();
      return HttpResponse.json({ response: 'ok' });
    }));
    await routeViewerService.updateJobTextFields(9, { notes: 'x' });
    expect(seen).toEqual({ notes: 'x' });
  });

  it('transferRoute POSTs /runviewer/jobs/transfer-route with backend field names', async () => {
    // The wrapper translates ergonomic prop names (`toRouteId` etc.)
    // into the backend DTO field names (`newRouteId` /
    // `alsoTransferRecurringBooking` / `alsoTransferZipCodes`). Full
    // response shape mirrors TransferRouteResult - success rollup
    // reads `succeeded` / `bookingsAffected` / `zipCodesMoved`.
    let seen: any;
    server.use(wrapPost('/api/runviewer/jobs/transfer-route', {
      succeeded: 1, failed: 0, rowsUpdated: 1,
      bookingsAffected: 0, bookingRowsUpdated: 0,
      zipCodesMoved: 0, zipMappingsInserted: 0, zipMappingsDeleted: 0,
      zipCodes: [], families: [], errors: [],
      newRouteId: 2, newRouteName: null,
      alsoTransferredRecurringBooking: false, alsoTransferredZipCodes: false,
    }, (p) => (seen = p)));
    const r = await routeViewerService.transferRoute({
      jobIds: [1], toRouteId: 2, transferBooking: true, transferZipcodes: false,
    });
    expect(seen.jobIds).toEqual([1]);
    expect(seen.newRouteId).toBe(2);
    expect(seen.alsoTransferRecurringBooking).toBe(true);
    expect(seen.alsoTransferZipCodes).toBe(false);
    // Ergonomic names must NOT leak onto the wire.
    expect(seen.toRouteId).toBeUndefined();
    expect(seen.transferBooking).toBeUndefined();
    expect(seen.transferZipcodes).toBeUndefined();
    expect(r.succeeded).toBe(1);
  });

  it('getTransferContext GETs /runviewer/routes/active with optional anchor', async () => {
    let seen!: URL;
    server.use(wrapGet('/api/runviewer/routes/active', [], (u) => (seen = u)));
    await routeViewerService.getTransferContext(7);
    expect(seen.searchParams.get('anchorJobId')).toBe('7');
  });
});
