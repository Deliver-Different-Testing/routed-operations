import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { TransferRouteDialog } from './TransferRouteDialog';

const stubRoutes = (rows: Array<{ routeId: number; label: string }>) =>
  http.get('/api/runviewer/routes/active', () =>
    HttpResponse.json({ response: rows }),
  );

function renderDlg(props: Partial<Parameters<typeof TransferRouteDialog>[0]> = {}) {
  const defaults = {
    runId: 100,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  };
  const merged = { ...defaults, ...props };
  renderWithProviders(<TransferRouteDialog {...merged} />);
  return merged;
}

describe('TransferRouteDialog', () => {
  it('renders loading initially', () => {
    server.use(stubRoutes([{ routeId: 200, label: 'B' }]));
    renderDlg();
    expect(screen.getByText(/Loading routes/)).toBeInTheDocument();
  });

  it('lists routes (excluding current runId) after fetch', async () => {
    server.use(stubRoutes([
      { routeId: 100, label: 'Current' },
      { routeId: 200, label: 'North' },
      { routeId: 201, label: 'South' },
    ]));
    renderDlg({ runId: 100 });
    // 100 is excluded
    expect(await screen.findByRole('option', { name: 'North' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'South' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Current' })).toBeNull();
  });

  it('Next button disabled until a route is picked', async () => {
    server.use(stubRoutes([{ routeId: 200, label: 'North' }]));
    renderDlg();
    await screen.findByRole('option', { name: 'North' });
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('proceeds to confirm step + submits transfer', async () => {
    let sent: any = null;
    server.use(
      stubRoutes([{ routeId: 200, label: 'North' }]),
      http.post('/api/runviewer/jobs/transfer-route', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({
          response: { transferred: 5, bookings: 2, zipcodes: 3 },
        });
      }),
    );
    const props = renderDlg({ runId: 100 });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByRole('combobox'), '200');
    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]); // transferBooking
    await user.click(checkboxes[1]); // transferZipcodes
    await user.click(screen.getByRole('button', { name: 'Next' }));
    // Confirm banner
    expect(await screen.findByText(/Run #100/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Transfer' }));
    await waitFor(() => expect(props.onSuccess).toHaveBeenCalled());
    expect(sent.toRouteId).toBe(200);
    expect(sent.transferBooking).toBe(true);
    expect(sent.transferZipcodes).toBe(true);
  });

  it('back button returns from confirm to pick step', async () => {
    server.use(stubRoutes([{ routeId: 200, label: 'North' }]));
    renderDlg();
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByRole('combobox'), '200');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('button', { name: /Back/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Back/ }));
    // Back to pick step: Next visible again
    expect(await screen.findByRole('button', { name: 'Next' })).toBeInTheDocument();
  });

  it('shows error on server 500 in fetch', async () => {
    server.use(
      http.get('/api/runviewer/routes/active', () =>
        HttpResponse.json({ messages: [{ message: 'no routes' }] }, { status: 500 }),
      ),
    );
    renderDlg();
    expect(await screen.findByText(/no routes/)).toBeInTheDocument();
  });

  it('cancel triggers onClose', async () => {
    server.use(stubRoutes([]));
    const props = renderDlg();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('surfaces error on transfer POST 500', async () => {
    server.use(
      stubRoutes([{ routeId: 200, label: 'North' }]),
      http.post('/api/runviewer/jobs/transfer-route', () =>
        HttpResponse.json({ messages: [{ message: 'transfer boom' }] }, { status: 500 }),
      ),
    );
    renderDlg();
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByRole('combobox'), '200');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(await screen.findByRole('button', { name: 'Transfer' }));
    expect(await screen.findByText(/transfer boom/)).toBeInTheDocument();
  });
});
