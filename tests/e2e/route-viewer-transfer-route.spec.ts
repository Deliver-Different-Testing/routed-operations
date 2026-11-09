import { test, expect, type Page, type Route } from '@playwright/test';
import { RUN_DATE, job, json, mockWillCall, postsTo, routeRun, seedFilters, type WillCallRecorder } from './fixtures/willCallMocks';

// #1004 (Kenneth, Medical prod): Transfer Route on a Will Call DEL moved the
// whole family and then answered 500. This spec covers the front-end half:
//
//   - the route picker must load from the server's real shape,
//     RouteTransferContextResponse `{ currentRouteId, currentRouteName,
//     routes: [{ id, name, area }] }` (RouteTransferDto.cs:11-26, returned
//     as `{ response: ctx }` by RunViewerRouteTransferController.cs:29-30).
//     At HEAD the client typed it as a bare `{ routeId, label }[]` and the
//     dialog called `.filter` on the object;
//   - a proc rejection (400 `{ message }`, RunViewerRouteTransferController.cs:72-77)
//     must show that message, not a success toast;
//   - anchors the proc did not move (`failed` > 0) are reported;
//   - drag and drop of grid rows onto a route run must send the ROUTE id
//     (synthetic run id is -RouteId) and tucJob ids. At HEAD it sent the run
//     id as the route id and bulk job ids as the job ids.
//
// Fixture ids are chosen so the id spaces cannot be confused: run -15 is
// route 15, run -14 is route 14, every job's bulkJobId is jobId + 900000.

const BURBANK_TO_LAB = routeRun(-15, 'Burbank to Lab');
const LAB_TO_BURBANK = routeRun(-14, 'Lab to Burbank');
// A real tblBulkRun row: positive id, not a route.
const BULK_RUN = routeRun(96247, 'Run 1', { area: 'Palmerston North' });

const JOBS = [
  job(20857, 'E896WILLDEL', -15, 'Burbank to Lab'),
  job(20866, 'E897WILLDEL', -15, 'Burbank to Lab'),
];

const ROUTE_CONTEXT = {
  currentRouteId: null,
  currentRouteName: null,
  routes: [
    { id: 14, name: 'Lab to Burbank', area: 'Burbank' },
    { id: 15, name: 'Burbank to Lab', area: 'Burbank' },
    { id: 22, name: 'Irvine Loop', area: 'Irvine' },
  ],
};

const transferResult = (over: Record<string, unknown> = {}) => ({
  succeeded: 1, failed: 0, rowsUpdated: 1, bookingsAffected: 0, bookingRowsUpdated: 0,
  zipCodesMoved: 0, zipMappingsInserted: 0, zipMappingsDeleted: 0, zipCodes: [], families: [], errors: [],
  newRouteId: 14, newRouteName: 'Lab to Burbank', alsoTransferredRecurringBooking: false, alsoTransferredZipCodes: false,
  ...over,
});

const TRANSFER_PATH = '/api/runviewer/jobs/transfer-route';

async function setup(
  page: Page,
  answer: (route: Route) => Promise<void> = (route) => json(route, { response: transferResult() }),
): Promise<WillCallRecorder> {
  await seedFilters(page, {});
  const rec = await mockWillCall(page, {
    runs: [BURBANK_TO_LAB, LAB_TO_BURBANK, BULK_RUN],
    jobsByRun: { [-15]: JOBS, [-14]: [], [96247]: [] },
  });
  await page.route(/\/api\/runviewer\/routes\/active(\?.*)?$/, (route) => json(route, { response: ROUTE_CONTEXT }));
  await page.route(/\/api\/runviewer\/jobs\/transfer-route$/, answer);
  return rec;
}

async function openBurbank(page: Page) {
  await page.goto(`/route-viewer?runDate=${RUN_DATE}`);
  await page.getByRole('cell', { name: 'Burbank to Lab', exact: true }).click();
  await expect(page.getByText('E896WILLDEL')).toBeVisible();
}

const runCell = (page: Page, name: string) => page.getByRole('cell', { name, exact: true });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Transfer route' });

