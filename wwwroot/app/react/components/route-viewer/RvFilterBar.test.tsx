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

function renderBar(overrides: Partial<Parameters<typeof RvFilterBar>[0]> = {}) {
  const value: FilterState = {
    runDate: '2026-08-13',
    clientIds: [],
    regionIds: [],
    speedIds: [],
    courierId: null,
    activeRegionsOnly: false,
    availableCouriersOnly: false,
  };
  const defaults = {
    value,
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
