import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { TopUpDialog } from './TopUpDialog';

const stubServices = (rows: Array<{ id: number; label: string }> = [{ id: 1, label: 'FRT' }]) =>
  http.get('/api/runviewer/filters/topup-services', () =>
    HttpResponse.json({ response: rows }),
  );
const stubCouriers = (
  rows: Array<{ courierId: number; code: string; name: string }> = [],
) =>
  http.get('/api/runviewer/couriers/search', () =>
    HttpResponse.json({ response: rows }),
  );

function renderDlg(props: Partial<Parameters<typeof TopUpDialog>[0]> = {}) {
  const defaults = {
    jobId: 5,
    jobNumber: 'JOB-5',
    onClose: vi.fn(),
    onBooked: vi.fn(),
  };
  const merged = { ...defaults, ...props };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderWithProviders(
    <QueryClientProvider client={client}>
      <TopUpDialog {...merged} />
    </QueryClientProvider>,
  );
  return merged;
}

describe('TopUpDialog', () => {
  beforeEach(() => {
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      isUsTenant: false,
      fullName: 'Kev',
    };
    server.use(stubServices(), stubCouriers());
  });

  it('renders with jobNumber', () => {
    renderDlg({ jobNumber: 'ABC' });
    expect(screen.getByText('ABC')).toBeInTheDocument();
  });

  it('shows US friction note when US tenant', () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, isUsTenant: true };
    renderDlg();
    expect(screen.getByText(/NZ-only today/)).toBeInTheDocument();
  });

  it('Book button disabled when amount out of range', async () => {
    renderDlg();
    const user = userEvent.setup();
    const amount = screen.getByLabelText(/Amount/);
    await user.clear(amount);
    await user.type(amount, '500');
    expect(await screen.findByText(/Must be between 1 and 200/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Book Top Up/ })).toBeDisabled();
  });

  it('Book disabled while service unpicked', async () => {
    renderDlg();
    expect(screen.getByRole('button', { name: /Book Top Up/ })).toBeDisabled();
  });

  it('searches couriers when 2+ chars typed', async () => {
    let hit = 0;
    server.use(
      stubServices(),
      http.get('/api/runviewer/couriers/search', () => {
        hit++;
        return HttpResponse.json({
          response: [{ courierId: 1, code: 'KEV', name: 'Kev T' }],
        });
      }),
    );
    renderDlg();
    const user = userEvent.setup();
    const input = screen.getByPlaceholderText(/Type 2\+ chars/);
    await user.type(input, 'ke');
    await waitFor(() => expect(hit).toBeGreaterThan(0));
    expect(await screen.findByText('Kev T (KEV)')).toBeInTheDocument();
  });

  it('picks a courier + enables Book after all fields set', async () => {
    server.use(
      stubServices([{ id: 7, label: 'FRT' }]),
      http.get('/api/runviewer/couriers/search', () =>
        HttpResponse.json({
          response: [{ courierId: 3, code: 'ACE', name: 'Ace' }],
        }),
      ),
    );
    renderDlg();
    const user = userEvent.setup();
    // pick service
    await screen.findByRole('option', { name: 'FRT' });
    const combos = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const service = combos.find((c) => c.innerHTML.includes('FRT'))!;
    await user.selectOptions(service, '7');
    // search + pick courier
    await user.type(screen.getByPlaceholderText(/Type 2\+ chars/), 'ac');
    const courier = await screen.findByRole('button', { name: /Ace \(ACE\)/ });
    await user.click(courier);
    // now Book is enabled
    expect(screen.getByRole('button', { name: /Book Top Up/ })).not.toBeDisabled();
  });

  it('submits + calls onBooked', async () => {
    server.use(
      stubServices([{ id: 7, label: 'FRT' }]),
      http.get('/api/runviewer/couriers/search', () =>
        HttpResponse.json({
          response: [{ courierId: 3, code: 'ACE', name: 'Ace' }],
        }),
      ),
      http.post('/api/runviewer/booking/top-up', () =>
        HttpResponse.json({ response: 'ok' }),
      ),
    );
    const props = renderDlg();
    const user = userEvent.setup();
    // Wait for the FRT option to render (async fetch)
    await screen.findByRole('option', { name: 'FRT' });
    const combos = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const serviceCombo = combos.find((c) => c.innerHTML.includes('FRT'))!;
    await user.selectOptions(serviceCombo, '7');
    await user.type(screen.getByPlaceholderText(/Type 2\+ chars/), 'ac');
    await user.click(await screen.findByRole('button', { name: /Ace \(ACE\)/ }));
    await user.click(screen.getByRole('button', { name: /Book Top Up/ }));
    await waitFor(() => expect(props.onBooked).toHaveBeenCalled());
  });

  it('shows error on 500', async () => {
    server.use(
      stubServices([{ id: 7, label: 'FRT' }]),
      http.get('/api/runviewer/couriers/search', () =>
        HttpResponse.json({
          response: [{ courierId: 3, code: 'ACE', name: 'Ace' }],
        }),
      ),
      http.post('/api/runviewer/booking/top-up', () =>
        HttpResponse.json({ messages: [{ message: 'boom' }] }, { status: 500 }),
      ),
    );
    renderDlg();
    const user = userEvent.setup();
    // Wait for the FRT option to render (async fetch)
    await screen.findByRole('option', { name: 'FRT' });
    const combos = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const serviceCombo = combos.find((c) => c.innerHTML.includes('FRT'))!;
    await user.selectOptions(serviceCombo, '7');
    await user.type(screen.getByPlaceholderText(/Type 2\+ chars/), 'ac');
    await user.click(await screen.findByRole('button', { name: /Ace \(ACE\)/ }));
    await user.click(screen.getByRole('button', { name: /Book Top Up/ }));
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });

  it('cancel calls onClose', async () => {
    const props = renderDlg();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalled();
  });
});
