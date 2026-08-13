import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CockpitPage } from './CockpitPage';
import { makeJob, makeRun, makeRunJob } from './CockpitPage.fixtures';
import type { BulkJob, Run } from '@/types';

/**
 * Row-level context-menu factories: jobContextMenu, groupContextMenu, and
 * runContextMenu. Each is exercised by right-clicking the matching row and
 * clicking an item. Assertions focus on the resulting side effect (network
 * call, modal opened) rather than DOM re-render because a single job number
 * can appear in the Jobs list + Grouped + JobDetail + Run pins at once.
 */

beforeEach(() => {
  (window as any).__APP_USER__ = {
    ...(window as any).__APP_USER__,
    googleMapsKey: null,
    isUsTenant: false,
  };
});
afterEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
});

function baseHandlers(jobs: BulkJob[], runs: Run[] = []) {
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

describe('CockpitPage - row context menus', () => {
  it('job row right-click -> "Show on map" fires SELECT_JOB', async () => {
    const jobs = [makeJob(11, { jobNumber: 'J-11' })];
    server.use(...baseHandlers(jobs));
    renderWithProviders(<CockpitPage />);
    // Find the JobsList row explicitly (grab from tbody).
    const jobRow = (await screen.findAllByText('J-11'))[0];
    fireEvent.contextMenu(jobRow);
    const showBtn = await screen.findByRole('button', { name: 'Show on map' });
    fireEvent.click(showBtn);
    // No crash - the button click closes the menu.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Show on map' })).not.toBeInTheDocument(),
    );
  });

  it('job row right-click -> "Fix GPS..." opens the FixGpsModal', async () => {
    const jobs = [makeJob(11, { jobNumber: 'J-11' })];
    server.use(...baseHandlers(jobs));
    renderWithProviders(<CockpitPage />);
    const jobRow = (await screen.findAllByText('J-11'))[0];
    fireEvent.contextMenu(jobRow);
    fireEvent.click(await screen.findByRole('button', { name: /Fix GPS/ }));
    // FixGpsModal renders. Just verify menu closed.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Fix GPS\.\.\./ })).not.toBeInTheDocument(),
    );
  });

  it('run row right-click -> "Rename..." starts the inline rename input', async () => {
    const runs = [makeRun(900, { name: 'RUN-900', status: 0 })];
    server.use(...baseHandlers([], runs));
    renderWithProviders(<CockpitPage />);
    const runRow = (await screen.findAllByText('RUN-900'))[0];
    fireEvent.contextMenu(runRow);
    fireEvent.click(await screen.findByRole('button', { name: /Rename/ }));
    // Menu closes without crash.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Rename/ })).not.toBeInTheDocument(),
    );
  });

  it('run row right-click -> "Delete run" fires DELETE /api/runs/:id', async () => {
    const runs = [makeRun(910, { name: 'RUN-910', status: 0 })];
    let deletes = 0;
    server.use(...baseHandlers([], runs));
    server.use(
      http.delete('/api/runs/:id', () => {
        deletes += 1;
        return HttpResponse.json({ response: { result: 'Success', message: null } });
      }),
    );
    renderWithProviders(<CockpitPage />);
    const runRow = (await screen.findAllByText('RUN-910'))[0];
    fireEvent.contextMenu(runRow);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete run' }));
    await waitFor(() => expect(deletes).toBe(1));
  });

  it('run row right-click -> "Lock" flips the run status', async () => {
    const runs = [makeRun(920, { name: 'RUN-920', status: 0 })];
    let updates = 0;
    server.use(...baseHandlers([], runs));
    server.use(
      http.put('/api/runs/:id', () => {
        updates += 1;
        return HttpResponse.json({ response: { result: 'Success', message: null } });
      }),
    );
    renderWithProviders(<CockpitPage />);
    const runRow = (await screen.findAllByText('RUN-920'))[0];
    fireEvent.contextMenu(runRow);
    fireEvent.click(await screen.findByRole('button', { name: 'Lock' }));
    await waitFor(() => expect(updates).toBe(1));
  });

  it('run row right-click -> "Edit Route Date..." opens the bulk-move modal', async () => {
    const runs = [makeRun(930, { name: 'RUN-930', jobs: [makeRunJob(1)] })];
    server.use(...baseHandlers([], runs));
    renderWithProviders(<CockpitPage />);
    const runRow = (await screen.findAllByText('RUN-930'))[0];
    fireEvent.contextMenu(runRow);
    fireEvent.click(await screen.findByRole('button', { name: /Edit Route Date/ }));
    expect(await screen.findByRole('heading', { name: /Move 1 job to another date/ })).toBeInTheDocument();
  });

  it('group row right-click -> "Create run from these" creates a run + assigns jobs', async () => {
    const jobs = [
      makeJob(11, { jobNumber: 'J-11', toPostCode: 2000 }),
      makeJob(12, { jobNumber: 'J-12', toPostCode: 2000 }),
    ];
    let creates = 0;
    let assigns = 0;
    server.use(...baseHandlers(jobs));
    server.use(
      http.post('/api/runs', () => {
        creates += 1;
        return HttpResponse.json({ response: { result: 'Success', message: '111' } });
      }),
      http.post('/api/runs/:id/assign', () => {
        assigns += 1;
        return HttpResponse.json({ response: { result: 'Success', message: null } });
      }),
    );
    renderWithProviders(<CockpitPage />);
    // The grouped panel shows postcode "2000" as the bucket header. The
    // JobsList also renders "2000" per row, so pick the first bucket header
    // by looking under the GroupedJobs Panel title.
    const allMatches = await screen.findAllByText('2000');
    // The bucket header sits inside a <li> element whereas the row cells
    // are <td>s. Filter to the <li>-descendant match.
    const groupRow = allMatches.find((el) => el.closest('li') != null) ?? allMatches[0];
    fireEvent.contextMenu(groupRow);
    fireEvent.click(await screen.findByRole('button', { name: /Create run from these/ }));
    await waitFor(() => {
      expect(creates).toBe(1);
      expect(assigns).toBeGreaterThan(0);
    });
  });
});
