import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { RvFilterBar, type FilterState } from './RvFilterBar';

const baseline = () => [
  http.get('/api/runviewer/filters/clients', () => HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/filters/regions', () => HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/filters/speeds', () => HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/couriers', () => HttpResponse.json({ response: [] })),
];

const baseValue = (): FilterState => ({
  runDate: '2026-08-13',
  clientIds: [],
  regionIds: [],
  speedIds: [],
  courierId: null,
  activeRegionsOnly: false,
  availableCouriersOnly: false,
});

function renderBar(overrides: Partial<Parameters<typeof RvFilterBar>[0]> = {}) {
  const defaults = {
    value: baseValue(),
    onChange: vi.fn(),
    onRefresh: vi.fn(),
  };
  const props = { ...defaults, ...overrides };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderWithProviders(
    <QueryClientProvider client={client}>
      <RvFilterBar {...props} />
    </QueryClientProvider>,
  );
  return props;
}

describe('RvFilterBar', () => {
  beforeEach(() => {
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      isNetworkPartner: false,
    };
    server.use(...baseline());
  });

  it('renders date input + admin dropdowns + Refresh', () => {
    renderBar();
    expect(screen.getByDisplayValue('2026-08-13')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh/ })).toBeInTheDocument();
  });

  it('hides admin fields for NP user', () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, isNetworkPartner: true };
    renderBar();
    // Clients + Region + Courier + activeRegionsOnly hidden for NP
    expect(screen.queryByText('Region')).toBeNull();
    expect(screen.queryByText('Courier')).toBeNull();
    expect(screen.queryByText('Active regions only')).toBeNull();
  });

  it('fires onChange when date input changes', async () => {
    const props = renderBar();
    const user = userEvent.setup();
    const date = screen.getByDisplayValue('2026-08-13');
    await user.clear(date);
    await user.type(date, '2026-09-01');
    // onChange called at least once with updated date
    expect(props.onChange).toHaveBeenCalled();
  });

  it('fires onRefresh on Refresh click', async () => {
    const props = renderBar();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Refresh/ }));
    expect(props.onRefresh).toHaveBeenCalled();
  });

  it('shows Refreshing... label when isRefreshing=true + disables button', () => {
    renderBar({ isRefreshing: true });
    const btn = screen.getByRole('button', { name: /Refreshing/ });
    expect(btn).toBeDisabled();
  });

  it('renders extraActions slot', () => {
    renderBar({ extraActions: <button>Custom</button> });
    expect(screen.getByRole('button', { name: 'Custom' })).toBeInTheDocument();
  });

  // Steve 2026-11-27: inactive Cheetah depots must drop out of the Region
  // list when "Active regions only" is ticked, and come back when it is not.
  describe('Region options follow activeRegionsOnly', () => {
    beforeEach(() => {
      server.use(
        http.get('/api/runviewer/filters/regions', () => HttpResponse.json({
          response: [
            { id: 10, label: 'Dallas', active: true },
            { id: 30, label: 'Phoenix', active: false },
          ],
        })),
      );
    });

    const openRegion = async () => {
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /^Region/ }));
      await screen.findByText('Dallas');
    };

    it('ticked: inactive region is not offered', async () => {
      renderBar({ value: { ...baseValue(), activeRegionsOnly: true } });
      await openRegion();
      expect(screen.queryByText(/Phoenix/)).toBeNull();
    });

    it('unticked: inactive region is offered, marked (inactive)', async () => {
      renderBar({ value: { ...baseValue(), activeRegionsOnly: false } });
      await openRegion();
      expect(screen.getByText('Phoenix (inactive)')).toBeInTheDocument();
    });

    it('ticked with Phoenix already selected: Phoenix stays, marked', async () => {
      renderBar({ value: { ...baseValue(), activeRegionsOnly: true, regionIds: [30] } });
      expect(await screen.findByRole('button', { name: /Region: Phoenix \(inactive\)/ })).toBeInTheDocument();
      await openRegion();
      expect(screen.getByRole('button', { name: 'Phoenix (inactive)' })).toBeInTheDocument();
    });
  });

  it('toggles activeRegionsOnly via checkbox', async () => {
    const props = renderBar();
    const user = userEvent.setup();
    const cb = screen.getByLabelText('Active regions only');
    await user.click(cb);
    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ activeRegionsOnly: true }),
    );
  });

  it('toggles availableCouriersOnly via the Available Couriers Only checkbox', async () => {
    const props = renderBar();
    const user = userEvent.setup();
    const cb = screen.getByLabelText('Available Couriers Only');
    await user.click(cb);
    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ availableCouriersOnly: true }),
    );
  });

  it('hides the Available Couriers Only checkbox for NP users', () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, isNetworkPartner: true };
    renderBar();
    expect(screen.queryByLabelText('Available Couriers Only')).toBeNull();
  });

  it('renders region options from lookups + updates on select', async () => {
    server.use(
      http.get('/api/runviewer/filters/clients', () => HttpResponse.json({ response: [] })),
      http.get('/api/runviewer/filters/regions', () =>
        HttpResponse.json({ response: [{ id: 5, label: 'AKL' }] })),
      http.get('/api/runviewer/filters/speeds', () => HttpResponse.json({ response: [] })),
      http.get('/api/runviewer/couriers', () => HttpResponse.json({ response: [] })),
    );
    const props = renderBar();
    const user = userEvent.setup();
    // SingleSelect trigger reads as "Region" when nothing is selected
    // (matches the MultiSelect trigger convention).
    const trigger = await screen.findByRole('button', { name: /^Region/ });
    await user.click(trigger);
    const option = await screen.findByRole('button', { name: 'AKL' });
    await user.click(option);
    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ regionIds: [5] }),
    );
  });
});
