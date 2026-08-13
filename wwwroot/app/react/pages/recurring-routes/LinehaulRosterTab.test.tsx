import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { SharedTargetsProvider } from './SharedTargetsContext';
import { LinehaulRosterTab } from './LinehaulRosterTab';

const emptyTargets = { couriers: [], agents: [], nps: [] };

const stubTargets = (payload = emptyTargets) =>
  http.get('/api/recurring-routes/assignable-targets', () =>
    HttpResponse.json({ response: payload }));

const stubRoster = (grid: { rows: unknown[]; couriers: unknown[] }) =>
  http.get('/api/recurring-linehaul-rosters', () =>
    HttpResponse.json({ response: grid }));

function renderTab() {
  return renderWithProviders(
    <SharedTargetsProvider>
      <LinehaulRosterTab />
    </SharedTargetsProvider>,
  );
}

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  runId: 1, runName: 'AKL-HAM AM', fromDepotName: 'AKL', toDepotName: 'HAM',
  defaultCourierId: null, defaultDriverName: null,
  defaultTargetType: null, defaultTargetId: null,
  defaultTargetName: null, defaultTargetHint: null,
  active: true, cells: [], ...over,
});

describe('LinehaulRosterTab', () => {
  it('shows loading first, then the empty-state prompt when there are no rows', async () => {
    server.use(stubTargets(), stubRoster({ rows: [], couriers: [] }));
    renderTab();
    expect(screen.getByText(/Loading roster/)).toBeInTheDocument();
    expect(await screen.findByText(/No linehaul runs yet/)).toBeInTheDocument();
  });

  it('renders the grid with a day-of-week header for each of Mon..Sun', async () => {
    server.use(stubTargets(), stubRoster({ rows: [row()], couriers: [] }));
    renderTab();
    expect(await screen.findByText('AKL-HAM AM')).toBeInTheDocument();
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((d) => {
      expect(screen.getByRole('columnheader', { name: d })).toBeInTheDocument();
    });
  });

  it('populates a filled cell with the assigned target name', async () => {
    server.use(
      stubTargets({ couriers: [{ id: 7, name: 'Kev', code: 'KEV' }], agents: [], nps: [] }),
      stubRoster({
        rows: [row({
          cells: [{
            rosterId: 100, dayOfWeek: 1, courierId: 7, courierName: 'Kev-Mon',
            targetType: 'Courier', targetId: 7, targetName: 'Kev-Mon', targetHint: null,
          }],
        })],
        couriers: [{ id: 7, name: 'Kev', code: 'KEV' }],
      }),
    );
    renderTab();
    expect(await screen.findByText('Kev-Mon')).toBeInTheDocument();
  });

  it('filters by run search text', async () => {
    server.use(
      stubTargets(),
      stubRoster({
        rows: [row({ runId: 1, runName: 'AKL AM' }),
               row({ runId: 2, runName: 'WLG PM' })],
        couriers: [],
      }),
    );
    renderTab();
    expect(await screen.findByText('AKL AM')).toBeInTheDocument();
    expect(screen.getByText('WLG PM')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Search runs...'), 'WLG');
    await waitFor(() => expect(screen.queryByText('AKL AM')).not.toBeInTheDocument());
    expect(screen.getByText('WLG PM')).toBeInTheDocument();
  });

  it('hides rows without active flag when Active-runs-only is checked', async () => {
    server.use(
      stubTargets(),
      stubRoster({
        rows: [row({ runId: 1, runName: 'On' }),
               row({ runId: 2, runName: 'Off', active: false })],
        couriers: [],
      }),
    );
    renderTab();
    expect(await screen.findByText('On')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/Active runs only/));
    await waitFor(() => expect(screen.queryByText('Off')).not.toBeInTheDocument());
  });

  it('shows an error banner when the roster fetch fails', async () => {
    server.use(
      stubTargets(),
      http.get('/api/recurring-linehaul-rosters', () =>
        new HttpResponse(JSON.stringify({ message: 'roster boom' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })),
    );
    renderTab();
    expect(await screen.findByText(/roster boom/)).toBeInTheDocument();
  });

  it('shows the "no matching filter" message when filters exclude every row', async () => {
    server.use(
      stubTargets(),
      stubRoster({
        rows: [row({ runId: 1, runName: 'AKL AM' })],
        couriers: [],
      }),
    );
    renderTab();
    await screen.findByText('AKL AM');
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Search runs...'), 'no-such-thing');
    expect(await screen.findByText(/No runs match the current filters/))
      .toBeInTheDocument();
  });
});
