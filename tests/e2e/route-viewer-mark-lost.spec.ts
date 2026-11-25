import { test, expect, type Page } from '@playwright/test';
import { RUN_DATE, job, json, mockWillCall, postsTo, routeRun, seedFilters, type WillCallRecorder } from './fixtures/willCallMocks';

// #320 (Steve ruling, Kevin 23 Nov): a Missing job that is lost closes as
// Undeliverable. The Route Viewer job menu offers 'Mark lost (Undeliverable)'
// only on a Missing job (status code MIS), asks first, POSTs the tucJob id to
// /api/runviewer/jobs/mark-lost and refreshes the run's jobs like Complete
// does. If the proc reports nothing changed (someone completed the job in the
// meantime) the operator is told, not shown a success toast.

const RUN = routeRun(-15, 'Burbank to Lab', { jobs: 2 });
const LOST_JOB = 20857;
const MARK_LOST = 'Mark lost (Undeliverable)';

interface Mocks { rec: WillCallRecorder; status: { code: string } }

async function setup(page: Page, updated = true): Promise<Mocks> {
  const status = { code: 'MIS' };
  await seedFilters(page, {});
  const rec = await mockWillCall(page, {
    runs: [RUN],
    jobsByRun: {
      [-15]: () => [
        job(LOST_JOB, 'E896WILLDEL', -15, 'Burbank to Lab', { bulkJobId: 0, jobStatus: status.code }),
        job(20866, 'E897WILLDEL', -15, 'Burbank to Lab', { bulkJobId: 0, jobStatus: 'A' }),
      ],
    },
  });
  await page.route(/\/api\/runviewer\/jobs\/mark-lost$/, (route) => {
    if (updated) status.code = 'UD';
    return json(route, { response: { updated } });
  });
  return { rec, status };
}

async function openMenuOn(page: Page, jobNumber: string) {
  await page.goto(`/route-viewer?runDate=${RUN_DATE}`);
  await page.getByRole('cell', { name: 'Burbank to Lab', exact: true }).click();
  await page.getByRole('cell', { name: jobNumber, exact: true }).click();
  await page.getByRole('cell', { name: jobNumber, exact: true }).click({ button: 'right' });
  await expect(page.getByRole('button', { name: 'Create Job Event', exact: true })).toBeVisible();
}

test.use({ viewport: { width: 1600, height: 1400 } });

test('Missing job: confirm, POST the tucJob id, then the run jobs refresh', async ({ page }) => {
  const { rec } = await setup(page);
  await openMenuOn(page, 'E896WILLDEL');
  const fetchesBefore = rec.jobFetches.length;

  await page.getByRole('button', { name: MARK_LOST, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: MARK_LOST });
  await expect(dialog).toContainText('Undeliverable');
  // Nothing is sent before the operator confirms.
  expect(postsTo(rec, '/api/runviewer/jobs/mark-lost')).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Mark lost', exact: true }).click();

  await expect.poll(() => postsTo(rec, '/api/runviewer/jobs/mark-lost')).toEqual([{ jobId: LOST_JOB }]);
  await expect.poll(() => rec.jobFetches.length).toBeGreaterThan(fetchesBefore);
  await expect(page.getByText(/Mark lost: 1 job/)).toBeVisible();
});

// Found in the local browser test 23 Nov: after Mark lost / Complete the
// Overview box kept TODO 1 until the 25 s poll, because the job menu's
// onDone refetched the runs and the run's jobs but not 'rv-overview'.
test('after Mark lost the Overview box refetches at once, not on the next poll', async ({ page }) => {
  const overviewFetches: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'GET' && new URL(req.url()).pathname === '/api/runviewer/runs/overview') {
      overviewFetches.push(req.url());
    }
  });
  await setup(page);
  await openMenuOn(page, 'E896WILLDEL');
  await expect.poll(() => overviewFetches.length).toBeGreaterThan(0);
  const before = overviewFetches.length;

  await page.getByRole('button', { name: MARK_LOST, exact: true }).click();
  await page.getByRole('dialog', { name: MARK_LOST }).getByRole('button', { name: 'Mark lost', exact: true }).click();
  await expect(page.getByText(/Mark lost: 1 job/)).toBeVisible();

  // Well inside the 25 s auto-poll, so only the onDone refresh can satisfy it.
  await expect.poll(() => overviewFetches.length, { timeout: 5_000 }).toBeGreaterThan(before);
});

test('cancel sends nothing', async ({ page }) => {
  const { rec } = await setup(page);
  await openMenuOn(page, 'E896WILLDEL');
  await page.getByRole('button', { name: MARK_LOST, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: MARK_LOST });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(postsTo(rec, '/api/runviewer/jobs/mark-lost')).toHaveLength(0);
});

test('a job that is not Missing has no Mark lost item', async ({ page }) => {
  await setup(page);
  await openMenuOn(page, 'E897WILLDEL');
  await expect(page.getByRole('button', { name: MARK_LOST, exact: true })).toHaveCount(0);
});

test('proc reports nothing changed: the operator is told it failed, no success toast', async ({ page }) => {
  const { rec } = await setup(page, false);
  await openMenuOn(page, 'E896WILLDEL');
  await page.getByRole('button', { name: MARK_LOST, exact: true }).click();
  await page.getByRole('dialog', { name: MARK_LOST }).getByRole('button', { name: 'Mark lost', exact: true }).click();

  await expect.poll(() => postsTo(rec, '/api/runviewer/jobs/mark-lost')).toHaveLength(1);
  await expect(page.getByRole('dialog', { name: 'Mark lost - partial' })).toContainText('0 succeeded, 1 failed');
  await expect(page.getByText(/Mark lost: 1 job/)).toHaveCount(0);
});
