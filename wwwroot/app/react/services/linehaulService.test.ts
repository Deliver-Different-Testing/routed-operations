import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { linehaulService, extractLinehaulError, LinehaulMode } from './linehaulService';
import { ApiError } from './api';

const runStub = {
  id: 1, runName: 'LH1', fromDepotId: 1, toDepotId: 2, fromDepotName: 'A', toDepotName: 'B',
  startTime: null, despatchTime: null, courierId: null, defaultDriverName: null,
  defaultAgentId: null, defaultTargetType: null, defaultTargetId: null, defaultTargetName: null,
  defaultTargetHint: null, speedId: null, mode: LinehaulMode.Road, masterBookingId: null,
  masterBookingLabel: null, mappedStopsCount: 0, usedBySchedulesCount: 0, active: true,
};

describe('LinehaulMode', () => {
  it('exposes Road=1 and Flight=2', () => {
    expect(LinehaulMode.Road).toBe(1);
    expect(LinehaulMode.Flight).toBe(2);
  });
});

describe('extractLinehaulError', () => {
  it('returns body.message when the error is an ApiError with a { message } body', () => {
    const e = new ApiError('outer', 400, { message: 'schedule bound' });
    expect(extractLinehaulError(e, 'fallback')).toBe('schedule bound');
  });

  it('falls back to ApiError.message when body has no message', () => {
    const e = new ApiError('outer', 400, {});
    expect(extractLinehaulError(e, 'fallback')).toBe('outer');
  });

  it('returns Error.message for plain Errors', () => {
    expect(extractLinehaulError(new Error('net'), 'fallback')).toBe('net');
  });

  it('returns the fallback when the value is unrecognised', () => {
    expect(extractLinehaulError({} as unknown, 'fallback')).toBe('fallback');
  });
});

describe('linehaulService', () => {
  it('list GETs /recurring-linehaul-runs and unwraps response', async () => {
    server.use(
      http.get('/api/recurring-linehaul-runs', () => HttpResponse.json({ response: [runStub] })),
    );
    const r = await linehaulService.list();
    expect(r).toEqual([runStub]);
  });

  it('lookups GETs /recurring-linehaul-runs/lookups', async () => {
    server.use(
      http.get('/api/recurring-linehaul-runs/lookups', () =>
        HttpResponse.json({ response: { depots: [], couriers: [] } })),
    );
    const r = await linehaulService.lookups();
    expect(r).toEqual({ depots: [], couriers: [] });
  });

  it('get GETs /recurring-linehaul-runs/:id', async () => {
    server.use(
      http.get('/api/recurring-linehaul-runs/:id', ({ params }) => {
        expect(params.id).toBe('7');
        return HttpResponse.json({ response: runStub });
      }),
    );
    const r = await linehaulService.get(7);
    expect(r.id).toBe(1);
  });

  it('create POSTs /recurring-linehaul-runs', async () => {
    let method: string | null = null;
    server.use(
      http.post('/api/recurring-linehaul-runs', ({ request }) => {
        method = request.method;
        return HttpResponse.json({ response: runStub });
      }),
    );
    await linehaulService.create({
      runName: 'LH1', fromDepotId: 1, toDepotId: 2, startTime: null, despatchTime: null,
      defaultTargetType: null, defaultTargetId: null, speedId: null, mode: LinehaulMode.Road,
      masterBookingId: null,
    });
    expect(method).toBe('POST');
  });

  it('update PUTs /recurring-linehaul-runs/:id', async () => {
    let method: string | null = null;
    server.use(
      http.put('/api/recurring-linehaul-runs/:id', ({ request }) => {
        method = request.method;
        return HttpResponse.json({ response: runStub });
      }),
    );
    await linehaulService.update(1, {
      runName: 'LH1', fromDepotId: 1, toDepotId: 2, startTime: null, despatchTime: null,
      defaultTargetType: null, defaultTargetId: null, speedId: null, mode: LinehaulMode.Road,
      masterBookingId: null,
    });
    expect(method).toBe('PUT');
  });

  it('remove DELETEs /recurring-linehaul-runs/:id', async () => {
    let method: string | null = null;
    server.use(
      http.delete('/api/recurring-linehaul-runs/:id', ({ request }) => {
        method = request.method;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    await linehaulService.remove(3);
    expect(method).toBe('DELETE');
  });

  it('copy POSTs /recurring-linehaul-runs/:id/copy', async () => {
    server.use(
      http.post('/api/recurring-linehaul-runs/:id/copy', () =>
        HttpResponse.json({ response: runStub })),
    );
    const r = await linehaulService.copy(1);
    expect(r.id).toBe(1);
  });

  it('schedulesForRun GETs /recurring-linehaul-runs/:id/schedules', async () => {
    server.use(
      http.get('/api/recurring-linehaul-runs/:id/schedules', () =>
        HttpResponse.json({ response: [] })),
    );
    const r = await linehaulService.schedulesForRun(1);
    expect(r).toEqual([]);
  });

  it('searchLinkableBookings GETs /recurring-linehaul-runs/:runId/linkable-bookings?q= (encoded)', async () => {
    let seenUrl!: URL;
    server.use(
      http.get('/api/recurring-linehaul-runs/:runId/linkable-bookings', ({ request }) => {
        seenUrl = new URL(request.url);
        return HttpResponse.json({ response: [] });
      }),
    );
    await linehaulService.searchLinkableBookings(1, 'foo bar');
    expect(seenUrl.searchParams.get('q')).toBe('foo bar');
  });

  it('rosterGrid GETs /recurring-linehaul-rosters', async () => {
    server.use(
      http.get('/api/recurring-linehaul-rosters', () =>
        HttpResponse.json({ response: { rows: [], couriers: [] } })),
    );
    const r = await linehaulService.rosterGrid();
    expect(r).toEqual({ rows: [], couriers: [] });
  });

  it('upsertRosterCell PUTs /recurring-linehaul-rosters', async () => {
    let method: string | null = null; let seen: any;
    server.use(
      http.put('/api/recurring-linehaul-rosters', async ({ request }) => {
        method = request.method;
        seen = await request.json();
        return HttpResponse.json({ response: { rosterId: 1, dayOfWeek: 1, courierId: null, courierName: null, targetType: 'Courier', targetId: 1, targetName: 'C', targetHint: null } });
      }),
    );
    await linehaulService.upsertRosterCell({ linehaulRunId: 1, dayOfWeek: 1, targetType: 'Courier', targetId: 1 });
    expect(method).toBe('PUT');
    expect(seen.linehaulRunId).toBe(1);
  });

  it('deleteRosterCell DELETEs /recurring-linehaul-rosters/:rosterId', async () => {
    let method: string | null = null;
    server.use(
      http.delete('/api/recurring-linehaul-rosters/:rosterId', ({ request }) => {
        method = request.method;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    await linehaulService.deleteRosterCell(9);
    expect(method).toBe('DELETE');
  });
});
