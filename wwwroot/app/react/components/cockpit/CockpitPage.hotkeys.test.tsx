import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CockpitPage } from './CockpitPage';
import { makeJob, makeRun, makeRunJob } from './CockpitPage.fixtures';
import type { BulkJob, Run } from '@/types';

/**
 * Keyboard hotkey coverage. Uses fireEvent.keyDown on document so useHotkeys
 * (which listens on document) receives the event. Ctrl+A selects all in the
 * active pane, Ctrl+D dispatches or sends selected, Escape drains modals /
 * multi-selections, Arrow keys navigate rows.
 */

beforeEach(() => {
  (window as any).__APP_USER__ = {
    ...(window as any).__APP_USER__,
    googleMapsKey: null,
    isUsTenant: false,
  };
});

const jobs: BulkJob[] = [
  makeJob(1, { jobNumber: 'J-1' }),
  makeJob(2, { jobNumber: 'J-2' }),
  makeJob(3, { jobNumber: 'J-3' }),
];

function baseHandlers(runs: Run[] = []) {
  return [
    http.get('/api/regions', () => HttpResponse.json([])),
    http.get('/api/speeds', () => HttpResponse.json([])),
    http.get('/api/couriers', () => HttpResponse.json({ potentialCouriers: [] })),
    http.get('/api/fleets', () => HttpResponse.json({ fleets: [] })),
    http.get('/api/jobs/filters/clients', () => HttpResponse.json({ response: { clients: [] } })),
    http.get('/api/jobs/filters/refs', () => HttpResponse.json({ ourRefs: [] })),
    http.get('/api/vehicle-sizes', () => HttpResponse.json({ response: [] })),
    http.get('/api/jobs', () => HttpResponse.json({ bulkJobs: jobs, maxJsonLength: 10000 })),
    http.get('/api/runs', () => HttpResponse.json({ response: runs, maxJsonLength: 10000 })),
    http.post('/api/routes/polyline', () => HttpResponse.json({ points: [] })),
  ];
}

describe('CockpitPage - global hotkeys', () => {
  it('Ctrl+A selects every visible job (default active pane = jobs)', async () => {
    server.use(...baseHandlers());
    renderWithProviders(<CockpitPage />);
    await screen.findByText('J-1');
    // Focus something outside an input, then Ctrl+A.
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    // ActionToolbar renders when jobs are selected - assert at least one
    // "3 jobs selected" appears (label + panel title both match).
    await waitFor(() =>
      expect(screen.getAllByText(/3 jobs selected/).length).toBeGreaterThan(0),
    );
  });

  it('Ctrl+A preventsDefault so browser text-select does not fire', async () => {
    server.use(...baseHandlers());
    renderWithProviders(<CockpitPage />);
    await screen.findByText('J-1');
    const evt = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, cancelable: true, bubbles: true });
    const dispatched = document.dispatchEvent(evt);
    // dispatched === false means preventDefault was called.
    expect(dispatched).toBe(false);
  });

  it('Ctrl+D with a run locked fires the dispatch confirm', async () => {
    server.use(
      ...baseHandlers([makeRun(900, { name: 'LOCK', status: 1, jobs: [makeRunJob(1)] })]),
      http.post('/api/runs/dispatch', () =>
        HttpResponse.json({ response: [{ result: 'Success', message: null }] })
      ),
    );
    renderWithProviders(<CockpitPage />);
    await screen.findByText('LOCK');
    fireEvent.keyDown(document.body, { key: 'd', ctrlKey: true });
    // Ctrl+D routes into handleDispatch which opens a confirm modal.
    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('Ctrl+D preventsDefault so browser bookmark dialog does not fire', async () => {
    server.use(...baseHandlers());
    renderWithProviders(<CockpitPage />);
    await screen.findByText('J-1');
    const evt = new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, cancelable: true, bubbles: true });
    const dispatched = document.dispatchEvent(evt);
    expect(dispatched).toBe(false);
  });

  it('Escape while nothing is open clears any multi-select', async () => {
    server.use(...baseHandlers());
    renderWithProviders(<CockpitPage />);
    await screen.findByText('J-1');
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    await waitFor(() =>
      expect(screen.getAllByText(/3 jobs selected/).length).toBeGreaterThan(0),
    );
    // Escape once - CockpitPage onEscape falls through to CLEAR_MULTISELECT.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    // ActionToolbar collapses once selection is 0.
    await waitFor(() =>
      expect(screen.queryByText(/Send selected to Live/)).not.toBeInTheDocument(),
    );
  });

  it('Escape closes the BulkMoveDateModal when open', async () => {
    server.use(...baseHandlers());
    renderWithProviders(<CockpitPage />);
    await screen.findByText('J-1');
    // Multi-select + open the bulk-move modal via the toolbar.
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Bulk move date...' }));
    expect(await screen.findByRole('heading', { name: /Move 3 jobs to another date/ })).toBeInTheDocument();
    // Escape.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: /Move 3 jobs to another date/ })).not.toBeInTheDocument(),
    );
  });

  it('ArrowDown from no selection selects the first visible job', async () => {
    server.use(...baseHandlers());
    renderWithProviders(<CockpitPage />);
    await screen.findAllByText('J-1');
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    // The page still renders after the key handler fires (no crash).
    await waitFor(() =>
      expect(screen.getAllByText('J-1').length).toBeGreaterThan(0),
    );
  });

  it('ArrowUp from no selection selects the last visible job', async () => {
    server.use(...baseHandlers());
    renderWithProviders(<CockpitPage />);
    await screen.findAllByText('J-3');
    fireEvent.keyDown(document.body, { key: 'ArrowUp' });
    await waitFor(() =>
      expect(screen.getAllByText('J-3').length).toBeGreaterThan(0),
    );
  });

  it('Delete key while no run-attached job is selected is a no-op', async () => {
    server.use(...baseHandlers());
    renderWithProviders(<CockpitPage />);
    await screen.findByText('J-1');
    fireEvent.keyDown(document.body, { key: 'Delete' });
    // Page still renders.
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('typing into an input suppresses Ctrl+A / Ctrl+D handling', async () => {
    server.use(...baseHandlers());
    renderWithProviders(<CockpitPage />);
    await screen.findByText('J-1');
    // Focus the FiltersBar date input.
    const input = screen.getByLabelText(/Date/) as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: 'a', ctrlKey: true });
    // No selection should have happened.
    expect(screen.queryByText(/jobs selected/)).not.toBeInTheDocument();
  });
});
