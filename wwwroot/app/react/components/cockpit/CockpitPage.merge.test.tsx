import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CockpitPage } from './CockpitPage';
import { makeJob, makeRun, makeRunJob } from './CockpitPage.fixtures';
import type { BulkJob, Run } from '@/types';

/**
 * Merge flow: right-click a run row -> "Merge into..." -> MergeRunModal picks
 * the target -> doMergeRun assigns source jobs to target + deletes source.
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

const jobs: BulkJob[] = [
  makeJob(1, { jobNumber: 'J-1', bulkRunId: 900, runName: 'SOURCE' }),
];
const runs: Run[] = [
  makeRun(900, { name: 'SOURCE', status: 0, jobs: [makeRunJob(1)] }),
  makeRun(901, { name: 'TARGET', status: 0, jobs: [] }),
];

function baseHandlers() {
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

describe('CockpitPage - merge run flow', () => {
  it('right-click "Merge into..." opens the MergeRunModal with target candidates', async () => {
    server.use(...baseHandlers());
    renderWithProviders(<CockpitPage />);
    const sourceRow = await screen.findByText('SOURCE');
    fireEvent.contextMenu(sourceRow);
    // RowContextMenu now shows a "Merge into..." item.
    fireEvent.click(await screen.findByRole('button', { name: /Merge into/ }));
    // MergeRunModal opens with source name in the title.
    expect(await screen.findByRole('heading', { name: /Merge "SOURCE"/ })).toBeInTheDocument();
  });

  it('confirming merge assigns source jobs to target and deletes source', async () => {
    let assigns = 0;
    let deletes = 0;
    server.use(
      ...baseHandlers(),
      http.post('/api/runs/:id/assign', () => {
        assigns += 1;
        return HttpResponse.json({ response: { result: 'Success', message: null } });
      }),
      http.delete('/api/runs/:id', () => {
        deletes += 1;
        return HttpResponse.json({ response: { result: 'Success', message: null } });
      }),
    );
    renderWithProviders(<CockpitPage />);
    const sourceRow = await screen.findByText('SOURCE');
    fireEvent.contextMenu(sourceRow);
    fireEvent.click(await screen.findByRole('button', { name: /Merge into/ }));
    // Modal auto-selects the first candidate. Click Merge.
    fireEvent.click(await screen.findByRole('button', { name: 'Merge' }));
    await waitFor(() => {
      expect(assigns).toBeGreaterThan(0);
      expect(deletes).toBeGreaterThan(0);
    });
  });

  it('modal Cancel closes without any API calls', async () => {
    let assigns = 0;
    let deletes = 0;
    server.use(
      ...baseHandlers(),
      http.post('/api/runs/:id/assign', () => {
        assigns += 1;
        return HttpResponse.json({ response: { result: 'Success', message: null } });
      }),
      http.delete('/api/runs/:id', () => {
        deletes += 1;
        return HttpResponse.json({ response: { result: 'Success', message: null } });
      }),
    );
    renderWithProviders(<CockpitPage />);
    const sourceRow = await screen.findByText('SOURCE');
    fireEvent.contextMenu(sourceRow);
    fireEvent.click(await screen.findByRole('button', { name: /Merge into/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: /Merge "SOURCE"/ })).not.toBeInTheDocument(),
    );
    expect(assigns).toBe(0);
    expect(deletes).toBe(0);
  });
});
