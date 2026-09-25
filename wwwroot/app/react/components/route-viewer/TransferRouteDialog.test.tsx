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

  it('proceeds to confirm step + submits transfer with backend field names', async () => {
    // Regression guard: the backend DTO expects `newRouteId` /
    // `alsoTransferRecurringBooking` / `alsoTransferZipCodes` - the
    // ergonomic props (`toRouteId` / `transferBooking` /
    // `transferZipcodes`) live only inside the service wrapper. If
    // they leak onto the wire the backend silently drops them +
    // defaults NewRouteId=0 which trips the ">0" guard and 400s.
    // Response uses TransferRouteResult shape (succeeded /
    // bookingsAffected / zipCodesMoved).
    let sent: any = null;
    server.use(
      stubRoutes([{ routeId: 200, label: 'North' }]),
      http.post('/api/runviewer/jobs/transfer-route', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({
          response: {
            succeeded: 5, failed: 0, rowsUpdated: 5,
            bookingsAffected: 2, bookingRowsUpdated: 6,
            zipCodesMoved: 3, zipMappingsInserted: 3, zipMappingsDeleted: 0,
            zipCodes: [], families: [], errors: [],
            newRouteId: 200, newRouteName: 'North',
            alsoTransferredRecurringBooking: true, alsoTransferredZipCodes: true,
          },
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
    // Wire shape MUST match the backend DTO exactly.
    expect(sent.newRouteId).toBe(200);
    expect(sent.alsoTransferRecurringBooking).toBe(true);
    expect(sent.alsoTransferZipCodes).toBe(true);
    // Ergonomic names must NOT leak onto the wire.
    expect(sent.toRouteId).toBeUndefined();
    expect(sent.transferBooking).toBeUndefined();
    expect(sent.transferZipcodes).toBeUndefined();
    // Success rollup reads the correct TransferRouteResult fields.
    expect(vi.mocked(props.onSuccess).mock.calls[0][0]).toMatch(/5 jobs.*2 bookings.*3 zipcodes/);
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

  it('confirm-step preview table renders one row per supplied job with red from-route + green to-route', async () => {
    server.use(stubRoutes([{ routeId: 200, label: 'North' }]));
    const jobs = [
      { jobId: 11, jobNumber: 'JB-11', fromAddress: '1 Alpha St',  currentRouteName: 'Old East' },
      { jobId: 12, jobNumber: 'JB-12', fromAddress: '2 Bravo Rd',  currentRouteName: 'Old East' },
      { jobId: 13, jobNumber: null,    fromAddress: null,          currentRouteName: null       },
    ];
    renderDlg({ runId: 100, jobs });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByRole('combobox'), '200');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    const table = await screen.findByTestId('transfer-preview-table');
    const bodyRows = table.querySelectorAll('tbody tr');
    expect(bodyRows.length).toBe(3);

    // Row 1 - fully populated: Job # + from-address, from-route red, to-route green.
    const r1 = bodyRows[0].querySelectorAll('td');
    expect(r1[0].textContent).toBe('JB-11');
    expect(r1[1].textContent).toBe('1 Alpha St');
    expect(r1[2].textContent).toBe('Old East');
    expect(r1[2].className).toContain('text-error');
    expect(r1[3].textContent).toBe('North');
    expect(r1[3].className).toContain('text-success');

    // Row 3 - fallbacks: '#<jobId>' for missing job number, 'unassigned' for null route.
    const r3 = bodyRows[2].querySelectorAll('td');
    expect(r3[0].textContent).toBe('#13');
    expect(r3[1].textContent).toBe('-');
    expect(r3[2].textContent).toBe('unassigned');
    expect(r3[2].className).toContain('text-error');
    expect(r3[3].textContent).toBe('North');
    expect(r3[3].className).toContain('text-success');
  });

  it('run-scoped path (no jobs prop) fetches run jobs via runDate and renders them', async () => {
    server.use(
      stubRoutes([{ routeId: 200, label: 'North' }]),
      http.get('/api/runviewer/runs/100/jobs', () =>
        HttpResponse.json({
          response: [
            {
              // Only fields the preview table touches need real values;
              // the rest match the BulkJob shape defaults so unwrap<T[]>
              // stays happy.
              jobId: 21,
              jobNumber: 'RN-21',
              fromAddress: '9 Cascade Ave',
              runName: 'Run 100',
            },
          ],
        }),
      ),
    );
    renderDlg({ runId: 100, runDate: '2026-08-14' });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByRole('combobox'), '200');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    const table = await screen.findByTestId('transfer-preview-table');
    // Wait for the fetched row (initially "Loading jobs..." then row).
    await waitFor(() => {
      const cells = table.querySelectorAll('tbody tr td');
      expect(cells.length).toBeGreaterThanOrEqual(4);
      expect(cells[0].textContent).toBe('RN-21');
    });
    const cells = table.querySelectorAll('tbody tr td');
    expect(cells[1].textContent).toBe('9 Cascade Ave');
    expect(cells[2].textContent).toBe('Run 100');
    expect(cells[2].className).toContain('text-error');
    expect(cells[3].textContent).toBe('North');
    expect(cells[3].className).toContain('text-success');
  });

  it('run-scoped path with no runDate + no jobs shows empty-state message', async () => {
    server.use(stubRoutes([{ routeId: 200, label: 'North' }]));
    renderDlg({ runId: 100 });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByRole('combobox'), '200');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    const table = await screen.findByTestId('transfer-preview-table');
    expect(table.textContent).toContain('No jobs to display');
  });
});
