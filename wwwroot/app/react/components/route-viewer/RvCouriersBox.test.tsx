import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { RvCouriersBox } from './RvCouriersBox';

const stubCouriers = (rows: any[]) =>
  http.get('/api/runviewer/couriers', () =>
    HttpResponse.json({ response: rows }),
  );

function renderBox(props: Partial<Parameters<typeof RvCouriersBox>[0]> = {}) {
  const defaults = {
    runDate: '2026-08-13',
  };
  const merged = { ...defaults, ...props };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderWithProviders(
    <QueryClientProvider client={client}>
      <RvCouriersBox {...merged} />
    </QueryClientProvider>,
  );
  return merged;
}

const mkCourier = (over: Record<string, any> = {}) => ({
  courierId: 1,
  code: 'KEV',
  name: 'Kev T',
  fleet: 'FleetA',
  activeJobs: 2,
  isAvailable: true,
  vehicleType: 'Van',
  ...over,
});

async function drillInto(fleetName: string) {
  const cell = await screen.findByText(fleetName);
  fireEvent.click(cell);
}

describe('RvCouriersBox - Fleets view', () => {
  beforeEach(() => {
    server.use(stubCouriers([]));
  });

  it('renders the Fleets header and empty-state row when SP returns no rows', async () => {
    server.use(stubCouriers([]));
    renderBox();
    expect(screen.getByText('Fleets')).toBeInTheDocument();
    expect(
      await screen.findByText(/No active couriers for this date\./),
    ).toBeInTheDocument();
  });

  it('groups couriers by fleet with a per-fleet courier count', async () => {
    server.use(
      stubCouriers([
        mkCourier({ courierId: 1, code: 'KEV', fleet: 'FleetA' }),
        mkCourier({ courierId: 2, code: 'ACE', fleet: 'FleetA' }),
        mkCourier({ courierId: 3, code: 'ZED', fleet: 'FleetB' }),
      ]),
    );
    renderBox();
    expect(await screen.findByText('FleetA')).toBeInTheDocument();
    expect(screen.getByText('FleetB')).toBeInTheDocument();
    const rows = document.querySelectorAll('tbody tr');
    // 2 fleets => 2 rows.
    expect(rows.length).toBe(2);
    // FleetA row shows count 2, FleetB row shows count 1.
    const aRow = Array.from(rows).find((r) => r.textContent?.includes('FleetA'))!;
    const bRow = Array.from(rows).find((r) => r.textContent?.includes('FleetB'))!;
    expect(aRow.textContent).toContain('2');
    expect(bRow.textContent).toContain('1');
  });

  it('buckets couriers with no fleet under an Unassigned group', async () => {
    server.use(
      stubCouriers([
        mkCourier({ courierId: 1, code: 'ORP', fleet: undefined }),
        mkCourier({ courierId: 2, code: 'BLK', fleet: '' }),
      ]),
    );
    renderBox();
    expect(await screen.findByText('Unassigned')).toBeInTheDocument();
  });
});

describe('RvCouriersBox - drill-down transition', () => {
  beforeEach(() => {
    server.use(stubCouriers([]));
  });

  it('clicking a fleet shows its couriers, and the back arrow returns to fleets', async () => {
    server.use(
      stubCouriers([
        mkCourier({ courierId: 1, code: 'KEV', name: 'Kev T', fleet: 'FleetA' }),
        mkCourier({ courierId: 2, code: 'ACE', name: 'Ace X', fleet: 'FleetA' }),
        mkCourier({ courierId: 3, code: 'ZED', name: 'Zed Z', fleet: 'FleetB' }),
      ]),
    );
    renderBox();

    // Start on Fleets view.
    expect(await screen.findByText('FleetA')).toBeInTheDocument();
    expect(screen.getByText('Fleets')).toBeInTheDocument();
    expect(screen.queryByText('KEV')).not.toBeInTheDocument();

    // Drill into FleetA.
    await drillInto('FleetA');

    // Subtitle switches to "Couriers for FleetA".
    expect(await screen.findByText('Couriers for FleetA')).toBeInTheDocument();
    // Both FleetA couriers are visible.
    expect(screen.getByText('KEV')).toBeInTheDocument();
    expect(screen.getByText('ACE')).toBeInTheDocument();
    // FleetB's courier is NOT.
    expect(screen.queryByText('ZED')).not.toBeInTheDocument();

    // Back to Fleets via the affordance in the header actions.
    const back = screen.getByTitle('Back to Fleets');
    fireEvent.click(back);

    // Fleets header is back and the couriers no longer render.
    expect(await screen.findByText('Fleets')).toBeInTheDocument();
    expect(screen.queryByText('KEV')).not.toBeInTheDocument();
    expect(screen.getByText('FleetA')).toBeInTheDocument();
    expect(screen.getByText('FleetB')).toBeInTheDocument();
  });
});

