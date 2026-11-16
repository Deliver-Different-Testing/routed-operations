import { test, expect, type Page } from '@playwright/test';
import { RUN_DATE, job, json, mockWillCall, postsTo, routeRun, seedFilters, type Job } from './fixtures/willCallMocks';

// Package D, Route Viewer split runs and the run menu.
//
// RVW_stpBulkRuns_2 returns one row per run + courier + pre-assign flag, so
// run 204 below shows as three rows: the jobs nobody holds (courier NULL),
// Cee Seven's jobs, and Pea Eight's pre-assigned (status 18) jobs.
//
// Before the fix (HEAD): every row was keyed, selected and fetched by the
// bare run id, so
//   - #311/#326: clicking any half listed every job on the run, and Assign
//     Route on it re-assigned jobs another driver already held;
//   - Pre Assigned list: clicking a row did not ask for status-18 jobs;
//   - #323: with two runs selected Assign Route only took the clicked one;
//   - #816: the run menu did not know the row was pre-assigned (no
//     Re-assign / Unassign driver), asked for codes with window.prompt and
//     sent no "from" courier.

const RUN_ID = 204;
const OTHER_RUN_ID = 205;

const UNASSIGNED = routeRun(RUN_ID, 'Split Run', { courierId: null, jobs: 1 });
const CEE = routeRun(RUN_ID, 'Split Run', { courierId: 7, courierCode: 'C7', courierName: 'Cee Seven', jobs: 1 });
const PEA = routeRun(RUN_ID, 'Split Run', { courierId: 8, courierCode: 'P8', courierName: 'Pea Eight', preAssigned: 1, jobs: 1 });
const OTHER = routeRun(OTHER_RUN_ID, 'Other Run', { courierId: null, jobs: 1 });

const U_JOB = job(5001, 'U5001JOB', RUN_ID, 'Split Run');
const C_JOB = job(5002, 'C5002JOB', RUN_ID, 'Split Run', { courierId: 7, courierCode: 'C7', courierName: 'Cee Seven' });
const P_JOB = job(5003, 'P5003JOB', RUN_ID, 'Split Run', { courierId: 8, courierCode: 'P8', courierName: 'Pea Eight', jobStatus: '18' });
const O_JOB = job(6001, 'O6001JOB', OTHER_RUN_ID, 'Other Run');

/** Answers like RVW_stpBulkRunJobs after 20261117141000: @PreAssigned=1 is
 *  the status-18 jobs, @UnassignedOnly=1 the jobs with no courier,
 *  @CourierID one driver's jobs, nothing = the whole run. */
const splitJobs = (q: URLSearchParams): Job[] => {
  if (q.get('preAssigned') === 'true') return [P_JOB];
  if (q.get('unassignedOnly') === 'true') return [U_JOB];
  if (q.get('courierId') === '7') return [C_JOB];
  if (q.get('courierId') === '8') return [];
  return [U_JOB, C_JOB, P_JOB];
};

async function setup(page: Page) {
  await seedFilters(page, {});
  const rec = await mockWillCall(page, {
    runs: [UNASSIGNED, CEE, PEA, OTHER],
    jobsByRun: { [RUN_ID]: splitJobs, [OTHER_RUN_ID]: [O_JOB] },
  });
  await page.route(/\/api\/runviewer\/couriers\/search(\?.*)?$/, (route) =>
    json(route, { response: [{ courierId: 31, name: 'Dana Driver', code: 'DD1', fleet: null, activeJobs: 0 }] }));
  await page.route(/\/api\/runviewer\/jobs\/assign$/, (route) => {
    const ids = (route.request().postDataJSON() as { jobIds: number[] }).jobIds;
    return json(route, {
      response: { succeeded: ids.length, failed: 0, errors: [], targetType: 'Courier', targetId: 31, displayName: 'Dana Driver' },
    });
  });
  // #816: no window.prompt anywhere in these flows.
  page.on('dialog', (d) => { throw new Error(`unexpected browser ${d.type()}: ${d.message()}`); });
  await page.goto(`/route-viewer?runDate=${RUN_DATE}`);
  return rec;
}

const box = (page: Page, title: string) => page.getByText(title, { exact: true }).locator('xpath=../..');
const mainRows = (page: Page) => box(page, 'Run List').getByRole('row');
const unassignedRow = (page: Page) =>
  mainRows(page).filter({ hasText: 'Split Run' }).filter({ hasNotText: /Cee Seven|Pea Eight/ });
const ceeRow = (page: Page) => mainRows(page).filter({ hasText: 'Cee Seven' });
const peaRow = (page: Page) => mainRows(page).filter({ hasText: 'Pea Eight' });
const otherRow = (page: Page) => mainRows(page).filter({ hasText: 'Other Run' });

async function pickDana(page: Page, dialogName: string, submit: string) {
  const dialog = page.getByRole('dialog', { name: dialogName });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('Search couriers...').fill('dana');
  await dialog.getByRole('button', { name: /Dana Driver/ }).click();
  await dialog.getByRole('button', { name: submit, exact: true }).click();
}

