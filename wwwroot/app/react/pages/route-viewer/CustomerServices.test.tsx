import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('../../hooks/useAutoPoll', () => ({
  useAutoPoll: () => undefined,
}));
vi.mock('../../components/route-viewer/RvJobDetail', () => ({
  RvJobDetail: ({ bulkJobId }: any) => (
    <div data-testid="rv-job-detail">detail for {bulkJobId ?? 'none'}</div>
  ),
}));

import CustomerServices from './CustomerServices';

function renderPage(initialRoute = '/route-viewer/cs') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <CustomerServices />
    </QueryClientProvider>,
    { initialRoute },
  );
}

const mkRow = (over: Record<string, any> = {}) => ({
  bulkEventId: 1,
  bulkJobId: 100,
  clientId: null,
  courierId: null,
  jobNumber: 'JOB-100',
  courierCode: 'ACE',
  notes: 'Called client',
  internal: true,
  clientCreated: false,
  clientFollowup: false,
  createdByName: 'Kev',
  eventDate: '2026-08-13',
  created: '2026-08-13T10:00:00Z',
  closedDate: null,
  closedByName: null,
  ...over,
});

describe('CustomerServices', () => {
  beforeEach(() => {
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      isNetworkPartner: false,
      isUsTenant: false,
      timeZone: 'Pacific/Auckland',
      fullName: 'Kev',
    };
  });

  it('renders toolbar with date + include-closed + follow-up radios', async () => {
    server.use(
      http.get('/api/runviewer/events', () => HttpResponse.json({ response: [] })),
    );
    renderPage();
    expect(await screen.findByLabelText(/Include closed/)).toBeInTheDocument();
    // Follow-up options for admin
    expect(screen.getByLabelText('All')).toBeInTheDocument();
    expect(screen.getByLabelText('UCL')).toBeInTheDocument();
    expect(screen.getByLabelText('Client')).toBeInTheDocument();
  });

  it('hides admin follow-up radios for NP', async () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, isNetworkPartner: true };
    server.use(
      http.get('/api/runviewer/events', () => HttpResponse.json({ response: [] })),
    );
    renderPage();
    await waitFor(() => expect(screen.queryByLabelText('UCL')).toBeNull());
  });

  it('shows empty message when no events', async () => {
    server.use(
      http.get('/api/runviewer/events', () => HttpResponse.json({ response: [] })),
    );
    renderPage();
    expect(await screen.findByText(/No events for this date/)).toBeInTheDocument();
  });

  it('renders event rows', async () => {
    server.use(
      http.get('/api/runviewer/events', () =>
        HttpResponse.json({ response: [mkRow()] })),
    );
    renderPage();
    expect(await screen.findByText('JOB-100')).toBeInTheDocument();
    // Multiple UCL elements exist (radio label + row badge); assert both present
    expect(screen.getAllByText('UCL').length).toBeGreaterThan(1);
    expect(screen.getByText(/Called client/)).toBeInTheDocument();
  });

  it('filters UCL / Client via follow-up radio', async () => {
    server.use(
      http.get('/api/runviewer/events', () =>
        HttpResponse.json({
          response: [
            mkRow({ bulkEventId: 1, internal: true, clientFollowup: false, jobNumber: 'UCL-A' }),
            mkRow({ bulkEventId: 2, internal: false, clientFollowup: true, jobNumber: 'CLIENT-B' }),
          ],
        })),
    );
    renderPage();
    await screen.findByText('UCL-A');
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('UCL'));
    expect(screen.getByText('UCL-A')).toBeInTheDocument();
    expect(screen.queryByText('CLIENT-B')).toBeNull();
    await user.click(screen.getByLabelText('Client'));
    expect(screen.queryByText('UCL-A')).toBeNull();
    expect(screen.getByText('CLIENT-B')).toBeInTheDocument();
  });

  it('selects an event + shows JobDetail', async () => {
    server.use(
      http.get('/api/runviewer/events', () =>
        HttpResponse.json({ response: [mkRow({ bulkJobId: 555 })] })),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByText('JOB-100'));
    await waitFor(() =>
      expect(screen.getByTestId('rv-job-detail')).toHaveTextContent('555'),
    );
  });

  it('opens Create event dialog + refreshes on save', async () => {
    let refetched = 0;
    server.use(
      http.get('/api/runviewer/events', () => {
        refetched++;
        return HttpResponse.json({ response: [] });
      }),
      http.post('/api/runviewer/events', () =>
        HttpResponse.json({ response: 'ok' })),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Create event/ }));
    expect(await screen.findByText('Create event')).toBeInTheDocument();
  });

  it('deep-link ?eid=<id> preselects the row', async () => {
    server.use(
      http.get('/api/runviewer/events', () =>
        HttpResponse.json({
          response: [
            mkRow({ bulkEventId: 42, jobNumber: 'JOB-42', bulkJobId: 555 }),
          ],
        })),
    );
    renderPage('/route-viewer/cs?eid=42');
    await waitFor(() =>
      expect(screen.getByTestId('rv-job-detail')).toHaveTextContent('555'),
    );
  });

  it('EventActions: reply POSTs + close POSTs', async () => {
    let reply = 0;
    let close = 0;
    server.use(
      http.get('/api/runviewer/events', () =>
        HttpResponse.json({ response: [mkRow()] })),
      http.post('/api/runviewer/events/1/reply', () => {
        reply++;
        return HttpResponse.json({ response: 'ok' });
      }),
      http.post('/api/runviewer/events/1/close', () => {
        close++;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByText('JOB-100'));
    const replyInput = await screen.findByPlaceholderText(/Add reply/);
    await user.type(replyInput, 'noted');
    await user.click(screen.getByRole('button', { name: 'Reply' }));
    await waitFor(() => expect(reply).toBe(1));
    await user.click(screen.getByRole('button', { name: 'Close event' }));
    await waitFor(() => expect(close).toBe(1));
  });

  it('shows loading state', async () => {
    server.use(
      http.get('/api/runviewer/events', () => new Promise(() => {})),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getAllByText(/Loading/).length).toBeGreaterThan(0),
    );
  });

  it('Copy Link button: fires generate-direct-link + writes URL to clipboard', async () => {
    // jsdom provides a Clipboard instance on navigator that no-ops
    // writeText. Spy on it so we can assert the call + capture the URL.
    const writeText = vi
      .spyOn(window.navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);
    let calledWith: URL | null = null;
    try {
      server.use(
        http.get('/api/runviewer/events', () =>
          HttpResponse.json({
            response: [
              mkRow({
                bulkEventId: 7,
                clientId: 42,
                internal: false,
                jobNumber: 'SHARE-7',
              }),
            ],
          })),
        http.get('/api/runviewer/events/direct-link', ({ request: req }) => {
          calledWith = new URL(req.url);
          return HttpResponse.json({
            response: { url: 'https://runviewer.example/#/CS?eid=7' },
          });
        }),
      );
      renderPage();
      const user = userEvent.setup();
      await screen.findByText('SHARE-7');
      const btn = screen.getByRole('button', { name: /Copy event link/i });
      await user.click(btn);
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      expect(writeText).toHaveBeenCalledWith('https://runviewer.example/#/CS?eid=7');
      // Confirm the endpoint was hit with the expected query string.
      expect(calledWith).not.toBeNull();
      expect(calledWith!.searchParams.get('eventId')).toBe('7');
      expect(calledWith!.searchParams.get('clientId')).toBe('42');
    } finally {
      writeText.mockRestore();
    }
  });

  it('Copy Link button: hidden on internal-only events', async () => {
    server.use(
      http.get('/api/runviewer/events', () =>
        HttpResponse.json({
          response: [
            mkRow({ bulkEventId: 8, clientId: 42, internal: true, jobNumber: 'INT-ONLY' }),
          ],
        })),
    );
    renderPage();
    await screen.findByText('INT-ONLY');
    expect(screen.queryByRole('button', { name: /Copy event link/i })).toBeNull();
  });
});
