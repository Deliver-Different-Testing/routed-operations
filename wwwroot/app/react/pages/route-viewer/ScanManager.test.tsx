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

import ScanManager from './ScanManager';

const baseline = () => [
  http.get('/api/runviewer/runs/overview', () => HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/scans', () => HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/scans/routed', () => HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/scans/detail', () => HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/scans/item-progress', () => HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/jobs/items', () => HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/filters/clients', () => HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/filters/regions', () => HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/filters/speeds', () => HttpResponse.json({ response: [] })),
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <ScanManager />
    </QueryClientProvider>,
    { initialRoute: '/route-viewer/scans' },
  );
}

describe('ScanManager', () => {
  beforeEach(() => {
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      isUsTenant: false,
      isNetworkPartner: false,
    };
    server.use(...baseline());
  });

  it('renders the Date + Mode toggles + defaults', async () => {
    renderPage();
    expect(screen.getByText(/Mode:/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bulk' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Routed' })).toBeInTheDocument();
  });

  it('shows "No scan rows for this date" when empty (Bulk)', async () => {
    server.use(
      ...baseline(),
      http.get('/api/runviewer/scans', () => HttpResponse.json({ response: [] })),
    );
    renderPage();
    expect(await screen.findByText(/No scan rows for this date/)).toBeInTheDocument();
  });

  it('renders bulk rows returned by the SP', async () => {
    server.use(
      http.get('/api/runviewer/scans', () =>
        HttpResponse.json({
          response: [{
            bulkJobId: 1, bulkParentId: null, jobNumber: 'JOB-1', clientCode: 'ACME',
            deliveryDate: null, readyTime: null, toAddress: '99 K Rd',
            items: 3, sortScanned: 0, runScanned: 0, pickScanned: 0,
            invalidPickScanned: 0, transferScanned: 0, transitScanned: 0,
          }],
        })),
      ...baseline(),
    );
    renderPage();
    expect(await screen.findByText('JOB-1')).toBeInTheDocument();
    expect(screen.getByText('ACME')).toBeInTheDocument();
  });

  it('switches to Routed mode + fires routed endpoint', async () => {
    let hit = 0;
    server.use(
      http.get('/api/runviewer/scans/routed', () => {
        hit++;
        return HttpResponse.json({ response: [] });
      }),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Routed' }));
    await waitFor(() => expect(hit).toBeGreaterThan(0));
    expect(await screen.findByText(/No routed shipments/)).toBeInTheDocument();
  });

  it('expands routed row + lazy loads item progress', async () => {
    let iHit = 0;
    server.use(
      http.get('/api/runviewer/scans/routed', () =>
        HttpResponse.json({
          response: [{
            jobId: 999, clientCode: 'ACME', jobNumber: 'J-999', toAddress: 'x',
            suburb: null, stage: null, legs: '[]',
            scannedItems: 0, expectedItems: 0, hasShort: false, isDivergent: false,
          }],
        })),
      http.get('/api/runviewer/scans/item-progress', () => {
        iHit++;
        return HttpResponse.json({ response: [] });
      }),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Routed' }));
    expect(await screen.findByText('J-999')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    await waitFor(() => expect(iHit).toBe(1));
  });

  it('picks a row to load scan detail rows', async () => {
    let dHit = 0;
    server.use(
      http.get('/api/runviewer/scans', () =>
        HttpResponse.json({
          response: [{
            bulkJobId: 7, bulkParentId: null, jobNumber: 'J-7', clientCode: 'A',
            deliveryDate: null, readyTime: null, toAddress: null,
            items: 1, sortScanned: 1, runScanned: 2, pickScanned: 1,
            invalidPickScanned: 0, transferScanned: 0, transitScanned: 0,
          }],
        })),
      http.get('/api/runviewer/scans/detail', () => {
        dHit++;
        return HttpResponse.json({ response: [] });
      }),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByText('J-7'));
    await waitFor(() => expect(dHit).toBeGreaterThan(0));
    expect(await screen.findByText(/No scans on file/)).toBeInTheDocument();
  });

  it('toggles client internal checkbox', async () => {
    renderPage();
    const user = userEvent.setup();
    const cb = await screen.findByLabelText(/Client internal/);
    await user.click(cb);
    expect(cb).toBeChecked();
  });

  it('fires Remove missing boxes when confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    let hit = 0;
    server.use(
      http.post('/api/runviewer/scans/remove-missing', () => {
        hit++;
        return HttpResponse.json({ response: 'ok' });
      }),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Remove missing boxes/ }));
    await waitFor(() => expect(hit).toBeGreaterThan(0));
  });

  it('aborts Remove missing boxes when confirm cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    let hit = 0;
    server.use(
      http.post('/api/runviewer/scans/remove-missing', () => {
        hit++;
        return HttpResponse.json({ response: 'ok' });
      }),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Remove missing boxes/ }));
    expect(hit).toBe(0);
  });

  it('US tenant defaults to Routed mode', async () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, isUsTenant: true };
    renderPage();
    // Routed button should be active - can check by class or aria-pressed
    expect(await screen.findByText(/No routed shipments/)).toBeInTheDocument();
  });

  // ------------------------------------------------------------------
  // Sort / filter / search / pagination (Kevin 2026-08-14 task)
  // ------------------------------------------------------------------

  const bulkFixture = (n: number) => Array.from({ length: n }, (_, i) => ({
    bulkJobId: i + 1,
    bulkParentId: null,
    jobNumber: `JOB-${String(i + 1).padStart(4, '0')}`,
    clientCode: i % 2 === 0 ? 'ACME' : 'ZONE',
    deliveryDate: null,
    readyTime: null,
    toAddress: `Addr ${i + 1}`,
    items: (i % 5) + 1,
    sortScanned: 0,
    runScanned: 0,
    pickScanned: 0,
    invalidPickScanned: 0,
    transferScanned: 0,
    transitScanned: 0,
  }));

  it('sorts Bulk rows when a column header is clicked, then flips on second click', async () => {
    server.use(
      http.get('/api/runviewer/scans', () => HttpResponse.json({
        response: [
          bulkFixture(1)[0],
          { ...bulkFixture(1)[0], bulkJobId: 2, jobNumber: 'AAAA-0001', clientCode: 'ZONE' },
          { ...bulkFixture(1)[0], bulkJobId: 3, jobNumber: 'MMMM-0001', clientCode: 'MID' },
        ],
      })),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    // Default asc-by-jobNumber puts AAAA first
    const cells1 = await screen.findAllByText(/AAAA|MMMM|JOB-0001/);
    expect(cells1[0]).toHaveTextContent('AAAA-0001');
    // Click again to flip Job # desc
    await user.click(screen.getByText('Job #'));
    await waitFor(() => {
      const cells2 = screen.getAllByText(/AAAA|MMMM|JOB-0001/);
      expect(cells2[0]).toHaveTextContent('MMMM-0001');
    });
  });

  it('narrows Bulk rows via the client-side search (debounced)', async () => {
    server.use(
      http.get('/api/runviewer/scans', () => HttpResponse.json({
        response: [
          { ...bulkFixture(1)[0], bulkJobId: 1, jobNumber: 'ALPHA-1', clientCode: 'ACME' },
          { ...bulkFixture(1)[0], bulkJobId: 2, jobNumber: 'BRAVO-2', clientCode: 'BETA' },
        ],
      })),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    expect(await screen.findByText('ALPHA-1')).toBeInTheDocument();
    expect(screen.getByText('BRAVO-2')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('Search jobs...'), 'alpha');
    // 200ms debounce - poll for the row to disappear
    await waitFor(() => {
      expect(screen.queryByText('BRAVO-2')).not.toBeInTheDocument();
      expect(screen.getByText('ALPHA-1')).toBeInTheDocument();
    }, { timeout: 1500 });
  });

  it('paginates Bulk rows in 100-row chunks and steps via the pager', async () => {
    // 150 rows -> two pages. Page 1 shows JOB-0001..JOB-0100, page 2 the rest.
    server.use(
      http.get('/api/runviewer/scans', () => HttpResponse.json({ response: bulkFixture(150) })),
      ...baseline(),
    );
    renderPage();
    // First page contains JOB-0001 but not JOB-0150.
    expect(await screen.findByText('JOB-0001')).toBeInTheDocument();
    expect(screen.queryByText('JOB-0150')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(screen.getByText('JOB-0150')).toBeInTheDocument();
      expect(screen.queryByText('JOB-0001')).not.toBeInTheDocument();
    });
  });

  // ------------------------------------------------------------------
  // Bulk parent -> child -> item tree expansion (Kevin 2026-08-14 task)
  // Mirrors legacy scans/tpls/jobList.tpl 3-level structure.
  // ------------------------------------------------------------------

  it('renders an expand chevron on Bulk parent rows with items > 1', async () => {
    server.use(
      http.get('/api/runviewer/scans', () =>
        HttpResponse.json({
          response: [
            {
              bulkJobId: 1, bulkParentId: null, jobNumber: 'PARENT-1', clientCode: 'ACME',
              deliveryDate: null, readyTime: null, toAddress: null,
              items: 3, sortScanned: 0, runScanned: 0, pickScanned: 0,
              invalidPickScanned: 0, transferScanned: 0, transitScanned: 0,
            },
            // Single-item job - should NOT get a chevron
            {
              bulkJobId: 2, bulkParentId: null, jobNumber: 'PARENT-2', clientCode: 'ACME',
              deliveryDate: null, readyTime: null, toAddress: null,
              items: 1, sortScanned: 0, runScanned: 0, pickScanned: 0,
              invalidPickScanned: 0, transferScanned: 0, transitScanned: 0,
            },
          ],
        })),
      ...baseline(),
    );
    renderPage();
    // Wait for both parents to render
    expect(await screen.findByText('PARENT-1')).toBeInTheDocument();
    expect(screen.getByText('PARENT-2')).toBeInTheDocument();
    // Only PARENT-1 (items > 1) should have an Expand chevron
    const expandButtons = screen.getAllByRole('button', { name: 'Expand' });
    expect(expandButtons).toHaveLength(1);
  });

  it('expands a Bulk parent to reveal child rows (no lazy fetch)', async () => {
    server.use(
      http.get('/api/runviewer/scans', () =>
        HttpResponse.json({
          response: [
            {
              bulkJobId: 10, bulkParentId: null, jobNumber: 'PARENT-A', clientCode: 'ACME',
              deliveryDate: null, readyTime: null, toAddress: null,
              items: 2, sortScanned: 0, runScanned: 0, pickScanned: 0,
              invalidPickScanned: 0, transferScanned: 0, transitScanned: 0,
            },
            {
              bulkJobId: 11, bulkParentId: 10, jobNumber: 'CHILD-1', clientCode: 'ACME',
              deliveryDate: null, readyTime: null, toAddress: null,
              items: 1, sortScanned: 0, runScanned: 0, pickScanned: 0,
              invalidPickScanned: 0, transferScanned: 0, transitScanned: 0,
            },
            {
              bulkJobId: 12, bulkParentId: 10, jobNumber: 'CHILD-2', clientCode: 'ACME',
              deliveryDate: null, readyTime: null, toAddress: null,
              items: 1, sortScanned: 0, runScanned: 0, pickScanned: 0,
              invalidPickScanned: 0, transferScanned: 0, transitScanned: 0,
            },
          ],
        })),
      ...baseline(),
    );
    renderPage();
    expect(await screen.findByText('PARENT-A')).toBeInTheDocument();
    // Children not visible until parent is expanded
    expect(screen.queryByText('CHILD-1')).not.toBeInTheDocument();
    expect(screen.queryByText('CHILD-2')).not.toBeInTheDocument();
    // Child rows should NOT render as top-level parents either
    // (they're bulkParentId != null so they're filtered out)
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    expect(await screen.findByText('CHILD-1')).toBeInTheDocument();
    expect(screen.getByText('CHILD-2')).toBeInTheDocument();
  });

  it('lazy-loads per-item barcodes when a childless Bulk parent is expanded', async () => {
    let itemsHit = 0;
    server.use(
      http.get('/api/runviewer/scans', () =>
        HttpResponse.json({
          response: [
            {
              bulkJobId: 50, bulkParentId: null, jobNumber: 'PARENT-M', clientCode: 'ACME',
              deliveryDate: null, readyTime: null, toAddress: null,
              items: 3, sortScanned: 0, runScanned: 0, pickScanned: 0,
              invalidPickScanned: 0, transferScanned: 0, transitScanned: 0,
            },
          ],
        })),
      http.get('/api/runviewer/jobs/items', () => {
        itemsHit++;
        return HttpResponse.json({
          response: [
            {
              bulkJobItemId: 501, bulkJobId: 50, barcode: 'BC-A', itemName: null,
              weight: 1, length: 1, height: 1, depth: 1,
              sortScanned: false, runScanned: false, pickScanned: false,
              invalidPickScanned: false, transferScanned: false, transitScanned: false,
            },
          ],
        });
      }),
      ...baseline(),
    );
    renderPage();
    expect(await screen.findByText('PARENT-M')).toBeInTheDocument();
    const user = userEvent.setup();
    // Legacy toggleExpand behavior: with no children and items > 1, the
    // parent chevron fires the item-fetch directly (one click, not two).
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    await waitFor(() => expect(itemsHit).toBe(1));
    expect(await screen.findByText(/PARENT-M-A/)).toBeInTheDocument();
  });

  it('lazy-loads per-item barcodes under an expanded child row', async () => {
    let itemsHit = 0;
    const seenBulkJobIds: string[] = [];
    server.use(
      http.get('/api/runviewer/scans', () =>
        HttpResponse.json({
          response: [
            {
              bulkJobId: 70, bulkParentId: null, jobNumber: 'PARENT-K', clientCode: 'ACME',
              deliveryDate: null, readyTime: null, toAddress: null,
              items: 2, sortScanned: 0, runScanned: 0, pickScanned: 0,
              invalidPickScanned: 0, transferScanned: 0, transitScanned: 0,
            },
            {
              bulkJobId: 71, bulkParentId: 70, jobNumber: 'CHILD-K1', clientCode: 'ACME',
              deliveryDate: null, readyTime: null, toAddress: null,
              items: 4, sortScanned: 0, runScanned: 0, pickScanned: 0,
              invalidPickScanned: 0, transferScanned: 0, transitScanned: 0,
            },
          ],
        })),
      http.get('/api/runviewer/jobs/items', ({ request }) => {
        itemsHit++;
        seenBulkJobIds.push(new URL(request.url).searchParams.get('bulkJobId') ?? '');
        return HttpResponse.json({
          response: [
            {
              bulkJobItemId: 711, bulkJobId: 71, barcode: 'BC-KC1', itemName: null,
              weight: null, length: null, height: null, depth: null,
              sortScanned: true, runScanned: false, pickScanned: false,
              invalidPickScanned: false, transferScanned: false, transitScanned: false,
            },
          ],
        });
      }),
      ...baseline(),
    );
    renderPage();
    expect(await screen.findByText('PARENT-K')).toBeInTheDocument();
    const user = userEvent.setup();
    // Expand parent first
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    expect(await screen.findByText('CHILD-K1')).toBeInTheDocument();
    // Now a second Expand chevron appears next to CHILD-K1's items count
    const expands = screen.getAllByRole('button', { name: 'Expand' });
    // The last Expand is the child's items chevron (parent's chevron is now Collapse)
    await user.click(expands[expands.length - 1]);
    await waitFor(() => expect(itemsHit).toBe(1));
    // Confirm the item-fetch was scoped to the child bulkJobId (71),
    // not the parent (70)
    expect(seenBulkJobIds).toEqual(['71']);
  });

  // ------------------------------------------------------------------
  // Routed extras (Kevin 2026-08-14 task #47 + #48):
  //   - Stage swatch pill tinted by keyword parse of stage text
  //   - Tote column derived from item-progress on expand
  //   - Item badge with warning triangle when hasShort is true
  //   - Right-click opens an empty context-menu shell (task #48)
  // ------------------------------------------------------------------

  it('renders the Stage swatch pill with a colour class derived from the stage keywords', async () => {
    server.use(
      http.get('/api/runviewer/scans/routed', () => HttpResponse.json({
        response: [
          {
            jobId: 1, clientCode: 'A', jobNumber: 'J-DONE', toAddress: 'x',
            suburb: null, stage: 'Delivered', legs: '[]',
            scannedItems: 1, expectedItems: 1, hasShort: false, isDivergent: false,
          },
          {
            jobId: 2, clientCode: 'A', jobNumber: 'J-MOVING', toAddress: 'x',
            suburb: null, stage: 'LH1 - in transit', legs: '[]',
            scannedItems: 0, expectedItems: 1, hasShort: false, isDivergent: false,
          },
          {
            jobId: 3, clientCode: 'A', jobNumber: 'J-SHORT', toAddress: 'x',
            suburb: null, stage: 'Item -3 short (LH1)', legs: '[]',
            scannedItems: 0, expectedItems: 3, hasShort: true, isDivergent: false,
          },
        ],
      })),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Routed' }));
    // Wait for the rows to land.
    expect(await screen.findByText('J-DONE')).toBeInTheDocument();
    const swatches = screen.getAllByTestId('sm-stage-swatch');
    expect(swatches).toHaveLength(3);
    // First = "Delivered" -> emerald tint (bg-emerald-100)
    expect(swatches[0].className).toContain('bg-emerald-100');
    // Second = "in transit" -> amber tint (bg-amber-100)
    expect(swatches[1].className).toContain('bg-amber-100');
    // Third = "short" -> red tint (bg-red-100)
    expect(swatches[2].className).toContain('bg-red-100');
  });

  it('renders the Tote column ("-" until item-progress loads, then derived value)', async () => {
    server.use(
      http.get('/api/runviewer/scans/routed', () => HttpResponse.json({
        response: [
          {
            jobId: 555, clientCode: 'A', jobNumber: 'J-TOTE', toAddress: 'x',
            suburb: null, stage: 'LH1 - in transit', legs: '[]',
            scannedItems: 1, expectedItems: 1, hasShort: false, isDivergent: false,
          },
        ],
      })),
      http.get('/api/runviewer/scans/item-progress', () => HttpResponse.json({
        response: [
          {
            jobId: 555, itemBarcode: 'BC-1', leg: 'LH1', state: 'completed',
            tote: 'TOTE-999', isCurrent: false, scanTime: null,
          },
        ],
      })),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Routed' }));
    expect(await screen.findByText('J-TOTE')).toBeInTheDocument();
    // Before expand - Tote column shows "-" (default)
    const toteBefore = screen.getByTestId('sm-tote-cell');
    expect(toteBefore).toHaveTextContent('-');
    // Expand to trigger item-progress fetch
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    // After the fetch resolves the derived tote value renders
    await waitFor(() => {
      expect(screen.getByTestId('sm-tote-cell')).toHaveTextContent('TOTE-999');
    });
  });

  it('renders the item badge with warning triangle when hasShort is true', async () => {
    server.use(
      http.get('/api/runviewer/scans/routed', () => HttpResponse.json({
        response: [
          {
            jobId: 1, clientCode: 'A', jobNumber: 'J-OK', toAddress: 'x',
            suburb: null, stage: 'Delivered', legs: '[]',
            scannedItems: 3, expectedItems: 3, hasShort: false, isDivergent: false,
          },
          {
            jobId: 2, clientCode: 'A', jobNumber: 'J-BAD', toAddress: 'x',
            suburb: null, stage: 'Item -3 short (LH1)', legs: '[]',
            scannedItems: 1, expectedItems: 3, hasShort: true, isDivergent: false,
          },
        ],
      })),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Routed' }));
    expect(await screen.findByText('J-OK')).toBeInTheDocument();
    // Rows are sorted asc-by-jobNumber, so J-BAD renders before J-OK.
    const okRow = screen.getByText('J-OK').closest('tr')!;
    const badRow = screen.getByText('J-BAD').closest('tr')!;
    const okBadge = okRow.querySelector('[data-testid="sm-item-badge"]')!;
    const badBadge = badRow.querySelector('[data-testid="sm-item-badge"]')!;
    // J-OK has no warning icon + no red tint
    expect(okBadge.className).not.toContain('bg-red-100');
    expect(okBadge.querySelector('[data-testid="sm-item-badge-warn"]')).toBeNull();
    // J-BAD shows red tint + warning icon
    expect(badBadge.className).toContain('bg-red-100');
    expect(badBadge.querySelector('[data-testid="sm-item-badge-warn"]')).not.toBeNull();
  });

  it('opens an empty context-menu shell on right-click of a Routed row (task #48 Section Z placeholder)', async () => {
    server.use(
      http.get('/api/runviewer/scans/routed', () => HttpResponse.json({
        response: [
          {
            jobId: 42, clientCode: 'A', jobNumber: 'J-MENU', toAddress: 'x',
            suburb: null, stage: 'Delivered', legs: '[]',
            scannedItems: 1, expectedItems: 1, hasShort: false, isDivergent: false,
          },
        ],
      })),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Routed' }));
    const row = await screen.findByText('J-MENU');
    // Menu should not be mounted before the right-click.
    expect(screen.queryByText('Job J-MENU')).not.toBeInTheDocument();
    // Fire native contextmenu event (userEvent has no direct helper).
    row.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 50, clientY: 60, button: 2,
    }));
    // The menu title renders even though items[] is empty (hook, not feature).
    expect(await screen.findByText('Job J-MENU')).toBeInTheDocument();
  });

  it('opens an empty context-menu shell on right-click of a Bulk parent row', async () => {
    server.use(
      http.get('/api/runviewer/scans', () => HttpResponse.json({
        response: [
          {
            bulkJobId: 1, bulkParentId: null, jobNumber: 'BULK-MENU', clientCode: 'A',
            deliveryDate: null, readyTime: null, toAddress: null,
            items: 1, sortScanned: 0, runScanned: 0, pickScanned: 0,
            invalidPickScanned: 0, transferScanned: 0, transitScanned: 0,
          },
        ],
      })),
      ...baseline(),
    );
    renderPage();
    const cell = await screen.findByText('BULK-MENU');
    expect(screen.queryByText('Job BULK-MENU')).not.toBeInTheDocument();
    cell.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 2,
    }));
    expect(await screen.findByText('Job BULK-MENU')).toBeInTheDocument();
  });

  it('forwards Client selection to the SP as clientIds query param and re-renders on the refetched row set', async () => {
    const scanCalls: string[] = [];
    server.use(
      http.get('/api/runviewer/scans', ({ request }) => {
        const url = new URL(request.url);
        const ids = url.searchParams.get('clientIds') ?? '';
        scanCalls.push(ids);
        // Backend narrows via ClientIds. Simulate: no filter -> both
        // rows, filter=1 -> ACME only.
        const rows = ids === '1'
          ? [{ ...bulkFixture(1)[0], bulkJobId: 1, jobNumber: 'J-1', clientCode: 'ACME' }]
          : [
            { ...bulkFixture(1)[0], bulkJobId: 1, jobNumber: 'J-1', clientCode: 'ACME' },
            { ...bulkFixture(1)[0], bulkJobId: 2, jobNumber: 'J-2', clientCode: 'ZONE' },
          ];
        return HttpResponse.json({ response: rows });
      }),
      http.get('/api/runviewer/filters/clients', () => HttpResponse.json({
        response: [
          { id: 1, label: 'ACME Freight Ltd' },
          { id: 2, label: 'ZONE Logistics' },
        ],
      })),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    // Initial unfiltered fetch returns both rows.
    expect(await screen.findByText('J-1')).toBeInTheDocument();
    expect(screen.getByText('J-2')).toBeInTheDocument();
    // Open the Clients dropdown and pick ACME.
    await user.click(screen.getByRole('button', { name: /^Clients/ }));
    await user.click(await screen.findByText('ACME Freight Ltd'));
    // Second fetch fires with clientIds=1 and only J-1 renders.
    await waitFor(() => {
      expect(scanCalls).toContain('1');
      expect(screen.queryByText('J-2')).not.toBeInTheDocument();
      expect(screen.getByText('J-1')).toBeInTheDocument();
    });
  });
});