test.describe('Route Viewer split runs (#311 #326 #323 #816)', () => {
  test('the unassigned half of a split run lists only the jobs nobody holds', async ({ page }) => {
    const rec = await setup(page);
    await unassignedRow(page).click();

    await expect(page.getByText('U5001JOB')).toBeVisible();
    await expect(page.getByText('C5002JOB')).toHaveCount(0);
    await expect(page.getByText('P5003JOB')).toHaveCount(0);
    const q = rec.jobFetches.filter((u) => u.pathname.endsWith(`/runs/${RUN_ID}/jobs`)).at(-1)!.searchParams;
    expect(q.get('unassignedOnly')).toBe('true');
  });

  test('a Pre Assigned list row loads that driver\'s status-18 jobs', async ({ page }) => {
    const rec = await setup(page);
    await box(page, 'Pre Assigned List').getByRole('row').filter({ hasText: 'Pea Eight' }).click();

    await expect(page.getByText('P5003JOB')).toBeVisible();
    await expect(page.getByText('U5001JOB')).toHaveCount(0);
    await expect(page.getByText('C5002JOB')).toHaveCount(0);
    const q = rec.jobFetches.filter((u) => u.pathname.endsWith(`/runs/${RUN_ID}/jobs`)).at(-1)!.searchParams;
    expect(q.get('preAssigned')).toBe('true');
    expect(q.get('courierId')).toBe('8');
  });

  test('Assign Route on one driver\'s half assigns only that driver\'s jobs', async ({ page }) => {
    const rec = await setup(page);
    await ceeRow(page).click();
    await expect(page.getByText('C5002JOB')).toBeVisible();

    await ceeRow(page).click({ button: 'right' });
    await page.getByRole('button', { name: 'Assign Route', exact: true }).click();
    await pickDana(page, 'Assign route', 'Assign');

    await expect.poll(() => postsTo(rec, '/api/runviewer/jobs/assign').length).toBe(1);
    // The regression: all of 5001, 5002, 5003.
    expect(postsTo(rec, '/api/runviewer/jobs/assign')[0].jobIds).toEqual([5002]);
  });

  test('with two runs selected Assign Route assigns every selected row in one dialog (#323)', async ({ page }) => {
    const rec = await setup(page);
    await ceeRow(page).click();
    await otherRow(page).click({ modifiers: ['Control'] });

    await otherRow(page).click({ button: 'right' });
    await page.getByRole('button', { name: 'Assign 2 runs', exact: true }).click();
    await pickDana(page, 'Assign route', 'Assign');

    await expect.poll(() => postsTo(rec, '/api/runviewer/jobs/assign').length).toBe(1);
    const ids = [...(postsTo(rec, '/api/runviewer/jobs/assign')[0].jobIds as number[])].sort();
    expect(ids).toEqual([5002, 6001]);
  });

  test('a pre-assigned row re-assigns through the courier picker with from = the row\'s driver (#816)', async ({ page }) => {
    const rec = await setup(page);
    await page.route(/\/api\/runviewer\/jobs\/preassign-run$/, (route) => json(route, { response: 'ok' }));

    await peaRow(page).click({ button: 'right' });
    await page.getByRole('button', { name: 'Re-assign to another driver', exact: true }).click();
    await pickDana(page, 'Re-assign to another driver', 'Re-assign');

    await expect.poll(() => postsTo(rec, '/api/runviewer/jobs/preassign-run').length).toBe(1);
    expect(postsTo(rec, '/api/runviewer/jobs/preassign-run')[0])
      .toEqual({ runId: RUN_ID, toCourierCode: 'DD1', fromCourierCode: 'P8' });
  });

  test('Unassign driver on a pre-assigned row unassigns that driver without asking for a code (#816)', async ({ page }) => {
    const rec = await setup(page);
    await page.route(/\/api\/runviewer\/jobs\/unassign-run$/, (route) => json(route, { response: 'ok' }));

    await peaRow(page).click({ button: 'right' });
    await page.getByRole('button', { name: 'Unassign driver', exact: true }).click();
    await page.getByRole('button', { name: 'OK', exact: true }).click();

    await expect.poll(() => postsTo(rec, '/api/runviewer/jobs/unassign-run').length).toBe(1);
    expect(postsTo(rec, '/api/runviewer/jobs/unassign-run')[0]).toEqual({ runId: RUN_ID, courierCode: 'P8' });
  });

  test('an unknown courier code shows the server\'s message in the picker (#816)', async ({ page }) => {
    await setup(page);
    const msg = "Courier code 'DD1' was not found or is not active. No jobs were pre-assigned.";
    await page.route(/\/api\/runviewer\/jobs\/preassign-run$/, (route) => json(route, { message: msg }, 400));

    await peaRow(page).click({ button: 'right' });
    await page.getByRole('button', { name: 'Re-assign to another driver', exact: true }).click();
    await pickDana(page, 'Re-assign to another driver', 'Re-assign');

    await expect(page.getByRole('dialog', { name: 'Re-assign to another driver' }).getByText(msg)).toBeVisible();
  });
});
