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
      http.get('/api/runviewer/runs/:runId/jobs', () =>
        HttpResponse.json({ response: [{ jobId: 100 }] })),
      http.get('/api/runviewer/routes/active', () =>
        HttpResponse.json({ response: { currentRouteId: null, currentRouteName: null, routes: [] } })),
    );
    renderMenu();
    const user = userEvent.setup();
    await user.click(screen.getByText('Transfer Route'));
    await waitFor(() =>
      expect(screen.getByText('Transfer route')).toBeInTheDocument(),
    );
  });

  // #1001 comment / Steve D4: run-level actions act on what is on screen.
  it('Assign Route on another run fetches with the full on-screen filter set', async () => {
    let seenUrl = '';
    server.use(
      http.get('/api/runviewer/runs/:runId/jobs', ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json({ response: [{ jobId: 100 }] });
      }),
      http.get('/api/runviewer/couriers/search', () => HttpResponse.json({ response: [] })),
    );
    renderMenu({
      runId: -15,
      filters: { group: 'Combined', regionIds: [3], speedIds: [423], clientIds: [85], courierId: 20 },
    });
    const user = userEvent.setup();
    await user.click(screen.getByText('Assign Route'));
    await screen.findByPlaceholderText(/Search couriers/);
    const q = new URL(seenUrl).searchParams;
    expect(q.get('group')).toBe('Combined');
    expect(q.get('regionIds')).toBe('3');
    expect(q.get('speedIds')).toBe('423');
    expect(q.get('clientIds')).toBe('85');
    expect(q.get('courierId')).toBe('20');
  });

  it('uses the visible job ids for the run on screen and does not refetch', async () => {
    // Burbank to Lab with the Will Call filter: the grid shows 2 jobs,
    // the unfiltered run has ~40. The menu must act on the 2.
    // (The ids themselves are asserted on the wire in the Transfer Route
    // test below; this one proves the unfiltered fetch is skipped.)
    let fetched = false;
    server.use(
      http.get('/api/runviewer/runs/:runId/jobs', () => {
        fetched = true;
        return HttpResponse.json({ response: [] });
      }),
      http.get('/api/runviewer/couriers/search', () => HttpResponse.json({ response: [] })),
    );
    renderMenu({ runId: -15, visibleJobIds: [20857, 20866] });
    const user = userEvent.setup();
    await user.click(screen.getByText('Assign Route'));
    expect(await screen.findByPlaceholderText(/Search couriers/)).toBeInTheDocument();
    expect(fetched).toBe(false);
  });

  it('run-menu Transfer Route hands the scoped ids to the dialog (no empty-list 400)', async () => {
    let sent: any = null;
    server.use(
      http.get('/api/runviewer/routes/active', () =>
        HttpResponse.json({ response: { currentRouteId: null, currentRouteName: null, routes: [{ id: 5, name: 'RNO200', area: null }] } })),
      http.post('/api/runviewer/jobs/transfer-route', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ response: { succeeded: 2, failed: 0, rowsUpdated: 2, bookingsAffected: 0, zipCodesMoved: 0, errors: [] } });
      }),
    );
    const props = renderMenu({ runId: -15, visibleJobIds: [20857, 20866] });
    const user = userEvent.setup();
    await user.click(screen.getByText('Transfer Route'));
    await user.selectOptions(await screen.findByRole('combobox'), '5');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(await screen.findByRole('button', { name: 'Transfer' }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
    expect(sent.jobIds).toEqual([20857, 20866]);
    expect(sent.newRouteId).toBe(5);
  });

  it('toasts instead of opening a dialog when the filters leave no jobs', async () => {
    server.use(
      http.get('/api/runviewer/runs/:runId/jobs', () => HttpResponse.json({ response: [] })),
    );
    renderMenu({ runId: -15 });
    const user = userEvent.setup();
    await user.click(screen.getByText('Transfer Route'));
    expect(await screen.findByText(/No jobs on this run for the current filters/)).toBeInTheDocument();
    expect(screen.queryByText('Transfer route')).toBeNull();
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

  it('fires pre-assign with the courier picked in the picker (#816: no prompt)', async () => {
    let hit = 0;
    server.use(
      http.get('/api/runviewer/couriers/search', () =>
        HttpResponse.json({ response: [{ courierId: 1, code: 'ACE', name: 'Ace' }] })),
      http.post('/api/runviewer/jobs/preassign-run', () => {
        hit++;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    const props = renderMenu({ runId: 3 });
    const user = userEvent.setup();
    await user.click(screen.getByText('Pre-assign Run'));
    await user.click(await screen.findByText('Ace (ACE)'));
    await user.click(screen.getByRole('button', { name: 'Pre-assign' }));
    await waitFor(() => expect(hit).toBe(1));
    expect(props.onDone).toHaveBeenCalled();
  });

  it('aborts pre-assign when the courier picker is cancelled', async () => {
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

// #311/#326, #323, #816: a Run List row is run id + courier + pre-assign
// flag. The menu acts on the row(s) it was opened for, not on the bare run.
describe('RvRunContextMenu run rows', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 41, name: 'RUN41', courierId: null as number | null, courierCode: null as string | null,
    preAssigned: 0, isMissing: false, ...over,
  });
  const kay = () => http.get('/api/runviewer/couriers/search', () =>
    HttpResponse.json({ response: [{ courierId: 9, code: 'K9', name: 'Kay' }] }));

  beforeEach(() => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, isNetworkPartner: false };
  });

  it('Assign Route on the unassigned half of a split run fetches only the jobs nobody holds', async () => {
    const urls: string[] = [];
    server.use(
      http.get('/api/runviewer/runs/:runId/jobs', ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json({ response: [{ jobId: 100 }] });
      }),
      kay(),
    );
    renderMenu({ runId: 41, rows: [row()] } as any);
    await userEvent.setup().click(screen.getByText('Assign Route'));
    await screen.findByPlaceholderText(/Search couriers/);
    const q = new URL(urls[0]).searchParams;
    expect(q.get('unassignedOnly')).toBe('true');
    expect(q.get('courierId')).toBeNull();
    expect(q.get('preAssigned')).toBeNull();
  });

  it('Assign Route on a pre-assigned row fetches that driver\'s pre-assigned (status 18) jobs', async () => {
    const urls: string[] = [];
    server.use(
      http.get('/api/runviewer/runs/:runId/jobs', ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json({ response: [{ jobId: 100 }] });
      }),
      kay(),
    );
    renderMenu({ runId: 41, rows: [row({ courierId: 7, courierCode: 'C7', preAssigned: 1 })] } as any);
    await userEvent.setup().click(screen.getByText('Assign Route'));
    await screen.findByPlaceholderText(/Search couriers/);
    const q = new URL(urls[0]).searchParams;
    expect(q.get('courierId')).toBe('7');
    expect(q.get('preAssigned')).toBe('true');
    expect(q.get('unassignedOnly')).toBeNull();
  });

  it('Assign Route with two runs selected assigns the jobs of both, each by its own row, in one dialog', async () => {
    const urls: string[] = [];
    let sent: any = null;
    server.use(
      http.get('/api/runviewer/runs/:runId/jobs', ({ request, params }) => {
        urls.push(request.url);
        return HttpResponse.json({
          response: params.runId === '41' ? [{ jobId: 100 }, { jobId: 101 }] : [{ jobId: 200 }],
        });
      }),
      kay(),
      http.post('/api/runviewer/jobs/assign', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ response: { succeeded: 3, failed: 0, errors: [], targetType: 'Courier', targetId: 9, displayName: 'Kay' } });
      }),
    );
    const props = renderMenu({
      runId: 41,
      rows: [row(), row({ id: 52, name: 'RUN52', courierId: 7, courierCode: 'C7' })],
    } as any);
    const user = userEvent.setup();
    await user.click(screen.getByText('Assign 2 runs'));
    await user.click(await screen.findByText('Kay (K9)'));
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
    expect([...sent.jobIds].sort()).toEqual([100, 101, 200]);
    const run52 = new URL(urls.find((u) => u.includes('/runs/52/'))!).searchParams;
    expect(run52.get('courierId')).toBe('7');
    expect(run52.get('unassignedOnly')).toBeNull();
  });

  it('a pre-assigned row offers Re-assign to another driver and Unassign driver', () => {
    renderMenu({ runId: 41, rows: [row({ courierId: 7, courierCode: 'C7', preAssigned: 1 })] } as any);
    expect(screen.getByText('Re-assign to another driver')).toBeInTheDocument();
    expect(screen.getByText('Unassign driver')).toBeInTheDocument();
  });

  it('Unassign driver unassigns the row\'s own driver without asking for a code', async () => {
    const prompt = vi.spyOn(window, 'prompt');
    let sent: any = null;
    server.use(http.post('/api/runviewer/jobs/unassign-run', async ({ request }) => {
      sent = await request.json();
      return HttpResponse.json({ response: 'ok' });
    }));
    const props = renderMenu({ runId: 41, rows: [row({ courierId: 7, courierCode: 'C7', preAssigned: 1 })] } as any);
    const user = userEvent.setup();
    await user.click(screen.getByText('Unassign driver'));
    await user.click(await screen.findByRole('button', { name: 'OK' }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
    expect(sent).toEqual({ runId: 41, courierCode: 'C7' });
    expect(prompt).not.toHaveBeenCalled();
  });

  it('Re-assign picks the new driver from the courier picker and sends the row\'s driver as from', async () => {
    const prompt = vi.spyOn(window, 'prompt');
    let sent: any = null;
    server.use(kay(), http.post('/api/runviewer/jobs/preassign-run', async ({ request }) => {
      sent = await request.json();
      return HttpResponse.json({ response: 'ok' });
    }));
    const props = renderMenu({ runId: 41, rows: [row({ courierId: 7, courierCode: 'C7', preAssigned: 1 })] } as any);
    const user = userEvent.setup();
    await user.click(screen.getByText('Re-assign to another driver'));
    await user.click(await screen.findByText('Kay (K9)'));
    await user.click(screen.getByRole('button', { name: 'Re-assign' }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
    expect(sent).toEqual({ runId: 41, toCourierCode: 'K9', fromCourierCode: 'C7' });
    expect(prompt).not.toHaveBeenCalled();
  });

  it('Pre-assign Run uses the courier picker and sends the row\'s current driver as from', async () => {
    const prompt = vi.spyOn(window, 'prompt');
    let sent: any = null;
    server.use(kay(), http.post('/api/runviewer/jobs/preassign-run', async ({ request }) => {
      sent = await request.json();
      return HttpResponse.json({ response: 'ok' });
    }));
    const props = renderMenu({ runId: 41, rows: [row({ courierId: 7, courierCode: 'C7' })] } as any);
    const user = userEvent.setup();
    await user.click(screen.getByText('Pre-assign Run'));
    await user.click(await screen.findByText('Kay (K9)'));
    await user.click(screen.getByRole('button', { name: 'Pre-assign' }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
    expect(sent).toEqual({ runId: 41, toCourierCode: 'K9', fromCourierCode: 'C7' });
    expect(prompt).not.toHaveBeenCalled();
  });

  it('shows the server\'s message when the courier code is not known', async () => {
    server.use(kay(), http.post('/api/runviewer/jobs/preassign-run', () =>
      HttpResponse.json({ message: "Courier code 'K9' is not a current courier." }, { status: 400 })));
    renderMenu({ runId: 41, rows: [row({ courierId: 7, courierCode: 'C7', preAssigned: 1 })] } as any);
    const user = userEvent.setup();
    await user.click(screen.getByText('Re-assign to another driver'));
    await user.click(await screen.findByText('Kay (K9)'));
    await user.click(screen.getByRole('button', { name: 'Re-assign' }));
    expect(await screen.findByText("Courier code 'K9' is not a current courier.")).toBeInTheDocument();
  });
});