async function openTransferForJob(page: Page, jobNumber: string) {
  await page.getByRole('cell', { name: jobNumber, exact: true }).click({ button: 'right' });
  await page.locator('div.fixed.z-50').getByRole('button', { name: 'Transfer Route', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}

async function pickAndConfirm(page: Page, label: string) {
  await dialog(page).locator('select').selectOption({ label });
  await dialog(page).getByRole('button', { name: 'Next', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Transfer', exact: true }).click();
}

test.use({ viewport: { width: 1600, height: 1400 } });

test.describe('Route Viewer Transfer Route (#1004)', () => {
  test('the picker loads the server route list, hides the current route, and submits route + tucJob ids', async ({ page }) => {
    const rec = await setup(page);
    await openBurbank(page);
    await openTransferForJob(page, 'E896WILLDEL');

    const options = dialog(page).locator('select option');
    await expect(options).toHaveText(['-- pick a route --', 'Lab to Burbank', 'Irvine Loop']);
    await expect(dialog(page)).not.toContainText('Loading routes');

    await pickAndConfirm(page, 'Lab to Burbank');

    await expect.poll(() => postsTo(rec, TRANSFER_PATH).length).toBe(1);
    expect(postsTo(rec, TRANSFER_PATH)[0]).toEqual({
      jobIds: [20857],
      newRouteId: 14,
      alsoTransferRecurringBooking: false,
      alsoTransferZipCodes: false,
    });
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByText(/Transferred 1 jobs from run #-15 to Lab to Burbank\./)).toBeVisible();
  });

  test('a proc rejection (400 with message) is shown in the dialog, not reported as success', async ({ page }) => {
    await setup(page, (route) => json(route, { message: 'Destination route 14 is not active.' }, 400));
    await openBurbank(page);
    await openTransferForJob(page, 'E896WILLDEL');
    await pickAndConfirm(page, 'Lab to Burbank');

    await expect(dialog(page)).toContainText('Destination route 14 is not active.');
    await expect(page.getByText(/Transferred \d+ jobs/)).toHaveCount(0);
  });

  test('anchors the proc did not move are reported next to the moved count', async ({ page }) => {
    await setup(page, (route) =>
      json(route, { response: transferResult({ succeeded: 1, failed: 1, errors: ['Job 20866: LinehaulLeg'] }) }));
    await openBurbank(page);
    await page.getByRole('cell', { name: 'E896WILLDEL', exact: true }).click();
    await page.getByRole('cell', { name: 'E897WILLDEL', exact: true }).click({ modifiers: ['Control'] });
    await openTransferForJob(page, 'E896WILLDEL');
    await pickAndConfirm(page, 'Lab to Burbank');

    await expect(page.getByText(/Transferred 1 jobs .* 1 not moved: Job 20866: LinehaulLeg/)).toBeVisible();
  });

  test('dragging a job onto another route run sends the route id and the tucJob id', async ({ page }) => {
    const rec = await setup(page);
    await openBurbank(page);

    await page.getByRole('cell', { name: 'E896WILLDEL', exact: true }).dragTo(runCell(page, 'Lab to Burbank'));

    await expect.poll(() => postsTo(rec, TRANSFER_PATH).length).toBe(1);
    // Not the run id (-14) and not the bulk id (920857).
    expect(postsTo(rec, TRANSFER_PATH)[0]).toMatchObject({ jobIds: [20857], newRouteId: 14 });
  });

  test('dragging a multi-selection carries every selected tucJob id', async ({ page }) => {
    const rec = await setup(page);
    await openBurbank(page);
    await page.getByRole('cell', { name: 'E896WILLDEL', exact: true }).click();
    await page.getByRole('cell', { name: 'E897WILLDEL', exact: true }).click({ modifiers: ['Control'] });

    await page.getByRole('cell', { name: 'E897WILLDEL', exact: true }).dragTo(runCell(page, 'Lab to Burbank'));

    await expect.poll(() => postsTo(rec, TRANSFER_PATH).length).toBe(1);
    const body = postsTo(rec, TRANSFER_PATH)[0];
    expect([...(body.jobIds as number[])].sort()).toEqual([20857, 20866]);
    expect(body.newRouteId).toBe(14);
  });

  test('dropping onto a real bulk run is refused with a message and sends nothing', async ({ page }) => {
    const rec = await setup(page);
    await openBurbank(page);

    await page.getByRole('cell', { name: 'E896WILLDEL', exact: true }).dragTo(runCell(page, 'Run 1'));

    await expect(page.getByText(/Cannot move jobs onto Run 1: it is a bulk run, not a route\./)).toBeVisible();
    await page.waitForTimeout(300);
    expect(postsTo(rec, TRANSFER_PATH)).toEqual([]);
  });
});
