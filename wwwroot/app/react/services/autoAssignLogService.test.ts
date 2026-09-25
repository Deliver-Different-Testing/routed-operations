import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { autoAssignLogService } from './autoAssignLogService';

describe('autoAssignLogService', () => {
  it('getLog GETs /diagnostics/auto-assign-log with query params', async () => {
    let seenUrl!: URL;
    server.use(
      http.get('/api/diagnostics/auto-assign-log', ({ request }) => {
        seenUrl = new URL(request.url);
        return HttpResponse.json({ response: { total: 0, page: 1, pageSize: 50, entries: [] } });
      }),
    );
    const r = await autoAssignLogService.getLog({
      outcome: 'Assigned',
      side: 'Left',
      fromUtc: '2026-08-01',
      toUtc: '2026-08-13',
      routeId: 7,
      page: 2,
      pageSize: 25,
    });
    expect(seenUrl.searchParams.get('outcome')).toBe('Assigned');
    expect(seenUrl.searchParams.get('routeId')).toBe('7');
    expect(seenUrl.searchParams.get('page')).toBe('2');
    expect(r.response.entries).toEqual([]);
  });

  it('getLog omits undefined query params', async () => {
    let seenUrl!: URL;
    server.use(
      http.get('/api/diagnostics/auto-assign-log', ({ request }) => {
        seenUrl = new URL(request.url);
        return HttpResponse.json({ response: { total: 0, page: 1, pageSize: 50, entries: [] } });
      }),
    );
    await autoAssignLogService.getLog({});
    expect(seenUrl.searchParams.has('outcome')).toBe(false);
    expect(seenUrl.searchParams.has('routeId')).toBe(false);
  });

  it('getUnresolvedRecurringBookings sends missingPickupCoords only when true', async () => {
    let seenUrl!: URL;
    server.use(
      http.get('/api/diagnostics/auto-assign-log/unresolved-recurring-bookings', ({ request }) => {
        seenUrl = new URL(request.url);
        return HttpResponse.json({ response: { total: 0, page: 1, pageSize: 50, entries: [] } });
      }),
    );
    await autoAssignLogService.getUnresolvedRecurringBookings({ missingPickupCoords: true });
    expect(seenUrl.searchParams.get('missingPickupCoords')).toBe('true');
  });

  it('getUnresolvedRecurringBookings omits missingPickupCoords when false / undefined', async () => {
    let seenUrl!: URL;
    server.use(
      http.get('/api/diagnostics/auto-assign-log/unresolved-recurring-bookings', ({ request }) => {
        seenUrl = new URL(request.url);
        return HttpResponse.json({ response: { total: 0, page: 1, pageSize: 50, entries: [] } });
      }),
    );
    await autoAssignLogService.getUnresolvedRecurringBookings({ missingPickupCoords: false });
    expect(seenUrl.searchParams.has('missingPickupCoords')).toBe(false);
  });
});
