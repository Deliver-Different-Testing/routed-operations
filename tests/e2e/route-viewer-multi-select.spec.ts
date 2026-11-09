import { test, expect, type Page, type Route } from '@playwright/test';
import { RUN_DATE, job, json, mockWillCall, postsTo, routeRun, seedFilters, type WillCallRecorder } from './fixtures/willCallMocks';
import { applyUserOverride } from './fixtures/npSession';

// #1003 (Kenneth, Medical prod): with 2+ jobs selected the job right-click
// menu greyed out Transfer Route, Transfer Courier and Create Job Event, so
// a Will Call batch had to be handled one job at a time.
//
// Before the fix (RvJobContextMenu.tsx at HEAD): `isBulk = jobs.length > 1`
// disabled all of them, with no hint why.
//
// Rule now (Steve D2):
//   - Transfer Route, Transfer Courier, Create Job Event act on the whole
//     selection;
//   - Book Direct Redelivery, Return to Base, Top Up, Create Client Intel
//     (and Assign Courier for a partner) stay single-job, disabled with the
//     tooltip "Select one job";
//   - Create Job Event posts one event per job (tucJob id on each, since
//     synthetic route rows have bulkJobId 0) and Save retries only the jobs
//     that failed, never re-posting a success.

const RUN = routeRun(-15, 'Burbank to Lab', { jobs: 3 });
// bulkJobId 0: synthetic route rows on Medical carry no tblBulkJob id on
// screen, which is why the event POST must carry the tucJob id.
const JOBS = [
  job(20857, 'E896WILLDEL', -15, 'Burbank to Lab', { bulkJobId: 0, proofOfDeliveryMobile: '+15550001' }),
  job(20866, 'E897WILLDEL', -15, 'Burbank to Lab', { bulkJobId: 0, proofOfDeliveryMobile: '+15550002' }),
  job(20871, 'E898WILLDEL', -15, 'Burbank to Lab', { bulkJobId: 0, proofOfDeliveryMobile: '+15550003' }),
];

const MULTI_ITEMS = ['Transfer Route', 'Transfer Courier', 'Create Job Event'];
const SINGLE_ONLY_ITEMS = ['Book Direct Redelivery', 'Return to Base', 'Top Up', 'Create Client Intel'];

async function setup(page: Page): Promise<WillCallRecorder> {
  await seedFilters(page, {});
  return mockWillCall(page, { runs: [RUN], jobsByRun: { [-15]: JOBS } });
}

async function openRun(page: Page) {
  await page.goto(`/route-viewer?runDate=${RUN_DATE}`);
  await page.getByRole('cell', { name: 'Burbank to Lab', exact: true }).click();
  await expect(page.getByText('E898WILLDEL')).toBeVisible();
}

async function selectJobs(page: Page, jobNumbers: string[]) {
  const [first, ...rest] = jobNumbers;
  await page.getByRole('cell', { name: first, exact: true }).click();
  for (const n of rest) {
    await page.getByRole('cell', { name: n, exact: true }).click({ modifiers: ['Control'] });
  }
  await page.getByRole('cell', { name: first, exact: true }).click({ button: 'right' });
}

// The job menu is a fixed div at the click point and is not clamped to the
// viewport, so a default 720px window puts its lower items off screen.
test.use({ viewport: { width: 1600, height: 1400 } });

// Scoped to the job menu: the Job Detail panel has its own Transfer Route
// button (RvJobDetail.tsx:216).
const jobMenu = (page: Page) =>
  page.locator('div.fixed.z-50').filter({ has: page.getByRole('button', { name: 'Create Job Event', exact: true }) });
const menuItem = (page: Page, name: string) => jobMenu(page).getByRole('button', { name, exact: true });

