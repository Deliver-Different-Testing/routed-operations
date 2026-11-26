import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import ScheduledRoutes, { RosterModal } from './ScheduledRoutes';

// Route roster DayOfWeek (Dispatch_RouteRoster) is 0-6 with Sunday = 0: that is
// what RouteRosterTab and every SQL reader (uspPrebookSet, WS_stpJob_Insert,
// fnRouteCourierForDate) use. The Routes-tab RosterModal used to write ISO 1-7
// (Sunday = 7), which every reader silently ignored, and showed a real Sunday
// row (0) as '?'. Schedule days (tblBulkRunSchedule) stay ISO 1-7 on purpose.

const route = {
  routeId: 1, name: 'RNO200', area: 'Reno North',
  defaultTargetType: 1, defaultTargetId: 5, defaultTargetName: 'Kev',
  scheduleId: null, scheduleName: '', scheduleWindow: '',
  schedules: [{ scheduleId: 9, name: 'AM', window: '08:00-12:00', days: [1, 7] }],
  active: true, zipcodes: [], bulkPolygons: [],
  rosterEntryCount: 0, bookingCount: 0, mappedStopsCount: 0,
  createdAt: '2026-08-13T00:00:00Z', updatedAt: null,
};

const entry = (over: Record<string, unknown>) => ({
  routeRosterId: 100, routeId: 1, targetType: 1, targetId: 5, targetName: 'Kev',
  rosterDate: null, dayOfWeek: 1, isActive: true, createdAt: '2026-08-13T00:00:00Z',
  ...over,
});

const targets = { couriers: [{ id: 5, name: 'Kev' }], agents: [], nps: [] };

function stubModal(entries: unknown[], onPost?: (body: unknown) => void) {
  server.use(
    http.get('/api/recurring-routes/assignable-targets', () => HttpResponse.json({ response: targets })),
    http.get('/api/recurring-routes/1/roster', () => HttpResponse.json({ response: entries })),
    http.post('/api/recurring-routes/1/roster', async ({ request }) => {
      const body = await request.json();
      onPost?.(body);
      return HttpResponse.json({ response: entry({ routeRosterId: 200 }) });
    }),
  );
}

function renderModal() {
  return renderWithProviders(
    <RosterModal route={route as never} onClose={() => {}} onChanged={async () => {}} />,
  );
}

describe('RosterModal day of week (route roster, 0-6 Sunday = 0)', () => {
  it('offers Mon..Sun with Sunday as value 0 and no value 7', async () => {
    stubModal([]);
    renderModal();
    const sel = (await screen.findByDisplayValue('Mon')) as HTMLSelectElement;
    const opts = Array.from(sel.options).map((o) => `${o.textContent}=${o.value}`);
    expect(opts).toEqual(['Mon=1', 'Tue=2', 'Wed=3', 'Thu=4', 'Fri=5', 'Sat=6', 'Sun=0']);
  });

  it('writes dayOfWeek 0 when the operator adds a Sunday entry', async () => {
    let posted: unknown = null;
    stubModal([], (b) => { posted = b; });
    renderModal();
    const user = userEvent.setup();
    const dow = await screen.findByDisplayValue('Mon');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Kev' })).toBeInTheDocument());
    await user.selectOptions(screen.getByDisplayValue('- Pick -'), '5');
    await user.selectOptions(dow, 'Sun');
    await user.click(screen.getByRole('button', { name: 'Add entry' }));
    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({ targetType: 1, targetId: 5, dayOfWeek: 0, rosterDate: null });
  });

  it('shows a Sunday row (0) as Sun and a Saturday row (6) as Sat', async () => {
    stubModal([
      entry({ routeRosterId: 1, targetName: 'SunCourier', dayOfWeek: 0 }),
      entry({ routeRosterId: 2, targetName: 'SatCourier', dayOfWeek: 6 }),
    ]);
    renderModal();
    const sun = (await screen.findByText('SunCourier')).parentElement!;
    const sat = screen.getByText('SatCourier').parentElement!;
    expect(within(sun).getByText(/Courier - Sun$/)).toBeInTheDocument();
    expect(within(sat).getByText(/Courier - Sat$/)).toBeInTheDocument();
  });
});

describe('Routes list schedule days (tblBulkRunSchedule, ISO 1-7 Sunday = 7)', () => {
  it('still renders schedule day 7 as Sun and day 1 as Mon', async () => {
    server.use(http.get('/api/recurring-routes', () => HttpResponse.json({ response: [route] })));
    renderWithProviders(<ScheduledRoutes />);
    const chip = await screen.findByText('AM');
    const wrap = chip.closest('[title^="AM "]') as HTMLElement;
    expect(wrap.getAttribute('title')).toBe('AM 08:00-12:00 (Mon,Sun)');
  });
});
