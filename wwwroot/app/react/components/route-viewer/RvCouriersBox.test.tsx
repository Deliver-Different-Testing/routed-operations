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

describe('RvCouriersBox', () => {
  beforeEach(() => {
    server.use(stubCouriers([]));
  });

  it('renders header and empty-state row when SP returns no rows', async () => {
    server.use(stubCouriers([]));
    renderBox();
    expect(screen.getByText('Couriers')).toBeInTheDocument();
    expect(
      await screen.findByText(/No active couriers for this date\./),
    ).toBeInTheDocument();
  });

  it('renders a row per courier with the expected cells', async () => {
    server.use(
      stubCouriers([
        mkCourier({ courierId: 1, code: 'KEV', name: 'Kev T', vehicleType: 'Van', activeJobs: 2 }),
        mkCourier({ courierId: 2, code: 'ACE', name: 'Ace X', vehicleType: 'Ute', activeJobs: 5 }),
      ]),
    );
    renderBox();
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
        mkCourier({ courierId: 1, code: 'ABC', name: 'Alpha Beta', vehicleType: undefined, activeJobs: undefined }),
      ]),
    );
    renderBox();
    expect(await screen.findByText('ABC')).toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('applies light-load background when activeJobs <=3', async () => {
    server.use(
      stubCouriers([
        mkCourier({ courierId: 7, code: 'LIT', name: 'Lite', activeJobs: 1 }),
      ]),
    );
    const { container } = renderBox() as any;
    await screen.findByText('LIT');
    expect(document.querySelector('.bg-brand-cyan\\/5')).toBeInTheDocument();
  });

  it('shows green dot when isAvailable and slate when offline', async () => {
    server.use(
      stubCouriers([
        mkCourier({ courierId: 1, code: 'ON', name: 'On', isAvailable: true }),
        mkCourier({ courierId: 2, code: 'OFF', name: 'Off', isAvailable: false }),
      ]),
    );
    renderBox();
    await screen.findByText('ON');
    expect(document.querySelector('.bg-emerald-500')).toBeInTheDocument();
    expect(document.querySelector('.bg-slate-300')).toBeInTheDocument();
  });

  it('fires onPick with courierId when row clicked', async () => {
    server.use(
      stubCouriers([mkCourier({ courierId: 42, code: 'CLK', name: 'Click Me' })]),
    );
    const onPick = vi.fn();
    renderBox({ onPick });
    const codeCell = await screen.findByText('CLK');
    fireEvent.click(codeCell);
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(42));
  });

  it('does NOT wire click cursor when onPick is not passed', async () => {
    server.use(
      stubCouriers([mkCourier({ courierId: 1, code: 'NO', name: 'No' })]),
    );
    renderBox();
    await screen.findByText('NO');
    // Without onPick, no `cursor-pointer` on the row wrapper style.
    const rows = document.querySelectorAll('tbody tr');
    const withCursor = Array.from(rows).some((r) =>
      r.className.includes('cursor-pointer'),
    );
    expect(withCursor).toBe(false);
  });

  it('drag start sets the courier-code + courier-id on dataTransfer', async () => {
    server.use(
      stubCouriers([
        mkCourier({ courierId: 9, code: 'DRG', name: 'Drag' }),
      ]),
    );
    renderBox();
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
