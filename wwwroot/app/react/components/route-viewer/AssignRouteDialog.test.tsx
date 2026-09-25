import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { AssignRouteDialog } from './AssignRouteDialog';

const stubCouriers = (rows: Array<{ courierId: number; code: string | null; name: string }>) =>
  http.get('/api/runviewer/couriers/search', () =>
    HttpResponse.json({ response: rows }),
  );

// Agent + NP share one endpoint; capture the URL so tests can assert
// which slice (isNetworkPartner) was requested + which jobId was scoped.
const stubAgents = (
  rows: Array<{ id: number; name: string | null; hint: string | null }>,
  capture?: (url: URL) => void,
) =>
  http.get(
    '/api/runviewer/jobs/:jobId/assignable-targets/agents',
    ({ request }) => {
      if (capture) capture(new URL(request.url));
      return HttpResponse.json({ response: rows });
    },
  );

// 2026-09-18: legacy-pattern port. AssignRouteDialog no longer fetches
// the run's jobs itself - the caller supplies `jobIds` pre-filtered by
// the current viewMode (see lib/runViewerViewMode.ts). Tests set
// `jobIds` directly; no MSW stub for the runs endpoint is needed. The
// backend AssignAsync treats JobIds as tucJob.UcjbId - callers filter
// jobId > 0 before opening the dialog, matching legacy runViewer parity
// (homeControl.js:2196 `j.jobID`).
function renderDlg(props: Partial<Parameters<typeof AssignRouteDialog>[0]> = {}) {
  const defaults = {
    jobIds: [42],
    runLabel: 'run #5',
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  };
  const merged = { ...defaults, ...props };
  renderWithProviders(<AssignRouteDialog {...merged} />);
  return merged;
}

