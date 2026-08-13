import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';

// The mapped-stops drilldown mounts its own tree + fetches. Stub it so the
// row-level "View mapped stops" affordance test doesn't need to fixture the
// drilldown's world.
vi.mock('./recurring-routes/MappedStopsDrilldown', () => ({
  MappedStopsDrilldown: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="mapped-stops-drilldown">
      drilldown<button onClick={onClose}>close-drilldown</button>
    </div>
  ),
}));

import ScheduledRoutes from './ScheduledRoutes';

const emptyTargets = { couriers: [], agents: [], nps: [] };

const stubTargets = () =>
  http.get('/api/recurring-routes/assignable-targets', () =>
    HttpResponse.json({ response: emptyTargets }));

const stubSchedules = (list: unknown[] = []) =>
  http.get('/api/recurring-routes/schedules/lookup', () =>
    HttpResponse.json({ response: list }));

const stubZipcodeSearch = () =>
  http.get('/api/recurring-routes/zipcodes/search', () =>
    HttpResponse.json({ response: [] }));

const stubZipcodeShapes = () =>
  http.post('/api/recurring-routes/zipcodes/shapes', () =>
    HttpResponse.json({ response: [] }));

const stubCentroids = () =>
  http.get('/api/recurring-routes/zipcodes/centroids', () =>
    HttpResponse.json({ response: [] }));

const stubRoutes = (routes: unknown[]) =>
  http.get('/api/recurring-routes', () =>
    HttpResponse.json({ response: routes }));

const baseline = () => [
  stubTargets(), stubSchedules(), stubZipcodeSearch(), stubZipcodeShapes(),
  stubCentroids(),
];

const route = (over: Partial<Record<string, unknown>> = {}) => ({
  routeId: 1,
  name: 'RNO200',
  area: 'Reno North',
  defaultTargetType: 1,
  defaultTargetId: 5,
  defaultTargetName: 'Kev',
  scheduleId: null,
  scheduleName: '',
  scheduleWindow: '',
  schedules: [],
  active: true,
  zipcodes: [],
  bulkPolygons: [],
  rosterEntryCount: 0,
  bookingCount: 0,
  mappedStopsCount: 0,
  createdAt: '2026-08-13T00:00:00Z',
  updatedAt: null,
  ...over,
});

