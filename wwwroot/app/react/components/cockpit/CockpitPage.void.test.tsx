import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CockpitPage } from './CockpitPage';
import { makeJob } from './CockpitPage.fixtures';
import type { BulkJob } from '@/types';

/**
 * Void / un-void job flow. Covers the plain-confirm path (no multibox family)
 * and the VoidRelationshipDialog path (family present). Both terminate in
 * jobService.void(...) + a Success toast.
 */

beforeEach(() => {
  (window as any).__APP_USER__ = {
    ...(window as any).__APP_USER__,
    googleMapsKey: null,
    isUsTenant: false,
  };
});

function baseHandlers(jobsList: BulkJob[]) {
  return [
    http.get('/api/regions', () => HttpResponse.json([])),
    http.get('/api/speeds', () => HttpResponse.json([])),
    http.get('/api/couriers', () => HttpResponse.json({ potentialCouriers: [] })),
    http.get('/api/fleets', () => HttpResponse.json({ fleets: [] })),
    http.get('/api/jobs/filters/clients', () => HttpResponse.json({ response: { clients: [] } })),
    http.get('/api/jobs/filters/refs', () => HttpResponse.json({ ourRefs: [] })),
    http.get('/api/vehicle-sizes', () => HttpResponse.json({ response: [] })),
    http.get('/api/jobs', () => HttpResponse.json({ bulkJobs: jobsList, maxJsonLength: 10000 })),
    http.get('/api/runs', () => HttpResponse.json({ response: [], maxJsonLength: 10000 })),
    http.post('/api/routes/polyline', () => HttpResponse.json({ points: [] })),
  ];
}

describe('CockpitPage - void / un-void', () => {
  it('plain confirm path: select 1 non-multibox job, click Void, confirm -> POST /api/jobs/void', async () => {
    const jobs = [makeJob(11, { jobNumber: 'J-11' })];
    let voidCalls = 0;
    server.use(
      ...baseHandlers(jobs),
      http.post('/api/jobs/void', async ({ request }) => {
        const body = await request.json() as { jobIds: number[]; isVoid: boolean };
        voidCalls += 1;
        expect(body.jobIds).toEqual([11]);
        expect(body.isVoid).toBe(true);
        return HttpResponse.json({ response: 'Success' });
      }),
    );
    renderWithProviders(<CockpitPage />);
    await screen.findByText('J-11');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    // Toolbar Void opens the confirm dialog.
    fireEvent.click(await screen.findByRole('button', { name: 'Void' }));
    // The confirm dialog's primary button carries data-primary="true"; use
    // that selector to avoid re-clicking the toolbar's Void button.
    const primary = await waitFor(() => {
      const b = document.querySelector('button[data-primary="true"]');
      if (!b) throw new Error('no primary button yet');
      return b as HTMLButtonElement;
    });
    fireEvent.click(primary);
    await waitFor(() => expect(voidCalls).toBeGreaterThan(0));
    expect(await screen.findByText(/Voided 1 job/)).toBeInTheDocument();
  });

  it('confirm cancel does NOT POST /api/jobs/void', async () => {
    const jobs = [makeJob(11)];
    let voidCalls = 0;
    server.use(
      ...baseHandlers(jobs),
      http.post('/api/jobs/void', () => {
        voidCalls += 1;
        return HttpResponse.json({ response: 'Success' });
      }),
    );
    renderWithProviders(<CockpitPage />);
    await screen.findByText('J-11');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Void' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    // Give the microtask queue a beat to confirm no void fired.
    await new Promise((r) => setTimeout(r, 50));
    expect(voidCalls).toBe(0);
  });

  it('VoidRelationshipDialog opens when selection is part of a multibox family', async () => {
    // Two children sharing multiboxParentId=555. Selecting one triggers family.
    const jobs = [
      makeJob(11, { jobNumber: 'J-11', multiboxParentId: 555 }),
      makeJob(12, { jobNumber: 'J-12', multiboxParentId: 555 }),
    ];
    server.use(...baseHandlers(jobs));
    renderWithProviders(<CockpitPage />);
    await screen.findByText('J-11');
    // Select just J-11 via its per-row checkbox.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select job J-11' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Void' }));
    // The multibox dialog opens.
    expect(await screen.findByRole('heading', { name: /Void multibox family/ })).toBeInTheDocument();
  });

  it('VoidRelationshipDialog "Void full family" fires void with expanded ids', async () => {
    const jobs = [
      makeJob(11, { jobNumber: 'J-11', multiboxParentId: 555 }),
      makeJob(12, { jobNumber: 'J-12', multiboxParentId: 555 }),
    ];
    let seen: number[] | null = null;
    server.use(
      ...baseHandlers(jobs),
      http.post('/api/jobs/void', async ({ request }) => {
        const body = await request.json() as { jobIds: number[]; isVoid: boolean };
        seen = body.jobIds;
        return HttpResponse.json({ response: 'Success' });
      }),
    );
    renderWithProviders(<CockpitPage />);
    await screen.findByText('J-11');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select job J-11' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Void' }));
    fireEvent.click(await screen.findByRole('button', { name: /Void full family/ }));
    await waitFor(() => expect(seen).not.toBeNull());
    expect(seen!.sort()).toEqual([11, 12]);
  });
});