describe('AssignRouteDialog', () => {
  beforeEach(() => {
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      isNetworkPartner: false,
    };
    server.use(stubCouriers([]));
    server.use(stubAgents([]));
  });

  it('renders "Assign route" title for admin', () => {
    renderDlg();
    expect(screen.getByText('Assign route')).toBeInTheDocument();
  });

  it('renders "Assign courier" title for NP + hides bucket radios', () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, isNetworkPartner: true };
    renderDlg();
    expect(screen.getByText('Assign courier')).toBeInTheDocument();
    // Only one bucket for NP -> no radios rendered
    expect(screen.queryByLabelText(/Agent/)).toBeNull();
  });

  it('shows admin bucket radios (courier/agent/np)', () => {
    renderDlg();
    // Radio labels rendered as capitalize / Network Partner
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('runs courier search after debounce + lists rows', async () => {
    server.use(
      stubCouriers([
        { courierId: 1, code: 'ACE', name: 'Ace' },
        { courierId: 2, code: 'KEV', name: 'Kev' },
      ]),
    );
    renderDlg();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Search couriers/), 'e');
    expect(await screen.findByRole('button', { name: /Ace \(ACE\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Kev \(KEV\)/ })).toBeInTheDocument();
  });

  it('renders just the name when the courier row has no code', async () => {
    // Regression guard for medical-prod - some tenants have couriers
    // with tucCourier.Code = NULL; the label used to render as
    // "George Test (null)" from a naive `${name} (${code})` template.
    server.use(
      stubCouriers([
        { courierId: 555, code: null, name: 'George Test' },
        { courierId: 556, code: null, name: 'George Test2' },
      ]),
    );
    renderDlg();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Search couriers/), 'george');
    expect(await screen.findByRole('button', { name: 'George Test' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'George Test2' })).toBeInTheDocument();
    // Explicit anti-regression on the literal "null" substring.
    expect(screen.queryByText(/\(null\)/)).toBeNull();
  });

  it('picks a courier + assigns + calls onSuccess', async () => {
    server.use(
      stubCouriers([{ courierId: 1, code: 'ACE', name: 'Ace' }]),
      http.post('/api/runviewer/jobs/assign', () =>
        HttpResponse.json({ response: { succeeded: 3, failed: 0, errors: [], targetType: 'Courier', targetId: 1, displayName: 'Ace' } }),
      ),
    );
    const props = renderDlg();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Search couriers/), 'ac');
    await user.click(await screen.findByRole('button', { name: /Ace \(ACE\)/ }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(props.onSuccess).toHaveBeenCalled());
    expect(vi.mocked(props.onSuccess).mock.calls[0][0]).toMatch(/Ace/);
  });

  it('shows error on assign 500', async () => {
    server.use(
      stubCouriers([{ courierId: 1, code: 'ACE', name: 'Ace' }]),
      http.post('/api/runviewer/jobs/assign', () =>
        HttpResponse.json({ messages: [{ message: 'assign fail' }] }, { status: 500 }),
      ),
    );
    renderDlg();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Search couriers/), 'ac');
    await user.click(await screen.findByRole('button', { name: /Ace \(ACE\)/ }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    expect(await screen.findByText(/assign fail/)).toBeInTheDocument();
  });

  it('cancel triggers onClose', async () => {
    const props = renderDlg();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('shows empty-state message initially with no matches', async () => {
    renderDlg();
    expect(
      await screen.findByText(/No matches - type to search/),
    ).toBeInTheDocument();
  });

  it('renders empty rows message on 404-like empty response', async () => {
    server.use(stubCouriers([]));
    renderDlg();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Search couriers/), 'xx');
    // Wait for empty state (also fires courier search but empty)
    await waitFor(() =>
      expect(screen.getByText(/No matches - type to search/)).toBeInTheDocument(),
    );
  });

  // ---------------------------------------------------------------------
  // Agent + NP bucket wiring (both hit
  // /runviewer/jobs/{jobId}/assignable-targets/agents distinguished by
  // isNetworkPartner). Assertions cover:
  //   1. The correct endpoint is called (URL captured via MSW).
  //   2. The isNetworkPartner query param matches the picked bucket.
  //   3. anchorJobId (Props) surfaces as the {jobId} path segment; if
  //      omitted, the dialog passes 0.
  //   4. limit=200 (the initial pre-fetch page size per master spec).
  //   5. Result rows render (label from name, subtitle from hint).
  // ---------------------------------------------------------------------

  it('agent tab hits /assignable-targets/agents with isNetworkPartner=false + limit=200', async () => {
    let seen!: URL;
    server.use(
      stubAgents(
        [{ id: 7, name: 'Northern Freight', hint: 'AKL' }],
        (u) => (seen = u),
      ),
    );
    renderDlg({ anchorJobId: 123 });
    const user = userEvent.setup();
    const radios = screen.getAllByRole('radio');
    await user.click(radios[1]); // agent
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Northern Freight/ })).toBeInTheDocument(),
    );
    expect(seen.pathname).toBe('/api/runviewer/jobs/123/assignable-targets/agents');
    expect(seen.searchParams.get('isNetworkPartner')).toBe('false');
    expect(seen.searchParams.get('limit')).toBe('200');
    // Subtitle comes from hint field.
    expect(screen.getByText('AKL')).toBeInTheDocument();
  });

  it('np tab hits /assignable-targets/agents with isNetworkPartner=true + limit=200', async () => {
    let seen!: URL;
    server.use(
      stubAgents(
        [{ id: 42, name: 'Bluebird NP', hint: null }],
        (u) => (seen = u),
      ),
    );
    renderDlg({ anchorJobId: 456 });
    const user = userEvent.setup();
    const radios = screen.getAllByRole('radio');
    await user.click(radios[2]); // np
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Bluebird NP/ })).toBeInTheDocument(),
    );
    expect(seen.pathname).toBe('/api/runviewer/jobs/456/assignable-targets/agents');
    expect(seen.searchParams.get('isNetworkPartner')).toBe('true');
    expect(seen.searchParams.get('limit')).toBe('200');
  });

  it('agent search defaults jobId to 0 when anchorJobId not passed', async () => {
    let seen!: URL;
    server.use(stubAgents([], (u) => (seen = u)));
    renderDlg(); // no anchorJobId
    const user = userEvent.setup();
    const radios = screen.getAllByRole('radio');
    await user.click(radios[1]); // agent
    await waitFor(() => expect(seen).toBeDefined());
    expect(seen.pathname).toBe('/api/runviewer/jobs/0/assignable-targets/agents');
  });

  it('agent typeahead forwards the q param after 250ms debounce', async () => {
    let seen!: URL;
    server.use(
      stubAgents(
        [{ id: 1, name: 'North Freight', hint: null }],
        (u) => (seen = u),
      ),
    );
    renderDlg({ anchorJobId: 10 });
    const user = userEvent.setup();
    const radios = screen.getAllByRole('radio');
    await user.click(radios[1]);
    await user.type(screen.getByPlaceholderText(/Search agents/), 'nor');
    await waitFor(() => expect(seen.searchParams.get('q')).toBe('nor'));
  });

  it('placeholder text is "Search network partners..." on np tab', async () => {
    renderDlg();
    const user = userEvent.setup();
    const radios = screen.getAllByRole('radio');
    await user.click(radios[2]);
    expect(
      screen.getByPlaceholderText(/Search network partners/),
    ).toBeInTheDocument();
  });

  it('picking an agent + assigning sends agentId in the payload', async () => {
    let assignPayload: any = null;
    server.use(
      stubAgents([{ id: 77, name: 'Northshore', hint: null }]),
      http.post('/api/runviewer/jobs/assign', async ({ request }) => {
        assignPayload = await request.json();
        return HttpResponse.json({ response: { succeeded: 2, failed: 0, errors: [], targetType: 'Agent', targetId: 77, displayName: 'Northshore' } });
      }),
    );
    const props = renderDlg({ anchorJobId: 1 });
    const user = userEvent.setup();
    const radios = screen.getAllByRole('radio');
    await user.click(radios[1]); // agent
    await user.click(await screen.findByRole('button', { name: /Northshore/ }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(props.onSuccess).toHaveBeenCalled());
    expect(assignPayload).toMatchObject({ targetType: 'Agent', targetId: 77 });
  });

  it('picking an NP + assigning sends npAgentId in the payload', async () => {
    let assignPayload: any = null;
    server.use(
      stubAgents([{ id: 88, name: 'Regional NP', hint: null }]),
      http.post('/api/runviewer/jobs/assign', async ({ request }) => {
        assignPayload = await request.json();
        return HttpResponse.json({ response: { succeeded: 1, failed: 0, errors: [], targetType: 'NetworkPartner', targetId: 88, displayName: 'Regional NP' } });
      }),
    );
    const props = renderDlg({ anchorJobId: 1 });
    const user = userEvent.setup();
    const radios = screen.getAllByRole('radio');
    await user.click(radios[2]); // np
    await user.click(await screen.findByRole('button', { name: /Regional NP/ }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(props.onSuccess).toHaveBeenCalled());
    expect(assignPayload).toMatchObject({ targetType: 'NetworkPartner', targetId: 88 });
  });

  // Regression guard: the dialog forwards the caller-supplied JobIds
  // verbatim to the assign endpoint (post 2026-09-18 legacy pattern).
  // Callers own the scope + jobId > 0 filter (matches legacy
  // homeControl.js:2196 `j.jobID` gate); the dialog is dumb.
  it('sends the injected jobIds verbatim in the assign payload', async () => {
    let assignPayload: any = null;
    server.use(
      stubCouriers([{ courierId: 1, code: 'ACE', name: 'Ace' }]),
      http.post('/api/runviewer/jobs/assign', async ({ request }) => {
        assignPayload = await request.json();
        return HttpResponse.json({ response: { succeeded: 2, failed: 0, errors: [], targetType: 'Courier', targetId: 1, displayName: 'Ace' } });
      }),
    );
    const props = renderDlg({ jobIds: [100, 200] });
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Search couriers/), 'ac');
    await user.click(await screen.findByRole('button', { name: /Ace \(ACE\)/ }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(props.onSuccess).toHaveBeenCalled());
    expect(assignPayload).toMatchObject({ targetType: 'Courier', targetId: 1, jobIds: [100, 200] });
  });

  it('surfaces an inline error when the caller passes an empty jobIds list', async () => {
    // Defensive path - callers are meant to guard empty selections
    // themselves + not open the dialog, but the dialog still fails
    // loud rather than sending an empty JobIds array (which the
    // backend would reject with "JobIds is required.").
    server.use(
      stubCouriers([{ courierId: 1, code: 'ACE', name: 'Ace' }]),
    );
    renderDlg({ jobIds: [] });
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Search couriers/), 'ac');
    await user.click(await screen.findByRole('button', { name: /Ace \(ACE\)/ }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    expect(await screen.findByText(/no jobs to assign/i)).toBeInTheDocument();
  });

  it('reflects the runLabel prop in the success summary', async () => {
    server.use(
      stubCouriers([{ courierId: 1, code: 'ACE', name: 'Ace' }]),
      http.post('/api/runviewer/jobs/assign', () =>
        HttpResponse.json({ response: { succeeded: 3, failed: 0, errors: [], targetType: 'Courier', targetId: 1, displayName: 'Ace' } }),
      ),
    );
    const props = renderDlg({ runLabel: 'Job P42LHP' });
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Search couriers/), 'ac');
    await user.click(await screen.findByRole('button', { name: /Ace \(ACE\)/ }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(props.onSuccess).toHaveBeenCalled());
    expect(vi.mocked(props.onSuccess).mock.calls[0][0]).toMatch(/Job P42LHP/);
  });
});
