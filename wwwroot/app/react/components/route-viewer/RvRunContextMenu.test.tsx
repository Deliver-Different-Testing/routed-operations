import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { RvRunContextMenu } from './RvRunContextMenu';

function renderMenu(over: Partial<Parameters<typeof RvRunContextMenu>[0]> = {}) {
  const defaults = {
    x: 100,
    y: 100,
    runId: 42,
    runDate: '2026-08-13',
    // Default = Combined so the pre-refactor tests (which do not care
    // about direction filtering) keep matching every job the run
    // fetch returns. Direction-scoped tests override this.
    viewMode: 'Combined' as const,
    onClose: vi.fn(),
    onDone: vi.fn(),
  };
  const props = { ...defaults, ...over };
  renderWithProviders(<RvRunContextMenu {...props} />);
  return props;
}

describe('RvRunContextMenu', () => {
  beforeEach(() => {
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      isNetworkPartner: false,
    };
  });

  it('renders admin items (Assign Route, Transfer Route, Unassign, etc.)', () => {
    renderMenu();
    expect(screen.getByText('Assign Route')).toBeInTheDocument();
    expect(screen.getByText('Transfer Route')).toBeInTheDocument();
    expect(screen.getByText('Pre-assign Run')).toBeInTheDocument();
    expect(screen.getByText('Release Run')).toBeInTheDocument();
    expect(screen.getByText('Create Courier Event')).toBeInTheDocument();
    // Unassign section: Courier, Agent, Network Partner
    expect(screen.getByText('Courier')).toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText('Network Partner')).toBeInTheDocument();
  });

  it('renders "Assign Courier" for NP + hides Transfer Route', () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, isNetworkPartner: true };
    renderMenu();
    expect(screen.getByText('Assign Courier')).toBeInTheDocument();
    expect(screen.queryByText('Transfer Route')).toBeNull();
  });

  it('disables Pre-assign Run for negative runId', () => {
    renderMenu({ runId: -5 });
    const btn = screen.getByText('Pre-assign Run').closest('button')!;
    expect(btn).toBeDisabled();
  });

  it('opens Assign dialog on Assign Route click', async () => {
    // Post 2026-09-18 legacy-pattern port: RvRunContextMenu fetches the
    // run's jobs itself and filters by viewMode before opening the
    // dialog with pre-scoped jobIds. Stub both the runs/jobs fetch and
    // the courier search so the dialog renders once the async fetch
    // resolves.
    server.use(
      http.get('/api/runviewer/runs/:runId/jobs', () =>
        HttpResponse.json({ response: [{ jobId: 100 }, { jobId: 200 }] })),
      http.get('/api/runviewer/couriers/search', () =>
        HttpResponse.json({ response: [] })),
    );
    renderMenu();
    const user = userEvent.setup();
    await user.click(screen.getByText('Assign Route'));
    expect(await screen.findByPlaceholderText(/Search couriers/)).toBeInTheDocument();
  });

  it('opens Transfer dialog on Transfer Route click', async () => {
    server.use(
      http.get('/api/runviewer/routes/active', () =>
        HttpResponse.json({ response: [] })),
    );
    renderMenu();
    const user = userEvent.setup();
    await user.click(screen.getByText('Transfer Route'));
    await waitFor(() =>
      expect(screen.getByText('Transfer route')).toBeInTheDocument(),
    );
  });

  it('closes on Escape key', async () => {
    const props = renderMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
  });

  it('closes on outside mousedown', async () => {
    const props = renderMenu();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
  });

  it('shows Validate Route toast (pending) + closes menu', async () => {
    const props = renderMenu();
    const user = userEvent.setup();
    await user.click(screen.getByText('Validate Route'));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('fires pre-assign flow when confirmed + prompt provides courier code', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('ACE');
    let hit = 0;
    server.use(
      http.post('/api/runviewer/jobs/preassign-run', () => {
        hit++;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    const props = renderMenu({ runId: 3 });
    const user = userEvent.setup();
    await user.click(screen.getByText('Pre-assign Run'));
    // Confirm dialog opens
    const confirmBtn = await screen.findByRole('button', { name: 'OK' });
    await user.click(confirmBtn);
    await waitFor(() => expect(hit).toBe(1));
    expect(props.onDone).toHaveBeenCalled();
  });

  it('aborts pre-assign when confirm cancelled', async () => {
    let hit = 0;
    server.use(
      http.post('/api/runviewer/jobs/preassign-run', () => {
        hit++;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    renderMenu({ runId: 3 });
    const user = userEvent.setup();
    await user.click(screen.getByText('Pre-assign Run'));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(hit).toBe(0);
  });

  it('sends SMS to run when prompted + POST succeeds', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('Delayed');
    let hit = 0;
    server.use(
      http.post('/api/runviewer/jobs/send-sms-run', () => {
        hit++;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    renderMenu();
    const user = userEvent.setup();
    await user.click(screen.getByText(/Send SMS to run/));
    await waitFor(() => expect(hit).toBe(1));
  });

  it('aborts SMS when prompt cancelled', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce(null);
    let hit = 0;
    server.use(
      http.post('/api/runviewer/jobs/send-sms-run', () => {
        hit++;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    renderMenu();
    const user = userEvent.setup();
    await user.click(screen.getByText(/Send SMS to run/));
    expect(hit).toBe(0);
  });
});
