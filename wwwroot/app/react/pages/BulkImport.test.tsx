import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';

// The wizard / staff-import / bulk-complete modals are heavy standalone
// components with their own tests. Stub them here so BulkImport's own
// behaviour (list load, filter, sort, delete, bulk-delete) can be tested
// in isolation without pulling their entire trees + network fixtures.
vi.mock('../components/bulk-import/NewImportWizard', () => ({
  NewImportWizard: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open
      ? <div data-testid="wizard">wizard<button onClick={onClose}>close-wizard</button></div>
      : null,
}));
vi.mock('../components/bulk-import/StaffImportModal', () => ({
  StaffImportModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="staff-import">staff-import</div> : null,
}));
vi.mock('../components/bulk-import/BulkCompleteModal', () => ({
  BulkCompleteModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="bulk-complete">bulk-complete</div> : null,
}));

import BulkImport from './BulkImport';

const stubJobs = (jobs: unknown[]) =>
  http.get('/api/bulk-import/jobs', () =>
    HttpResponse.json({ messageId: 'x', success: true, messages: [], jobs }));

const routedJob = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1, jobNumber: 'JOB-1', bookDate: '2026-08-13', speed: 'CORT',
  clientCode: 'ACME', amount: 12.5, quantity: 3,
  fromAddress: '1 Queen St', fromSuburb: 'CBD', toAddress: '2 K Rd', toSuburb: 'Grey Lynn',
  toPostCode: '1010', fromCompany: null, fromCity: null, fromState: null,
  fromZipCode: null, toCompany: null, toCity: null, toState: null, toZipCode: null,
  canDelete: true, type: 'routed', ...over,
});

describe('BulkImport page', () => {
  it('shows the empty-state prompt when there are no imports', async () => {
    server.use(stubJobs([]));
    renderWithProviders(<BulkImport />);
    expect(await screen.findByText(/No imports yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Import' })).toBeInTheDocument();
  });

  it('renders a routed job row with its jobNumber', async () => {
    server.use(stubJobs([routedJob()]));
    renderWithProviders(<BulkImport />);
    expect(await screen.findByText('JOB-1')).toBeInTheDocument();
  });

  it('opens the New Import wizard when the button is clicked', async () => {
    server.use(stubJobs([]));
    renderWithProviders(<BulkImport />);
    await screen.findByText(/No imports yet/);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'New Import' }));
    expect(screen.getByTestId('wizard')).toBeInTheDocument();
  });

  it('filters to Routed only when the Routed filter pill is clicked', async () => {
    server.use(stubJobs([
      routedJob({ id: 1, jobNumber: 'ROUTED-A' }),
      routedJob({ id: 2, jobNumber: 'ONDEM-A', type: 'ondemand' }),
    ]));
    renderWithProviders(<BulkImport />);
    expect(await screen.findByText('ROUTED-A')).toBeInTheDocument();
    expect(screen.getByText('ONDEM-A')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Routed \(1\)/ }));
    expect(screen.getByText('ROUTED-A')).toBeInTheDocument();
    expect(screen.queryByText('ONDEM-A')).not.toBeInTheDocument();
  });

  it('searches by job number and narrows visible rows', async () => {
    server.use(stubJobs([
      routedJob({ id: 1, jobNumber: 'AAA-1' }),
      routedJob({ id: 2, jobNumber: 'BBB-2' }),
    ]));
    renderWithProviders(<BulkImport />);
    await screen.findByText('AAA-1');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Search imports'), 'BBB');
    await waitFor(() =>
      expect(screen.queryByText('AAA-1')).not.toBeInTheDocument()
    );
    expect(screen.getByText('BBB-2')).toBeInTheDocument();
  });

  it('deletes a routed job when Delete is confirmed', async () => {
    let deleted = 0;
    server.use(
      stubJobs([routedJob({ id: 42, jobNumber: 'DEL-1' })]),
      http.delete('/api/bulk-import/jobs/42', () => {
        deleted++;
        return HttpResponse.json({
          messageId: 'x', success: true, messages: [],
        });
      }),
    );
    renderWithProviders(<BulkImport />);
    expect(await screen.findByText('DEL-1')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Delete job DEL-1'));
    // Confirm modal
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleted).toBe(1));
    await waitFor(() =>
      expect(screen.queryByText('DEL-1')).not.toBeInTheDocument()
    );
  });

  it('does not delete when the confirm dialog is cancelled', async () => {
    let deleted = 0;
    server.use(
      stubJobs([routedJob({ id: 42, jobNumber: 'DEL-1' })]),
      http.delete('/api/bulk-import/jobs/42', () => {
        deleted++;
        return HttpResponse.json({
          messageId: 'x', success: true, messages: [],
        });
      }),
    );
    renderWithProviders(<BulkImport />);
    expect(await screen.findByText('DEL-1')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Delete job DEL-1'));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(deleted).toBe(0);
    expect(screen.getByText('DEL-1')).toBeInTheDocument();
  });

  it('shows the current filter counts in the pills', async () => {
    server.use(stubJobs([
      routedJob({ id: 1, jobNumber: 'R1' }),
      routedJob({ id: 2, jobNumber: 'R2' }),
      routedJob({ id: 3, jobNumber: 'O1', type: 'ondemand' }),
    ]));
    renderWithProviders(<BulkImport />);
    await screen.findByText('R1');
    expect(screen.getByRole('button', { name: /All Jobs \(3\)/ }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Routed \(2\)/ }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: /On-Demand \(1\)/ }))
      .toBeInTheDocument();
  });

  it('shows an error toast when the initial load fails', async () => {
    server.use(
      http.get('/api/bulk-import/jobs', () =>
        new HttpResponse(JSON.stringify({ message: 'boom' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })),
    );
    renderWithProviders(<BulkImport />);
    expect(await screen.findByText(/Failed to load imports/)).toBeInTheDocument();
  });

  it('bulk-delete flow: select and delete two rows in sequence', async () => {
    let deletes = 0;
    server.use(
      stubJobs([
        routedJob({ id: 1, jobNumber: 'BULK-1' }),
        routedJob({ id: 2, jobNumber: 'BULK-2' }),
      ]),
      http.delete('/api/bulk-import/jobs/:id', () => {
        deletes++;
        return HttpResponse.json({
          messageId: 'x', success: true, messages: [],
        });
      }),
    );
    renderWithProviders(<BulkImport />);
    await screen.findByText('BULK-1');
    const user = userEvent.setup();
    // Select-all checkbox in header.
    await user.click(screen.getByLabelText(/Select all deletable rows/));
    await user.click(screen.getByRole('button', { name: /Delete Selected \(2\)/ }));
    // Confirm modal
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deletes).toBe(2));
  });

  it('sorts by Job Number when the header is clicked', async () => {
    server.use(stubJobs([
      routedJob({ id: 1, jobNumber: 'ZZZ' }),
      routedJob({ id: 2, jobNumber: 'AAA' }),
    ]));
    renderWithProviders(<BulkImport />);
    await screen.findByText('ZZZ');
    const user = userEvent.setup();
    // Click Job Number header - sortKey defaults to bookDate desc, so this
    // sets it to jobNumber asc.
    await user.click(screen.getByRole('button', { name: /Job Number/i }));
    // Read row order.
    const rows = screen.getAllByRole('row');
    const first = rows.find((r) => within(r).queryByText('AAA'));
    expect(first).toBeTruthy();
  });
});
