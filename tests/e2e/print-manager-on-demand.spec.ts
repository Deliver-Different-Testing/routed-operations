import { test, expect, type Page, type Request } from '@playwright/test';
import { mockRouteViewerApis } from './fixtures/routeViewerMocks';
import { json } from './fixtures/willCallMocks';

// #880 (contract 3): Print Manager's "Include on-demand" toggle. Off (the
// default) the page asks for the print list and prints exactly as before.
// On, it asks RVW_stpPrintJobsV2 for the tucJob-only jobs too (bulkJobId 0)
// and one Print click prints them through Mode 8 by their tucJob ids, next to
// the bulk rows' unchanged Mode 4 request.

const BULK_ROW = {
  bulkJobId: 501, jobId: 7001, jobNumber: 'B501', clientCode: 'BLU', qty: 1,
  bookDate: null, bookTime: null, multiBox: false,
};
const ON_DEMAND_ROW = {
  bulkJobId: 0, jobId: 8001, jobNumber: 'OD8001', clientCode: 'BLU', qty: 1,
  bookDate: null, bookTime: null, multiBox: false,
};

interface Recorder {
  listQueries: URLSearchParams[];
  prints: Array<Record<string, unknown>>;
}

async function mockPrintManager(page: Page): Promise<Recorder> {
  await mockRouteViewerApis(page);
  const rec: Recorder = { listQueries: [], prints: [] };
  await page.route(/\/api\/runviewer\/jobs\/print-list(\?.*)?$/, (route) => {
    const q = new URL(route.request().url()).searchParams;
    rec.listQueries.push(q);
    const rows = q.get('includeOnDemand') === 'true' ? [BULK_ROW, ON_DEMAND_ROW] : [BULK_ROW];
    return json(route, { response: rows });
  });
  await page.route(/\/api\/runviewer\/labels\/bulk-jobs$/, (route) => {
    rec.prints.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' });
  });
  // The PDF opens in a new tab; keep it from navigating anywhere real.
  await page.addInitScript(() => { window.open = () => null; });
  return rec;
}

const isPrint = (r: Request) => r.url().endsWith('/api/runviewer/labels/bulk-jobs') && r.method() === 'POST';

test('toggle off by default: the list request and the print payload are unchanged', async ({ page }) => {
  const rec = await mockPrintManager(page);
  await page.goto('/route-viewer/print');

  const toggle = page.getByRole('checkbox', { name: 'Include on-demand' });
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole('cell', { name: 'B501', exact: true })).toBeVisible();
  for (const q of rec.listQueries) expect(q.has('includeOnDemand')).toBe(false);

  await page.getByRole('button', { name: 'Select all' }).click();
  const printed = page.waitForRequest(isPrint);
  await page.getByRole('button', { name: 'Print Labels (1)' }).click();
  await printed;
  await expect.poll(() => rec.prints.length).toBe(1);
  // Today's Print Manager payload (buildBulkJobsLabelPayload), byte for byte.
  expect(JSON.stringify(rec.prints[0])).toBe(JSON.stringify({
    bookDate: rec.prints[0].bookDate,
    sortMode: 1,
    runName: null,
    jobIds: null,
    bulkJobIds: '501',
    clientIds: null,
    regionIds: null,
    speedIds: null,
  }));
});

test('toggle on: on-demand rows list, and one Print sends them through Mode 8 by jobId', async ({ page }) => {
  const rec = await mockPrintManager(page);
  await page.goto('/route-viewer/print');
  await expect(page.getByRole('cell', { name: 'B501', exact: true })).toBeVisible();

  await page.getByRole('checkbox', { name: 'Include on-demand' }).check();
  await expect(page.getByRole('cell', { name: 'OD8001', exact: true })).toBeVisible();
  expect(rec.listQueries.at(-1)?.get('includeOnDemand')).toBe('true');

  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Print Labels (2)' }).click();
  await expect.poll(() => rec.prints.length).toBe(2);

  const bulk = rec.prints.find((p) => p.bulkJobIds != null);
  const onDemand = rec.prints.find((p) => p.jobIds != null);
  // Bulk rows: the same Mode 4 request as with the toggle off.
  expect(bulk).toMatchObject({ bulkJobIds: '501', jobIds: null, runName: null });
  // On-demand rows: JobIds only, which RouteViewerLabelService turns into Mode 8.
  expect(onDemand).toMatchObject({ jobIds: '8001', bulkJobIds: null, runName: null });
});
