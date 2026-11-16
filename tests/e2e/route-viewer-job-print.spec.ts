import { test, expect, type Page } from '@playwright/test';
import { RUN_DATE, job, json, mockWillCall, routeRun, seedFilters } from './fixtures/willCallMocks';

// #309: Job Detail's Print printed whichever job the grid had selected, not
// the job Job Detail was showing.
//
// Before the fix (RunViewer.tsx at HEAD, doPrintJobReport): the job handed
// over by RvJobDetail was ignored and selectedJobId printed instead, so
//   - an LH leg tab (bulkJobId 0, shown through the sibling override)
//     printed the PARENT's label;
//   - an LHP tab printed the parent too, never /labels/lhp-jobs;
//   - a row with no tucJob yet (jobId 0) only toasted, it never printed its
//     bulk label.
//
// Rule now (lib/labelPrint jobLabelTarget): LHP -> /labels/lhp-jobs/{jobId};
// LH leg -> its own /labels/jobs/{jobId} (LH_LEG_LABEL_KIND, open for
// Steve); other live job -> /labels/jobs/{jobId}; jobId 0 ->
// /labels/bulk?bulkJobId=.

const RUN_ID = 310;
const RUN = routeRun(RUN_ID, 'Print Run', { jobs: 2 });
const PARENT = job(7000, 'P7000', RUN_ID, 'Print Run');
const LHP = job(7001, 'P7000LHP', RUN_ID, 'Print Run', { bulkJobId: 0 });
const LH1 = job(7002, 'P7000LH1', RUN_ID, 'Print Run', { bulkJobId: 0 });
// Route Builder row not yet materialised into tucJob.
const UNBOOKED = job(0, 'RB0088', RUN_ID, 'Print Run', { bulkJobId: 88 });

const SIBLINGS = [
  { jobId: 7000, bulkJobId: PARENT.bulkJobId, jobNumber: 'P7000', jobStatus: 'D', tabLabel: 'P7000', job: PARENT },
  { jobId: 7001, bulkJobId: 0, jobNumber: 'P7000LHP', jobStatus: 'D', tabLabel: '*LHP', job: LHP },
  { jobId: 7002, bulkJobId: 0, jobNumber: 'P7000LH1', jobStatus: 'D', tabLabel: '*LH1', job: LH1 },
];

async function setup(page: Page) {
  await seedFilters(page, {});
  await mockWillCall(page, { runs: [RUN], jobsByRun: { [RUN_ID]: [PARENT, UNBOOKED] } });
  await page.route(/\/api\/runviewer\/runs\/job-siblings(\?.*)?$/, (route) => {
    const jobId = new URL(route.request().url()).searchParams.get('jobId');
    return json(route, { response: jobId === '7000' ? SIBLINGS : [] });
  });
  const labelGets: URL[] = [];
  await page.route(/\/api\/runviewer\/labels\//, (route) => {
    labelGets.push(new URL(route.request().url()));
    return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF\n' });
  });
  await page.goto(`/route-viewer?runDate=${RUN_DATE}`);
  await page.getByRole('cell', { name: 'Print Run', exact: true }).click();
  return labelGets;
}

const printButton = (page: Page) => page.getByRole('button', { name: 'Print', exact: true });
const labelPaths = (gets: URL[]) => gets.map((u) => u.pathname + u.search);

test.describe('Route Viewer Job Detail print (#309)', () => {
  test('an LH leg tab prints the leg\'s own label, not the parent\'s', async ({ page }) => {
    const gets = await setup(page);
    await page.getByRole('cell', { name: 'P7000', exact: true }).click();
    await page.getByRole('button', { name: '*LH1', exact: true }).click();
    await printButton(page).click();

    await expect.poll(() => gets.length).toBe(1);
    // The regression: /api/runviewer/labels/jobs/7000.
    expect(labelPaths(gets)).toEqual(['/api/runviewer/labels/jobs/7002']);
  });

  test('an LHP tab prints through the LHP label endpoint', async ({ page }) => {
    const gets = await setup(page);
    await page.getByRole('cell', { name: 'P7000', exact: true }).click();
    await page.getByRole('button', { name: '*LHP', exact: true }).click();
    await printButton(page).click();

    await expect.poll(() => gets.length).toBe(1);
    expect(labelPaths(gets)).toEqual(['/api/runviewer/labels/lhp-jobs/7001']);
  });

  test('a row with no tucJob yet prints its bulk label instead of a toast', async ({ page }) => {
    const gets = await setup(page);
    await page.getByRole('cell', { name: 'RB0088', exact: true }).click();
    await printButton(page).click();

    await expect.poll(() => gets.length).toBe(1);
    expect(labelPaths(gets)).toEqual(['/api/runviewer/labels/bulk?bulkJobId=88']);
  });

  test('control: the parent job still prints its own label', async ({ page }) => {
    const gets = await setup(page);
    await page.getByRole('cell', { name: 'P7000', exact: true }).click();
    await printButton(page).click();

    await expect.poll(() => gets.length).toBe(1);
    expect(labelPaths(gets)).toEqual(['/api/runviewer/labels/jobs/7000']);
  });
});