test.describe('Route Viewer job menu multi-select (#1003)', () => {
  test('with 3 jobs selected the batch items are enabled and the single-job items say why not', async ({ page }) => {
    await setup(page);
    await openRun(page);
    await selectJobs(page, ['E896WILLDEL', 'E897WILLDEL', 'E898WILLDEL']);
    await expect(jobMenu(page)).toContainText('3 jobs selected');

    for (const name of MULTI_ITEMS) {
      await expect(menuItem(page, name), name).toBeEnabled();
    }
    for (const name of SINGLE_ONLY_ITEMS) {
      await expect(menuItem(page, name), name).toBeDisabled();
      await expect(menuItem(page, name), name).toHaveAttribute('title', 'Select one job');
    }
  });

  test('control: with one job selected every item is enabled and none carries the tooltip', async ({ page }) => {
    await setup(page);
    await openRun(page);
    await selectJobs(page, ['E896WILLDEL']);

    for (const name of [...MULTI_ITEMS, ...SINGLE_ONLY_ITEMS]) {
      await expect(menuItem(page, name), name).toBeEnabled();
      await expect(menuItem(page, name), name).not.toHaveAttribute('title', 'Select one job');
    }
  });

  test('partner session: Assign Courier stays single-job with the tooltip, Create Job Event is enabled', async ({ page }) => {
    await applyUserOverride(page, { isNetworkPartner: true, npAgentId: 42 });
    await setup(page);
    await openRun(page);
    await selectJobs(page, ['E896WILLDEL', 'E897WILLDEL']);

    await expect(menuItem(page, 'Assign Courier')).toBeDisabled();
    await expect(menuItem(page, 'Assign Courier')).toHaveAttribute('title', 'Select one job');
    await expect(menuItem(page, 'Create Job Event')).toBeEnabled();
  });

  test('Transfer Courier with 3 jobs assigns all three tucJob ids', async ({ page }) => {
    const rec = await setup(page);
    await page.route(/\/api\/runviewer\/couriers\/search(\?.*)?$/, (route) =>
      json(route, { response: [{ courierId: 31, name: 'Dana Driver', code: 'DD1', fleet: null, activeJobs: 0 }] }));
    await page.route(/\/api\/runviewer\/jobs\/assign$/, (route) =>
      json(route, { response: { succeeded: 3, failed: 0, errors: [], targetType: 'Courier', targetId: 31, displayName: 'Dana Driver' } }));
    await openRun(page);
    await selectJobs(page, ['E896WILLDEL', 'E897WILLDEL', 'E898WILLDEL']);

    await menuItem(page, 'Transfer Courier').click();
    await page.getByPlaceholder('Search couriers...').fill('dana');
    await page.getByRole('button', { name: /Dana Driver/ }).click();
    await page.getByRole('button', { name: 'Assign', exact: true }).click();

    await expect.poll(() => postsTo(rec, '/api/runviewer/jobs/assign').length).toBe(1);
    expect(postsTo(rec, '/api/runviewer/jobs/assign')[0]).toMatchObject({
      jobIds: [20857, 20866, 20871], targetType: 'Courier', targetId: 31,
    });
  });

  test('Create Job Event: one POST per job, a failure is reported, Save retries only the failed job', async ({ page }) => {
    const rec = await setup(page);
    // The server's own rejection for a job with no tblBulkJob row
    // (RunViewerEventController.cs:64-69). Fails 20866 on the first try only.
    let attemptsFor20866 = 0;
    let nextEventId = 7000;
    await page.route(/\/api\/runviewer\/events$/, (route: Route) => {
      const body = route.request().postDataJSON() as { jobId: number | null };
      if (body.jobId === 20866 && attemptsFor20866++ === 0) {
        return json(route, { message: 'Job 20866 has no bulk job record.' }, 400);
      }
      return json(route, { response: { bulkEventId: nextEventId++ } });
    });

    await openRun(page);
    await selectJobs(page, ['E896WILLDEL', 'E897WILLDEL', 'E898WILLDEL']);
    await menuItem(page, 'Create Job Event').click();

    const dialog = page.getByRole('dialog', { name: 'Create event' });
    await expect(dialog).toContainText('3 jobs selected');
    await dialog.locator('textarea').fill('Driver called ahead');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(dialog).toContainText('2 of 3 created');
    await expect(dialog).toContainText('E897WILLDEL');
    await expect(dialog).toContainText('Job 20866 has no bulk job record.');

    const first = postsTo(rec, '/api/runviewer/events');
    expect(first.map((b) => b.jobId)).toEqual([20857, 20866, 20871]);
    for (const b of first) {
      // Route rows have no bulk id on screen; the server resolves it.
      expect(b.bulkJobId).toBeNull();
      expect(b.notes).toBe('Driver called ahead');
      expect(typeof b.internal).toBe('boolean');
    }

    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    const retry = postsTo(rec, '/api/runviewer/events').slice(first.length);
    // The rule that matters: the two successes are not posted twice.
    expect(retry.map((b) => b.jobId)).toEqual([20866]);
  });
});