describe('RvCouriersBox - Couriers view (after drill-down)', () => {
  beforeEach(() => {
    server.use(stubCouriers([]));
  });

  it('renders a row per courier with the expected cells', async () => {
    server.use(
      stubCouriers([
        mkCourier({ courierId: 1, code: 'KEV', name: 'Kev T', vehicleType: 'Van', activeJobs: 2, fleet: 'FleetA' }),
        mkCourier({ courierId: 2, code: 'ACE', name: 'Ace X', vehicleType: 'Ute', activeJobs: 5, fleet: 'FleetA' }),
      ]),
    );
    renderBox();
    await drillInto('FleetA');
    expect(await screen.findByText('KEV')).toBeInTheDocument();
    expect(screen.getByText('Kev T')).toBeInTheDocument();
    expect(screen.getByText('ACE')).toBeInTheDocument();
    expect(screen.getByText('Ace X')).toBeInTheDocument();
    expect(screen.getByText('Van')).toBeInTheDocument();
    expect(screen.getByText('Ute')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders a dash for missing vehicleType and zero for missing activeJobs', async () => {
    server.use(
      stubCouriers([
        mkCourier({ courierId: 1, code: 'ABC', name: 'Alpha Beta', vehicleType: undefined, activeJobs: undefined, fleet: 'FleetA' }),
      ]),
    );
    renderBox();
    await drillInto('FleetA');
    expect(await screen.findByText('ABC')).toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('applies light-load background when activeJobs <=3', async () => {
    server.use(
      stubCouriers([
        mkCourier({ courierId: 7, code: 'LIT', name: 'Lite', activeJobs: 1, fleet: 'FleetA' }),
      ]),
    );
    renderBox();
    await drillInto('FleetA');
    await screen.findByText('LIT');
    expect(document.querySelector('.bg-brand-cyan\\/5')).toBeInTheDocument();
  });

  it('shows green dot when isAvailable and slate when offline', async () => {
    server.use(
      stubCouriers([
        mkCourier({ courierId: 1, code: 'ON', name: 'On', isAvailable: true, fleet: 'FleetA' }),
        mkCourier({ courierId: 2, code: 'OFF', name: 'Off', isAvailable: false, fleet: 'FleetA' }),
      ]),
    );
    renderBox();
    await drillInto('FleetA');
    await screen.findByText('ON');
    expect(document.querySelector('.bg-emerald-500')).toBeInTheDocument();
    expect(document.querySelector('.bg-slate-300')).toBeInTheDocument();
  });

  it('fires onPick with the full courier row when a courier is clicked', async () => {
    server.use(
      stubCouriers([mkCourier({ courierId: 42, code: 'CLK', name: 'Click Me', fleet: 'FleetA' })]),
    );
    const onPick = vi.fn();
    renderBox({ onPick });
    await drillInto('FleetA');
    const codeCell = await screen.findByText('CLK');
    fireEvent.click(codeCell);
    await waitFor(() =>
      expect(onPick).toHaveBeenCalledWith(
        expect.objectContaining({ courierId: 42, code: 'CLK', name: 'Click Me' }),
      ),
    );
  });

  it('does NOT wire click cursor on courier rows when onPick is not passed', async () => {
    server.use(
      stubCouriers([mkCourier({ courierId: 1, code: 'NO', name: 'No', fleet: 'FleetA' })]),
    );
    renderBox();
    await drillInto('FleetA');
    await screen.findByText('NO');
    // Fleet row + courier row both live in the tbody at different times;
    // after drill-down, only the courier row is present. Assert THAT row
    // has no cursor-pointer.
    const rows = document.querySelectorAll('tbody tr');
    const withCursor = Array.from(rows).some((r) =>
      r.className.includes('cursor-pointer'),
    );
    expect(withCursor).toBe(false);
  });

  it('drag start sets the courier-code + courier-id on dataTransfer', async () => {
    server.use(
      stubCouriers([
        mkCourier({ courierId: 9, code: 'DRG', name: 'Drag', fleet: 'FleetA' }),
      ]),
    );
    renderBox();
    await drillInto('FleetA');
    await screen.findByText('DRG');
    const row = document.querySelector('tr[draggable="true"]') as HTMLElement;
    expect(row).not.toBeNull();
    const setData = vi.fn();
    fireEvent.dragStart(row, {
      dataTransfer: { setData, effectAllowed: '' },
    });
    expect(setData).toHaveBeenCalledWith('application/rv-courier-code', 'DRG');
    expect(setData).toHaveBeenCalledWith('application/rv-courier-id', '9');
  });

  it('skips fetching when runDate is empty (query disabled)', async () => {
    let hit = 0;
    server.use(
      http.get('/api/runviewer/couriers', () => {
        hit++;
        return HttpResponse.json({ response: [] });
      }),
    );
    renderBox({ runDate: '' });
    // Give the effect a tick; query should stay disabled.
    await new Promise((r) => setTimeout(r, 20));
    expect(hit).toBe(0);
  });
});

describe('RvCouriersBox - availableOnly filter', () => {
  beforeEach(() => {
    server.use(stubCouriers([]));
  });

  it('hides offline couriers from the fleet list when availableOnly is on', async () => {
    server.use(
      stubCouriers([
        mkCourier({ courierId: 1, code: 'ONA', name: 'On A', isAvailable: true, fleet: 'FleetA' }),
        mkCourier({ courierId: 2, code: 'OFF', name: 'Off X', isAvailable: false, fleet: 'FleetB' }),
      ]),
    );
    renderBox({ availableOnly: true });
    // Only FleetA (which has the available courier) should show.
    expect(await screen.findByText('FleetA')).toBeInTheDocument();
    expect(screen.queryByText('FleetB')).toBeNull();
  });

  it('shows every fleet when availableOnly is off', async () => {
    server.use(
      stubCouriers([
        mkCourier({ courierId: 1, code: 'ONA', name: 'On A', isAvailable: true, fleet: 'FleetA' }),
        mkCourier({ courierId: 2, code: 'OFF', name: 'Off X', isAvailable: false, fleet: 'FleetB' }),
      ]),
    );
    renderBox({ availableOnly: false });
    expect(await screen.findByText('FleetA')).toBeInTheDocument();
    expect(screen.getByText('FleetB')).toBeInTheDocument();
  });

  it('drops offline rows from the courier drill-down when availableOnly is on', async () => {
    server.use(
      stubCouriers([
        mkCourier({ courierId: 1, code: 'AVA', name: 'Ava', isAvailable: true, fleet: 'FleetA' }),
        mkCourier({ courierId: 2, code: 'OFX', name: 'Off X', isAvailable: false, fleet: 'FleetA' }),
      ]),
    );
    renderBox({ availableOnly: true });
    await drillInto('FleetA');
    expect(await screen.findByText('AVA')).toBeInTheDocument();
    expect(screen.queryByText('OFX')).toBeNull();
  });
});
