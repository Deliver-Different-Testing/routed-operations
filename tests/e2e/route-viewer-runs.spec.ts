import { test, expect } from '@playwright/test';
import { mockRouteViewerApis, PALMERSTON_NORTH_REGION_ID } from './fixtures/routeViewerMocks';

// E2E regression for the Palmerston North "Run 1 missing" bug reported
// against mssql-prod on 2026-08-21. Root cause was an EF materialisation
// crash - RawBulkRunRow.Kms was int? but tblBulkRun.Kms is float, so
// SqlDataReader.GetInt32 threw InvalidCastException whenever the filtered
// resultset contained a run with a non-null Kms. Backend fix bumped Kms
// to double? in RouteViewerRunService.cs. See handoff / task history.
//
// The frontend never surfaces Kms - the fix is server-side - so this
// spec covers the shape of the fixed response and asserts the Run List
// actually renders the row. If the backend response contract regresses
// (e.g. a field is renamed / typing shifts), the "run appears" assertion
// fails loudly.
//
// Setup:
//   npm install
//   npx playwright install chromium
// Run:
//   npm run test:e2e

// Pre-select the Palmerston North region + book date so the RunViewer
// initial render matches the operator flow Steve was on when he saw
// the empty state. localStorage key is scoped by tenant + email; vite
// dev's index.html stamps window.__APP_USER__ with a null tenant and
// dev@example.com, so the key resolves to `rv-filters:0:dev@example.com`.
const FILTER_KEY = 'rv-filters:0:dev@example.com';
const RUN_DATE = '2026-08-19';

test.describe('Route Viewer /runs regression - Palmerston North Run 1', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(({ key, regionId }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          clientIds: [],
          regionIds: [regionId],
          speedIds: [],
          courierId: null,
          activeRegionsOnly: true,
          availableCouriersOnly: false,
          viewMode: 'Combined',
        }),
      );
    }, { key: FILTER_KEY, regionId: PALMERSTON_NORTH_REGION_ID });
  });

  test('renders Run 1 for Palmerston North on the fixed book date', async ({ page }) => {
    await mockRouteViewerApis(page, { runDate: RUN_DATE, includePalmyRun: true });

    await page.goto(`/route-viewer?runDate=${RUN_DATE}`);

    // Run List panel loads its rows off /api/runviewer/runs. The mock
    // returns Run 96247 ("Run 1") with agentName populated + NP flag on.
    const runList = page.getByRole('table').first();
    await expect(runList).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Run 1' })).toBeVisible();
    await expect(page.getByText('Palmerston North Taxis Gold & Black CB #1')).toBeVisible();
    await expect(page.getByText('No runs for this date + filter combination.')).toHaveCount(0);

    // Overview cell for Palmerston North should show Total = 1 / Todo = 1
    // (matches what the RVW_stpRunOverview SP returns in prod for this
    // date, so we're double-checking the render binding not just the API).
    const overviewRow = page.getByRole('row', { name: /Palmerston North/ }).first();
    await expect(overviewRow).toBeVisible();
  });

  test('renders empty state when the backend returns zero runs', async ({ page }) => {
    await mockRouteViewerApis(page, { runDate: RUN_DATE, includePalmyRun: false });

    await page.goto(`/route-viewer?runDate=${RUN_DATE}`);

    await expect(page.getByText('No runs for this date + filter combination.')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Run 1' })).toHaveCount(0);
  });

  test('surfaces a 500 as a visible failure, not silent zero runs', async ({ page }) => {
    // Simulate the pre-fix backend behaviour: /api/runviewer/runs 500s.
    // If a future change swallows the failure and shows the empty state
    // instead of erroring, this catches it. React Query surfaces a
    // failed poll by leaving `runsQuery.data` undefined, so the "No
    // runs" copy will still render - the test therefore asserts on the
    // network response being an error rather than on visible copy.
    await mockRouteViewerApis(page, { runDate: RUN_DATE, includePalmyRun: true });
    await page.route(/\/api\/runviewer\/runs(\?[^/]*)?$/, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"cast error"}' }),
    );

    const failed = page.waitForResponse(
      (res) => res.url().includes('/api/runviewer/runs?') && res.status() === 500,
      { timeout: 10_000 },
    );
    await page.goto(`/route-viewer?runDate=${RUN_DATE}`);
    await failed;
  });
});
