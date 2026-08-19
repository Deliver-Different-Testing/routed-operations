// Smoke tests for the Historic Archive Upload page. Covers:
//   - internal-only guard hides the wizard for non-internal users
//   - landing view fetches + shows the import-history table on mount
//   - upload -> map -> commit wizard drives end-to-end against MSW
//   - after a successful commit, the history refreshes and includes the
//     new batch when the operator returns to the landing view

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { renderWithProviders } from '../test/renderWithProviders';
import HistoricArchive from './HistoricArchive';

describe('HistoricArchive page', () => {
  let originalUser: unknown;

  beforeEach(() => {
    originalUser = (window as unknown as { __APP_USER__?: unknown }).__APP_USER__;
  });

  afterEach(() => {
    if (originalUser === undefined) {
      delete (window as unknown as { __APP_USER__?: unknown }).__APP_USER__;
    } else {
      (window as unknown as { __APP_USER__?: unknown }).__APP_USER__ = originalUser;
    }
  });

  it('hides the wizard for non-internal users', () => {
    (window as unknown as { __APP_USER__?: unknown }).__APP_USER__ = { isInternal: false };
    renderWithProviders(<HistoricArchive />);
    expect(
      screen.getByText(/only available for internal staff/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Import history/i)).not.toBeInTheDocument();
  });

  it('renders the history table on mount for internal users', async () => {
    (window as unknown as { __APP_USER__?: unknown }).__APP_USER__ = { isInternal: true };
    server.use(
      http.get('/api/historic-archive/batches', () =>
        HttpResponse.json([
          {
            id: 42,
            uploadedAt: '2026-08-19T01:38:13Z',
            uploadedByContact: 1,
            uploadedByName: 'Kerran Tetley',
            fileName: 'JRMorningInsert.xls',
            tenantCode: 'otgcargo',
            rowCount: 73,
            insertedCount: 73,
            rejectedCount: 0,
            clientCodes: 'JRWHC',
            notes: 'Playwright E2E',
            importedIdStart: 1900000000,
            importedIdEnd: 1900000072,
          },
        ]),
      ),
    );

    renderWithProviders(<HistoricArchive />);

    // Summary panel appears immediately; row data lands after fetch resolves.
    await waitFor(() => expect(screen.getByText('JRMorningInsert.xls')).toBeInTheDocument());
    expect(screen.getByText(/Total imports/i)).toBeInTheDocument();
    expect(screen.getByText('#42')).toBeInTheDocument();
    expect(screen.getByText(/1900000000 - 1900000072/)).toBeInTheDocument();
    // Batch status pill (lowercase "success" as rendered by statusClass).
    expect(screen.getByText('success')).toBeInTheDocument();
  });

  it('walks landing -> upload -> map -> commit -> back-to-history', async () => {
    (window as unknown as { __APP_USER__?: unknown }).__APP_USER__ = { isInternal: true };

    let batchesCall = 0;
    server.use(
      http.get('/api/historic-archive/batches', () => {
        batchesCall++;
        if (batchesCall === 1) return HttpResponse.json([]);
        return HttpResponse.json([
          {
            id: 99,
            uploadedAt: '2026-08-19T02:00:00Z',
            uploadedByContact: 1,
            uploadedByName: 'Kerran Tetley',
            fileName: 'jr.csv',
            tenantCode: 'otgcargo',
            rowCount: 2,
            insertedCount: 2,
            rejectedCount: 0,
            clientCodes: 'JRWHC',
            notes: null,
            importedIdStart: 1900000000,
            importedIdEnd: 1900000001,
          },
        ]);
      }),
      http.post('/api/historic-archive/upload', () =>
        HttpResponse.json({
          fileName: 'jr.csv',
          headers: ['JobNumber', 'JobDate', 'ClientCode', 'Amount'],
          rows: [
            { JobNumber: 'JRK1000', JobDate: '2026-04-10', ClientCode: 'JRWHC', Amount: '22.29' },
            { JobNumber: 'JRK1001', JobDate: '2026-04-10', ClientCode: 'JRWHC', Amount: '13.41' },
          ],
          canonicalFields: ['JobNumber', 'JobDate', 'ClientCode', 'Amount'],
          requiredFields: ['JobNumber', 'JobDate', 'ClientCode'],
        }),
      ),
      http.post('/api/historic-archive/commit', () =>
        HttpResponse.json({
          batchId: 99,
          insertedCount: 2,
          rejectedCount: 0,
          importedIdStart: 1900000000,
          importedIdEnd: 1900000001,
          errors: [],
        }),
      ),
    );

    const user = userEvent.setup();
    const { container } = renderWithProviders(<HistoricArchive />);

    // Landing view - empty history, prompt to upload first file.
    await waitFor(() =>
      expect(screen.getByText(/No historic archive imports/i)).toBeInTheDocument(),
    );

    // Enter the wizard.
    await user.click(screen.getByRole('button', { name: /Upload your first file/i }));
    expect(screen.getByText(/Step 1\./i)).toBeInTheDocument();

    // Upload a fake CSV via the hidden file input.
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();
    const file = new File(['JobNumber,JobDate,ClientCode,Amount\nJRK1000,2026-04-10,JRWHC,22.29'], 'jr.csv', { type: 'text/csv' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    // Step 2 - auto-mapping caught all required fields.
    await waitFor(() => expect(screen.getByText(/Step 2\./i)).toBeInTheDocument());
    expect(screen.getByText(/Showing 2 of 2 rows/i)).toBeInTheDocument();

    // Commit.
    await user.click(screen.getByRole('button', { name: /Import 2 rows/i }));

    // Result step shows batch summary.
    await waitFor(() => expect(screen.getByText(/Import result/i)).toBeInTheDocument());
    expect(screen.getByText('99')).toBeInTheDocument();

    // Back to history refreshes and shows the new batch.
    await user.click(screen.getByRole('button', { name: /Back to history/i }));
    await waitFor(() => expect(screen.getByText('jr.csv')).toBeInTheDocument());
    expect(screen.getByText('#99')).toBeInTheDocument();
  });

  it('opens the drill-down modal on batch click and shows imported jobs', async () => {
    (window as unknown as { __APP_USER__?: unknown }).__APP_USER__ = { isInternal: true };
    server.use(
      http.get('/api/historic-archive/batches', () =>
        HttpResponse.json([
          {
            id: 7,
            uploadedAt: '2026-08-19T02:00:00Z',
            uploadedByContact: 1,
            uploadedByName: 'Kerran Tetley',
            fileName: 'seven.csv',
            tenantCode: 'otgcargo',
            rowCount: 2,
            insertedCount: 2,
            rejectedCount: 1,
            clientCodes: 'JRWHC',
            notes: null,
            importedIdStart: 1900000000,
            importedIdEnd: 1900000001,
          },
        ]),
      ),
      http.get('/api/historic-archive/batches/7', () =>
        HttpResponse.json({
          id: 7,
          uploadedAt: '2026-08-19T02:00:00Z',
          uploadedByContact: 1,
          uploadedByName: 'Kerran Tetley',
          fileName: 'seven.csv',
          tenantCode: 'otgcargo',
          rowCount: 2,
          insertedCount: 2,
          rejectedCount: 1,
          clientCodes: 'JRWHC',
          notes: null,
          importedIdStart: 1900000000,
          importedIdEnd: 1900000001,
          errors: [
            { rowIndex: 3, jobNumber: 'BAD-1', message: 'JobDate value is not a date.' },
          ],
        }),
      ),
      http.get('/api/historic-archive/batches/7/jobs', () =>
        HttpResponse.json({
          total: 2,
          limit: 50,
          offset: 0,
          rows: [
            {
              ucjbId: 1900000000, jobNumber: 'JRK-A', clientCode: 'JRWHC', clientId: null,
              jobDate: '2026-04-10T00:00:00', completedTime: null,
              amount: 22.29, courierPayment: 12.6, podName: null,
              clientRefA: null, clientRefB: null, ourRef: null, notes: null,
              deliveryCompany: "ARCHIE'S PIZZERIA", deliveryAddress: null, deliveryCity: 'NEWMARKET', deliveryPostCode: '1023',
            },
            {
              ucjbId: 1900000001, jobNumber: 'JRK-B', clientCode: 'JRWHC', clientId: null,
              jobDate: '2026-04-10T00:00:00', completedTime: null,
              amount: 13.41, courierPayment: 7.68, podName: null,
              clientRefA: null, clientRefB: null, ourRef: null, notes: null,
              deliveryCompany: 'ARIA BAY', deliveryAddress: null, deliveryCity: 'BROWNS BAY', deliveryPostCode: '630',
            },
          ],
        }),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(<HistoricArchive />);

    await waitFor(() => expect(screen.getByText('seven.csv')).toBeInTheDocument());
    // Click the batch row.
    await user.click(screen.getByText('#7'));

    // Modal title present.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Batch #7 - seven\.csv/i })).toBeInTheDocument(),
    );
    // Jobs tab is default (inserted > 0). Rows land after fetch resolves.
    await waitFor(() => expect(screen.getByText('JRK-A')).toBeInTheDocument());
    expect(screen.getByText('JRK-B')).toBeInTheDocument();
    expect(screen.getByText(/Showing 1-2 of 2/i)).toBeInTheDocument();

    // Switch to Rejected rows tab -> error surfaces from the batch-detail fetch.
    await user.click(screen.getByRole('button', { name: /Rejected rows/i }));
    expect(await screen.findByText(/JobDate value is not a date/i)).toBeInTheDocument();
    expect(screen.getByText('BAD-1')).toBeInTheDocument();
  });
});
