import { test, expect, type Page } from '@playwright/test';
import {
  MEDICAL_CLIENT_ID, RUN_DATE, WILL_CALL_COURIER, WILL_CALL_SPEED_ID,
  job, json, mockWillCall, postsTo, routeRun, seedFilters, type Job,
} from './fixtures/willCallMocks';

// #1001 comment (Kenneth, Medical prod): with the Will Call speed filter on,
// the Burbank to Lab grid showed 2 jobs, but the run right-click menu's
// Assign Route handed the whole run (all speeds) to the dialog, and the
// run-menu Transfer Route sent an empty id list and always got a 400.
//
// Before the fix (RvRunContextMenu.tsx at HEAD): doAssign called
// getRunJobs(runId, runDate) with no filters, and Transfer Route opened the
// dialog with only runDate, so it fetched the run unfiltered too.
//
// Rule now (Steve D4): a run-level action covers exactly the jobs the
// on-screen filters select. For the run shown in the grid that is the
// grid's rows; for any other run it is a fetch carrying the same filters.

const BURBANK_TO_LAB = routeRun(-15, 'Burbank to Lab', { courierCode: WILL_CALL_COURIER.code });
const LAB_TO_BURBANK = routeRun(-14, 'Lab to Burbank', { courierCode: WILL_CALL_COURIER.code });

const WILL_CALL_JOBS: Job[] = [
  job(20857, 'E896WILLDEL', -15, 'Burbank to Lab'),
  job(20866, 'E897WILLDEL', -15, 'Burbank to Lab'),
];
// Same run, another speed: the speed filter must keep it out.
const STAT_JOB = job(20900, 'E900STAT', -15, 'Burbank to Lab', { speedId: 401, speedName: 'Stat' });

/** Answers like RVW_stpBulkRunJobs: with the Will Call speed filter only
 *  the Will Call rows, without it the whole run. */
const burbankJobs = (q: URLSearchParams) =>
  q.get('speedIds') === String(WILL_CALL_SPEED_ID) ? WILL_CALL_JOBS : [...WILL_CALL_JOBS, STAT_JOB];

const FILTERED = {
  speedIds: [WILL_CALL_SPEED_ID],
  clientIds: [MEDICAL_CLIENT_ID],
  courierId: WILL_CALL_COURIER.courierId,
};

async function setup(page: Page, filtered: boolean) {
  await seedFilters(page, filtered ? FILTERED : {});
  const rec = await mockWillCall(page, {
    runs: [BURBANK_TO_LAB, LAB_TO_BURBANK],
    jobsByRun: { [-15]: burbankJobs, [-14]: [] },
    activeCouriers: [WILL_CALL_COURIER],
  });
  await page.route(/\/api\/runviewer\/couriers\/search(\?.*)?$/, (route) =>
    json(route, { response: [{ courierId: 31, name: 'Dana Driver', code: 'DD1', fleet: null, activeJobs: 0 }] }));
  await page.route(/\/api\/runviewer\/jobs\/assign$/, (route) => {
    const ids = (route.request().postDataJSON() as { jobIds: number[] }).jobIds;
    return json(route, {
      response: { succeeded: ids.length, failed: 0, errors: [], targetType: 'Courier', targetId: 31, displayName: 'Dana Driver' },
    });
  });
  // Server shape: RouteTransferContextResponse (RouteTransferDto.cs:11-26).
  await page.route(/\/api\/runviewer\/routes\/active(\?.*)?$/, (route) =>
    json(route, {
      response: {
        currentRouteId: null,
        currentRouteName: null,
        routes: [
          { id: 14, name: 'Lab to Burbank', area: 'Burbank' },
          { id: 15, name: 'Burbank to Lab', area: 'Burbank' },
        ],
      },
    }));
  await page.route(/\/api\/runviewer\/jobs\/transfer-route$/, (route) => {
    const ids = (route.request().postDataJSON() as { jobIds: number[] }).jobIds;
    return json(route, {
      response: {
        succeeded: ids.length, failed: 0, rowsUpdated: ids.length, bookingsAffected: 0, bookingRowsUpdated: 0,
        zipCodesMoved: 0, zipMappingsInserted: 0, zipMappingsDeleted: 0, zipCodes: [], families: [], errors: [],
        newRouteId: 14, newRouteName: 'Lab to Burbank', alsoTransferredRecurringBooking: false, alsoTransferredZipCodes: false,
      },
    });
  });
  return rec;
}

const runCell = (page: Page, name: string) => page.getByRole('cell', { name, exact: true });

