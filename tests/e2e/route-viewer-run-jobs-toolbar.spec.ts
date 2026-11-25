import { test, expect } from '@playwright/test';
import { RUN_DATE, job, mockWillCall, routeRun, seedFilters } from './fixtures/willCallMocks';

// #309 leftovers (D4): the Run Jobs toolbar carried a "More" (three dots)
// button with no handler, so clicking it did nothing. Every run action it
// could have offered already lives on the run row's right-click menu, so it
// is removed rather than wired. The toolbar keeps its working buttons.

const RUN_ID = 311;
const RUN = routeRun(RUN_ID, 'Toolbar Run', { jobs: 1 });
const JOB = job(7100, 'T7100', RUN_ID, 'Toolbar Run');

test('the Run Jobs toolbar offers no dead More button, and Refresh still works', async ({ page }) => {
  await seedFilters(page, {});
  await mockWillCall(page, { runs: [RUN], jobsByRun: { [RUN_ID]: [JOB] } });
  let runJobLoads = 0;
  page.on('request', (r) => { if (r.url().includes(String(RUN_ID)) && r.method() === 'GET') runJobLoads += 1; });

  await page.goto(`/route-viewer?runDate=${RUN_DATE}`);
  await page.getByRole('cell', { name: 'Toolbar Run', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'T7100', exact: true })).toBeVisible();

  // The Run Jobs toolbar's own Refresh (the Runs panel has one too).
  const refresh = page.getByTitle('Print labels for run').locator('xpath=following-sibling::button[@title="Refresh"]');
  await expect(refresh).toBeVisible();
  await expect(page.getByRole('button', { name: 'More', exact: true })).toHaveCount(0);

  const before = runJobLoads;
  await refresh.click();
  await expect.poll(() => runJobLoads).toBeGreaterThan(before);
});