describe('ScheduledRoutes - render', () => {
  it('renders the empty state when no routes exist', async () => {
    server.use(...baseline(), stubRoutes([]));
    renderWithProviders(<ScheduledRoutes />);
    expect(await screen.findByText(/No routes yet\. Click "\+ Add Route" to create one\./))
      .toBeInTheDocument();
  });

  it('renders the header columns + a route row', async () => {
    server.use(...baseline(), stubRoutes([route()]));
    renderWithProviders(<ScheduledRoutes />);
    expect(await screen.findByText('RNO200')).toBeInTheDocument();
    expect(screen.getByText('Reno North')).toBeInTheDocument();
    // Type chip
    expect(screen.getByText('First/Final Mile')).toBeInTheDocument();
    // Default target name displayed
    expect(screen.getByText('Kev')).toBeInTheDocument();
    // Active pill
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('hides inactive routes by default and shows them when toggled', async () => {
    server.use(...baseline(), stubRoutes([
      route({ routeId: 1, name: 'On' }),
      route({ routeId: 2, name: 'Off', active: false }),
    ]));
    renderWithProviders(<ScheduledRoutes />);
    expect(await screen.findByText('On')).toBeInTheDocument();
    expect(screen.queryByText('Off')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/Show inactive/));
    await waitFor(() => expect(screen.getByText('Off')).toBeInTheDocument());
  });

  it('reports the list-fetch error via toast', async () => {
    server.use(
      ...baseline(),
      http.get('/api/recurring-routes', () =>
        new HttpResponse(JSON.stringify({ message: 'routes boom' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })),
    );
    renderWithProviders(<ScheduledRoutes />);
    expect(await screen.findByText(/routes boom/)).toBeInTheDocument();
  });

  it('renders a formatted schedule chip when the route has one', async () => {
    server.use(...baseline(), stubRoutes([route({
      schedules: [{ scheduleId: 10, name: 'AM Run', window: '08:00-10:00', days: [1, 2, 3] }],
    })]));
    renderWithProviders(<ScheduledRoutes />);
    expect(await screen.findByText('AM Run')).toBeInTheDocument();
    expect(screen.getByText('08:00-10:00')).toBeInTheDocument();
  });

  it('opens the edit modal when a row is clicked', async () => {
    server.use(...baseline(), stubRoutes([route()]));
    renderWithProviders(<ScheduledRoutes />);
    const rowText = await screen.findByText('RNO200');
    const user = userEvent.setup();
    await user.click(rowText);
    expect(await screen.findByRole('heading', { name: /Edit "RNO200"/ }))
      .toBeInTheDocument();
  });

  it('opens the New route modal when + Add Route is clicked', async () => {
    server.use(...baseline(), stubRoutes([]));
    renderWithProviders(<ScheduledRoutes />);
    await screen.findByText(/No routes yet/);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Add Route/ }));
    expect(await screen.findByRole('heading', { name: 'New route' }))
      .toBeInTheDocument();
  });

  it('opens the roster modal from the Roster column button', async () => {
    server.use(...baseline(), stubRoutes([route({ rosterEntryCount: 2 })]),
      http.get('/api/recurring-routes/1/roster', () => HttpResponse.json({ response: [] })));
    renderWithProviders(<ScheduledRoutes />);
    const rosterBtn = await screen.findByTitle('Manage roster');
    const user = userEvent.setup();
    await user.click(rosterBtn);
    expect(await screen.findByRole('heading', { name: /Roster - RNO200/ }))
      .toBeInTheDocument();
  });

  it('opens the mapped-stops drilldown when the Mapped Stops button is clicked', async () => {
    server.use(...baseline(), stubRoutes([route({ mappedStopsCount: 5 })]));
    renderWithProviders(<ScheduledRoutes />);
    await screen.findByText('RNO200');
    const user = userEvent.setup();
    await user.click(screen.getByTitle('View mapped stops'));
    expect(await screen.findByTestId('mapped-stops-drilldown')).toBeInTheDocument();
    // Close it back
    await user.click(screen.getByRole('button', { name: 'close-drilldown' }));
    await waitFor(() =>
      expect(screen.queryByTestId('mapped-stops-drilldown')).not.toBeInTheDocument(),
    );
  });

  it('mapped-stops button is disabled with 0 mapped stops', async () => {
    server.use(...baseline(), stubRoutes([route({ mappedStopsCount: 0 })]));
    renderWithProviders(<ScheduledRoutes />);
    await screen.findByText('RNO200');
    expect(screen.getByTitle('No mapped stops on this route yet')).toBeDisabled();
  });

  it('deactivates a route on the row-actions Delete + confirm', async () => {
    let deleted = false;
    let listHits = 0;
    server.use(
      ...baseline(),
      http.get('/api/recurring-routes', () => {
        listHits++;
        return HttpResponse.json({
          response: listHits === 1
            ? [route({ routeId: 42, name: 'Doomed' })]
            : [route({ routeId: 42, name: 'Doomed', active: false })],
        });
      }),
      http.delete('/api/recurring-routes/42', () => {
        deleted = true;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    renderWithProviders(<ScheduledRoutes />);
    await screen.findByText('Doomed');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Row actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    // Confirm dialog
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(deleted).toBe(true));
  });

  it('shows the pause -> resume label toggle on the row actions menu', async () => {
    server.use(...baseline(), stubRoutes([route({ active: true })]));
    renderWithProviders(<ScheduledRoutes />);
    await screen.findByText('RNO200');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Row actions' }));
    expect(screen.getByRole('menuitem', { name: 'Pause' })).toBeInTheDocument();
    // Close the menu
    await user.keyboard('{Escape}');
  });

  it('pause action calls the update endpoint with active=false', async () => {
    let putBody: any = null;
    let listHits = 0;
    server.use(
      ...baseline(),
      http.get('/api/recurring-routes', () => {
        listHits++;
        return HttpResponse.json({
          response: [route({ routeId: 7, name: 'Pauseable', active: true })],
        });
      }),
      http.put('/api/recurring-routes/7', async ({ request }) => {
        putBody = await request.json();
        return HttpResponse.json({ response: route({ routeId: 7, active: false }) });
      }),
    );
    renderWithProviders(<ScheduledRoutes />);
    await screen.findByText('Pauseable');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Row actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Pause' }));
    await waitFor(() => expect(putBody).not.toBeNull());
    expect(putBody.active).toBe(false);
  });

  it('copy action calls the copy endpoint and opens the clone in edit mode', async () => {
    server.use(
      ...baseline(),
      stubRoutes([route()]),
      http.post('/api/recurring-routes/1/copy', () =>
        HttpResponse.json({
          response: route({ routeId: 99, name: 'RNO200 (copy)' }),
        })),
    );
    renderWithProviders(<ScheduledRoutes />);
    await screen.findByText('RNO200');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Row actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Copy' }));
    expect(await screen.findByRole('heading', { name: /Edit "RNO200 \(copy\)"/ }))
      .toBeInTheDocument();
  });

  it('opens the editor via ?edit=<id> deeplink after routes load', async () => {
    server.use(...baseline(), stubRoutes([route({ routeId: 55, name: 'DeepLink' })]));
    const original = window.location;
    // Overwrite the URL search so the effect picks up ?edit=55
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...original,
        search: '?edit=55',
        pathname: '/routes',
        hash: '',
      },
    });
    try {
      renderWithProviders(<ScheduledRoutes />);
      expect(await screen.findByRole('heading', { name: /Edit "DeepLink"/ }))
        .toBeInTheDocument();
    } finally {
      Object.defineProperty(window, 'location', { writable: true, value: original });
    }
  });

  it('reports "not found" toast when ?edit=<id> is unknown', async () => {
    server.use(...baseline(), stubRoutes([route({ routeId: 1 })]));
    const original = window.location;
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...original, search: '?edit=9999', pathname: '/routes', hash: '' },
    });
    try {
      renderWithProviders(<ScheduledRoutes />);
      expect(await screen.findByText(/Route #9999 not found or inactive/))
        .toBeInTheDocument();
    } finally {
      Object.defineProperty(window, 'location', { writable: true, value: original });
    }
  });
});