async function assignToDana(page: Page) {
  await expect(page.getByRole('dialog', { name: 'Assign route' })).toBeVisible();
  await page.getByPlaceholder('Search couriers...').fill('dana');
  await page.getByRole('button', { name: /Dana Driver/ }).click();
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
}

test.describe('Route Viewer run menu uses the on-screen filters (#1001)', () => {
  test('Assign Route on the run in the grid assigns only the filtered rows', async ({ page }) => {
    const rec = await setup(page, true);
    await page.goto(`/route-viewer?runDate=${RUN_DATE}`);

    await runCell(page, 'Burbank to Lab').click();
    await expect(page.getByText('E896WILLDEL')).toBeVisible();
    await expect(page.getByText('E900STAT')).toHaveCount(0);

    await runCell(page, 'Burbank to Lab').click({ button: 'right' });
    await page.getByRole('button', { name: 'Assign Route', exact: true }).click();
    await assignToDana(page);

    await expect.poll(() => postsTo(rec, '/api/runviewer/jobs/assign').length).toBe(1);
    const [body] = postsTo(rec, '/api/runviewer/jobs/assign');
    // The regression: the whole run (E900STAT included) was assigned.
    expect(body.jobIds).toEqual([20857, 20866]);
  });

  test('Assign Route on a run not shown in the grid fetches with every filter', async ({ page }) => {
    const rec = await setup(page, true);
    await page.goto(`/route-viewer?runDate=${RUN_DATE}`);

    // Two runs selected = no single run in the grid, so the menu must fetch.
    await runCell(page, 'Burbank to Lab').click();
    await runCell(page, 'Lab to Burbank').click({ modifiers: ['Control'] });
    await expect(page.getByText('Pick a run to see its jobs.')).toBeVisible();
    const before = rec.jobFetches.length;

    await runCell(page, 'Burbank to Lab').click({ button: 'right' });
    await page.getByRole('button', { name: 'Assign Route', exact: true }).click();
    await assignToDana(page);

    const menuFetches = rec.jobFetches.slice(before).filter((u) => u.pathname.endsWith('/runs/-15/jobs'));
    expect(menuFetches.length).toBeGreaterThan(0);
    const q = menuFetches[0].searchParams;
    expect(q.get('runDate')).toBe(RUN_DATE);
    expect(q.get('group')).toBe('Combined');
    expect(q.get('speedIds')).toBe(String(WILL_CALL_SPEED_ID));
    expect(q.get('clientIds')).toBe(String(MEDICAL_CLIENT_ID));
    expect(q.get('courierId')).toBe(String(WILL_CALL_COURIER.courierId));

    await expect.poll(() => postsTo(rec, '/api/runviewer/jobs/assign').length).toBe(1);
    expect(postsTo(rec, '/api/runviewer/jobs/assign')[0].jobIds).toEqual([20857, 20866]);
  });

  test('Transfer Route from the run menu sends the filtered tucJob ids', async ({ page }) => {
    const rec = await setup(page, true);
    await page.goto(`/route-viewer?runDate=${RUN_DATE}`);

    await runCell(page, 'Burbank to Lab').click();
    await expect(page.getByText('E896WILLDEL')).toBeVisible();

    await runCell(page, 'Burbank to Lab').click({ button: 'right' });
    await page.getByRole('button', { name: 'Transfer Route', exact: true }).click();

    const picker = page.locator('select').filter({ has: page.locator('option', { hasText: '-- pick a route --' }) });
    await picker.selectOption({ label: 'Lab to Burbank' });
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByTestId('transfer-preview-table')).toContainText('E896WILLDEL');
    await expect(page.getByTestId('transfer-preview-table')).not.toContainText('E900STAT');
    await page.getByRole('button', { name: 'Transfer', exact: true }).click();

    await expect.poll(() => postsTo(rec, '/api/runviewer/jobs/transfer-route').length).toBe(1);
    const [body] = postsTo(rec, '/api/runviewer/jobs/transfer-route');
    // The regression: [] (always a 400) or the whole run.
    expect(body).toMatchObject({ jobIds: [20857, 20866], newRouteId: 14 });
  });

  // Regression guard (found 2026-11-09 with the first E2E pass). Right-
  // clicking a run that is not yet selected makes it the single selected
  // run, so the grid is still loading it when the menu opens. The menu
  // must not read that empty grid as "no jobs" (it toasted "No jobs on this
  // run for the current filters."); RunViewer now hands the grid's rows to
  // the menu only once the Run Jobs query has answered for the current key.
  /** Delays one run's Run Jobs response so the menu opens before it lands. */
  async function delayRunJobs(page: Page, rec: { jobFetches: URL[] }, runId: number, rows: (q: URLSearchParams) => Job[]) {
    await page.route(new RegExp(`/api/runviewer/runs/${runId}/jobs(\\?.*)?$`), async (route) => {
      const url = new URL(route.request().url());
      rec.jobFetches.push(url);
      await new Promise((r) => setTimeout(r, 2_000));
      return json(route, { response: rows(url.searchParams) });
    });
  }

  test('Assign Route on a run right-clicked before its jobs have loaded still finds the jobs', async ({ page }) => {
    const rec = await setup(page, true);
    await delayRunJobs(page, rec, -15, burbankJobs);
    await page.goto(`/route-viewer?runDate=${RUN_DATE}`);

    await runCell(page, 'Burbank to Lab').click({ button: 'right' });
    await page.getByRole('button', { name: 'Assign Route', exact: true }).click();
    await assignToDana(page);
    await expect(page.getByText(/No jobs on this run/)).toHaveCount(0);

    await expect.poll(() => postsTo(rec, '/api/runviewer/jobs/assign').length).toBe(1);
    expect(postsTo(rec, '/api/runviewer/jobs/assign')[0].jobIds).toEqual([20857, 20866]);
  });

  test('right-clicking run B while run A is loaded fetches run B with the filters, never reuses run A', async ({ page }) => {
    const rec = await setup(page, true);
    const LAB_JOBS = [job(30001, 'E901WILLDEL', -14, 'Lab to Burbank'), job(30002, 'E902WILLDEL', -14, 'Lab to Burbank')];
    const LAB_STAT = job(30003, 'E903STAT', -14, 'Lab to Burbank', { speedId: 401, speedName: 'Stat' });
    await delayRunJobs(page, rec, -14, (q) =>
      q.get('speedIds') === String(WILL_CALL_SPEED_ID) ? LAB_JOBS : [...LAB_JOBS, LAB_STAT]);
    await page.goto(`/route-viewer?runDate=${RUN_DATE}`);

    // Run A in the grid, loaded.
    await runCell(page, 'Burbank to Lab').click();
    await expect(page.getByText('E896WILLDEL')).toBeVisible();

    // Run B, not selected and slow to answer.
    await runCell(page, 'Lab to Burbank').click({ button: 'right' });
    await page.getByRole('button', { name: 'Assign Route', exact: true }).click();
    await assignToDana(page);
    await expect(page.getByText(/No jobs on this run/)).toHaveCount(0);

    const bFetches = rec.jobFetches.filter((u) => u.pathname.endsWith('/runs/-14/jobs'));
    expect(bFetches.length).toBeGreaterThan(0);
    for (const u of bFetches) {
      expect(u.searchParams.get('speedIds')).toBe(String(WILL_CALL_SPEED_ID));
      expect(u.searchParams.get('clientIds')).toBe(String(MEDICAL_CLIENT_ID));
      expect(u.searchParams.get('courierId')).toBe(String(WILL_CALL_COURIER.courierId));
    }

    await expect.poll(() => postsTo(rec, '/api/runviewer/jobs/assign').length).toBe(1);
    // Run B's filtered rows only: not run A's 20857/20866, not B's Stat job.
    expect(postsTo(rec, '/api/runviewer/jobs/assign')[0].jobIds).toEqual([30001, 30002]);
  });

  test('control: with no filter Assign Route covers the whole run', async ({ page }) => {
    const rec = await setup(page, false);
    await page.goto(`/route-viewer?runDate=${RUN_DATE}`);

    await runCell(page, 'Burbank to Lab').click();
    await expect(page.getByText('E900STAT')).toBeVisible();

    await runCell(page, 'Burbank to Lab').click({ button: 'right' });
    await page.getByRole('button', { name: 'Assign Route', exact: true }).click();
    await assignToDana(page);

    await expect.poll(() => postsTo(rec, '/api/runviewer/jobs/assign').length).toBe(1);
    expect(postsTo(rec, '/api/runviewer/jobs/assign')[0].jobIds).toEqual([20857, 20866, 20900]);
    // No filter was sent, so none must appear on any run-jobs fetch.
    for (const u of rec.jobFetches) {
      expect(u.searchParams.get('speedIds')).toBeNull();
      expect(u.searchParams.get('clientIds')).toBeNull();
      expect(u.searchParams.get('courierId')).toBeNull();
    }
  });
});
