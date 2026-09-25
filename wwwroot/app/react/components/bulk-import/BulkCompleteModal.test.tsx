import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderWithProviders } from '../../test/renderWithProviders';
import { BulkCompleteModal } from './BulkCompleteModal';

const env = { messageId: 'x', success: true, messages: [], isInternal: false, isUsTenant: false };

describe('BulkCompleteModal', () => {
  it('renders nothing when open=false', () => {
    renderWithProviders(
      <BulkCompleteModal open={false} onClose={vi.fn()} onCompleted={vi.fn()} />
    );
    expect(screen.queryByText('Bulk Complete')).not.toBeInTheDocument();
  });

  it('loads clients (non-internal path) and disables Search until client + jobs given', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({
          ...env,
          clients: [{ id: 1, code: 'A', name: 'Alpha', isUsTenant: false }],
        })
      )
    );
    renderWithProviders(<BulkCompleteModal open onClose={vi.fn()} onCompleted={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Bulk Complete')).toBeInTheDocument());
    const searchBtn = screen.getByRole('button', { name: /Search/ });
    // Auto-selected single client, but jobs textarea empty so still disabled.
    expect(searchBtn).toBeDisabled();
  });

  it('parses job numbers per line and counts them', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({ ...env, clients: [{ id: 1, code: 'A', name: 'A', isUsTenant: false }] })
      )
    );
    renderWithProviders(<BulkCompleteModal open onClose={vi.fn()} onCompleted={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Bulk Complete')).toBeInTheDocument());
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'J1\nJ2, 2026-07-20\nJ3, 2026-07-20, ACME01' } });
    expect(screen.getByText(/Job Numbers \(3 parsed\)/)).toBeInTheDocument();
  });

  it('switching job type radio flips state', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({ ...env, clients: [] })
      )
    );
    renderWithProviders(<BulkCompleteModal open onClose={vi.fn()} onCompleted={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Bulk Complete')).toBeInTheDocument());
    const routed = screen.getByRole('radio', { name: /Routed/ });
    const onDemand = screen.getByRole('radio', { name: /On-Demand/ });
    expect(routed).toBeChecked();
    fireEvent.click(onDemand);
    expect(onDemand).toBeChecked();
  });

  it('Search fires the /search-for-complete endpoint and renders results', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({ ...env, clients: [{ id: 1, code: 'A', name: 'A', isUsTenant: false }] })
      ),
      http.post('/api/bulk-import/search-for-complete', () =>
        HttpResponse.json({
          messageId: 'x',
          success: true,
          messages: [],
          foundJobs: [
            {
              id: 1,
              jobNumber: 'J1',
              bookDate: '2026-07-20T00:00:00',
              fromAddress: '1 A',
              fromSuburb: 'Newton',
              toAddress: '2 B',
              toSuburb: 'Ponsonby',
              courierCode: null,
              status: null,
              done: false,
              void: false,
              type: 'routed',
              canComplete: true,
              speed: null,
              clientCode: null,
              amount: null,
            },
          ],
          notFoundJobNumbers: ['J2'],
        })
      )
    );
    renderWithProviders(<BulkCompleteModal open onClose={vi.fn()} onCompleted={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'J1\nJ2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByText(/Matched Jobs \(1\)/)).toBeInTheDocument());
    expect(screen.getByText(/Not found \(1\)/)).toBeInTheDocument();
    expect(screen.getByText('J1')).toBeInTheDocument();
    expect(screen.getByText('J2')).toBeInTheDocument();
  });

  it('Complete Selected fires /bulk-complete and calls onCompleted + onClose on success', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({ ...env, clients: [{ id: 1, code: 'A', name: 'A', isUsTenant: false }] })
      ),
      http.post('/api/bulk-import/search-for-complete', () =>
        HttpResponse.json({
          messageId: 'x',
          success: true,
          messages: [],
          foundJobs: [
            {
              id: 1,
              jobNumber: 'J1',
              bookDate: '2026-07-20T00:00:00',
              fromAddress: null,
              fromSuburb: null,
              toAddress: null,
              toSuburb: null,
              courierCode: 'ACME01',
              status: null,
              done: false,
              void: false,
              type: 'routed',
              canComplete: true,
              speed: null,
              clientCode: null,
              amount: null,
            },
          ],
          notFoundJobNumbers: [],
        })
      ),
      http.post('/api/bulk-import/bulk-complete', () =>
        HttpResponse.json({ messageId: 'x', success: true, messages: [{ message: 'Done' }] })
      )
    );
    const onCompleted = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <BulkCompleteModal open onClose={onClose} onCompleted={onCompleted} />
    );
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'J1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByText(/Complete Selected \(1\)/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Complete Selected/ }));
    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('Clear Results resets state and shows Search again', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({ ...env, clients: [{ id: 1, code: 'A', name: 'A', isUsTenant: false }] })
      ),
      http.post('/api/bulk-import/search-for-complete', () =>
        HttpResponse.json({
          messageId: 'x',
          success: true,
          messages: [],
          foundJobs: [],
          notFoundJobNumbers: ['J1'],
        })
      )
    );
    renderWithProviders(<BulkCompleteModal open onClose={vi.fn()} onCompleted={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'J1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Clear Results/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Clear Results/ }));
    expect(screen.getByRole('button', { name: /Search/ })).toBeInTheDocument();
  });

  it('search fail toast when /search-for-complete throws', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({ ...env, clients: [{ id: 1, code: 'A', name: 'A', isUsTenant: false }] })
      ),
      http.post('/api/bulk-import/search-for-complete', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 })
      )
    );
    renderWithProviders(<BulkCompleteModal open onClose={vi.fn()} onCompleted={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'J1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByText(/Search failed/)).toBeInTheDocument());
  });

  it('internal user path renders ClientTypeahead instead of dropdown', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({ ...env, isInternal: true, clients: [] })
      )
    );
    // Auth defaults isInternal=false in setup.ts. Override at render time.
    const original = (window as any).__APP_USER__;
    (window as any).__APP_USER__ = { ...original, isInternal: true };
    try {
      renderWithProviders(<BulkCompleteModal open onClose={vi.fn()} onCompleted={vi.fn()} />);
      await waitFor(() =>
        expect(screen.getByPlaceholderText(/min 3 characters/i)).toBeInTheDocument()
      );
    } finally {
      (window as any).__APP_USER__ = original;
    }
  });

  it('Close button fires onClose', async () => {
    server.use(
      http.get('/api/clients', () =>
        HttpResponse.json({ ...env, clients: [] })
      )
    );
    const onClose = vi.fn();
    renderWithProviders(
      <BulkCompleteModal open onClose={onClose} onCompleted={vi.fn()} />
    );
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Close' })[0]).toBeInTheDocument());
    const closes = screen.getAllByRole('button', { name: 'Close' });
    fireEvent.click(closes[closes.length - 1]);
    expect(onClose).toHaveBeenCalled();
  });
});
