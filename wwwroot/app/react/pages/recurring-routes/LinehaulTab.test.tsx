import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { SharedTargetsProvider } from './SharedTargetsContext';
import { LinehaulTab } from './LinehaulTab';

const emptyTargets = { couriers: [], agents: [], nps: [] };
const emptyLookups = { depots: [], couriers: [] };
const emptySpeeds: any[] = [];

const stubBaseline = () => [
  http.get('/api/recurring-routes/assignable-targets', () =>
    HttpResponse.json({ response: emptyTargets })),
  http.get('/api/recurring-linehaul-runs/lookups', () =>
    HttpResponse.json({ response: emptyLookups })),
  http.get('/api/speeds/grouped', () =>
    HttpResponse.json({ response: emptySpeeds })),
];

const stubRuns = (runs: unknown[]) =>
  http.get('/api/recurring-linehaul-runs', () =>
    HttpResponse.json({ response: runs }));

const run = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1, runName: 'AKL-HAM AM',
  fromDepotId: 1, toDepotId: 2, fromDepotName: 'AKL', toDepotName: 'HAM',
  startTime: '08:00', despatchTime: '09:00',
  courierId: null, defaultDriverName: null, defaultAgentId: null,
  defaultTargetType: null, defaultTargetId: null,
  defaultTargetName: null, defaultTargetHint: null,
  speedId: null, mode: 1, masterBookingId: null, masterBookingLabel: null,
  mappedStopsCount: 3, usedBySchedulesCount: 1, active: true,
  ...over,
});

function renderTab() {
  return renderWithProviders(
    <SharedTargetsProvider>
      <LinehaulTab />
    </SharedTargetsProvider>,
  );
}

describe('LinehaulTab', () => {
  it('renders the empty-state when no runs exist', async () => {
    server.use(...stubBaseline(), stubRuns([]));
    renderTab();
    expect(await screen.findByText(/No middle-mile runs yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Linehaul Run/ })).toBeInTheDocument();
  });

  it('renders a run row with its name, depots, times, and counts', async () => {
    server.use(...stubBaseline(), stubRuns([run()]));
    renderTab();
    expect(await screen.findByText('AKL-HAM AM')).toBeInTheDocument();
    expect(screen.getByText('08:00')).toBeInTheDocument();
    expect(screen.getByText('09:00')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();       // mapped stops
    expect(screen.getByText('1')).toBeInTheDocument();       // schedules
  });

  it('hides inactive runs by default and shows them after toggling', async () => {
    server.use(...stubBaseline(),
      stubRuns([run({ id: 1, runName: 'On' }),
                run({ id: 2, runName: 'Off', active: false })]));
    renderTab();
    expect(await screen.findByText('On')).toBeInTheDocument();
    expect(screen.queryByText('Off')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/Show inactive/));
    await waitFor(() => expect(screen.getByText('Off')).toBeInTheDocument());
  });

  it('opens the edit modal when a run row is clicked', async () => {
    server.use(...stubBaseline(), stubRuns([run()]));
    renderTab();
    const rowEl = await screen.findByText('AKL-HAM AM');
    const user = userEvent.setup();
    await user.click(rowEl);
    expect(await screen.findByRole('heading', { name: 'Edit Linehaul Run' }))
      .toBeInTheDocument();
  });

  it('opens the New Linehaul Run modal when the + button is clicked', async () => {
    server.use(...stubBaseline(), stubRuns([]));
    renderTab();
    await screen.findByText(/No middle-mile runs yet/);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Add Linehaul Run/ }));
    expect(await screen.findByRole('heading', { name: 'New Linehaul Run' }))
      .toBeInTheDocument();
  });

  it('surfaces the API error on failed load', async () => {
    server.use(
      http.get('/api/recurring-routes/assignable-targets', () =>
        HttpResponse.json({ response: emptyTargets })),
      http.get('/api/recurring-linehaul-runs/lookups', () =>
        HttpResponse.json({ response: emptyLookups })),
      http.get('/api/recurring-linehaul-runs', () =>
        new HttpResponse(JSON.stringify({ message: 'runs boom' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })),
    );
    renderTab();
    expect(await screen.findByText(/runs boom/)).toBeInTheDocument();
  });

  it('shows the runs count in the header', async () => {
    server.use(...stubBaseline(),
      stubRuns([run({ id: 1, runName: 'A' }), run({ id: 2, runName: 'B' })]));
    renderTab();
    expect(await screen.findByText('2 linehaul runs')).toBeInTheDocument();
  });
});
