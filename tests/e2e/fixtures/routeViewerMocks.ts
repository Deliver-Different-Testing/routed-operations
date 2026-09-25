import type { Page, Route } from '@playwright/test';

// Mock fixtures for the Route Viewer E2E tests. Shapes match what the
// backend BulkRunDto / RegionOverviewDto / Lookup DTOs serialise
// (System.Text.Json default camelCase). `area` is INTENTIONALLY lowercase
// because BulkRunDto.area is declared lowercase - see the "CRITICAL
// contract notes" header in Core/Application/Dtos/RouteViewer/BulkRunDto.cs.
//
// Every backend endpoint wraps its payload in `{ response: <data> }` via
// the unwrap<T>() helper in wwwroot/app/react/services/routeViewerService.ts,
// so mock responses do the same.
//
// The Palmerston North "Run 1" fixture reproduces the exact prod row that
// used to 500 the /api/runviewer/runs endpoint before the Kms int-cast
// fix (RouteViewerRunService.RawBulkRunRow.Kms int? -> double?). Keeping
// the fractional distance value in the fixture keeps the shape of the
// regression pinned even though the frontend BulkRun DTO does not surface
// Kms directly.

export const PALMERSTON_NORTH_REGION_ID = 6;

export interface RunViewerMockOptions {
  /** Book date the frontend requests. Default 2026-08-19 to match the
   *  original bug repro. */
  runDate?: string;
  /** Set false to simulate an empty run list (regression case for the
   *  legacy 0-runs 500 - after the fix, this should render "No runs" not
   *  the run row). Default true. */
  includePalmyRun?: boolean;
}

const wrap = (data: unknown) => ({ response: data });

export async function mockRouteViewerApis(page: Page, opts: RunViewerMockOptions = {}) {
  const runDate = opts.runDate ?? '2026-08-19';
  const includeRun = opts.includePalmyRun ?? true;

  const runsPayload = includeRun
    ? [
        {
          id: 96247,
          name: 'Run 1',
          area: 'Palmerston North',
          suburbs: 'Hokowhitu',
          fromCities: 'Roslyn',
          toLocationName: null,
          velocity: 'green',
          hashKey: 'stub-hash',
          status: 'LIVE',
          jobs: 1,
          incompleteJobs: 1,
          totalPickup: 0,
          incompletePickup: 0,
          hasReturns: false,
          returnsTotal: 0,
          isMissing: false,
          preAssigned: 0,
          isActive: 1,
          courierName: null,
          courierCode: null,
          courierPercentageFormatted: null,
          courierOnlineStatus: '',
          courierOfflineMins: '',
          agentName: 'Palmerston North Taxis Gold & Black CB #1',
          isNpAgent: true,
        },
      ]
    : [];

  const overviewPayload = [
    {
      regionId: PALMERSTON_NORTH_REGION_ID,
      region: 'Palmerston North',
      total: includeRun ? 1 : 0,
      sortScan: 0,
      runScan: 0,
      pickedUp: 0,
      toDo: includeRun ? 1 : 0,
      percent: 0,
      class: includeRun ? 'red' : 'green',
      active: true,
      pallet: null,
    },
  ];

  // Playwright invokes handlers in REVERSE registration order (last
  // registered wins on overlap), so we register the broadest catch-all
  // FIRST and the specific matchers LAST - that way the specifics take
  // precedence and the catch-all only fires for endpoints we did not
  // explicitly mock. Keeps the test from silently hanging on a fetch
  // to some new /api/runviewer/* endpoint added after this spec was
  // written.
  await page.route(/\/api\/runviewer\//, (route: Route) => {
    const type = route.request().resourceType();
    if (type === 'xhr' || type === 'fetch') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wrap([])) });
    }
    return route.continue();
  });

  await page.route(/\/api\/runviewer\/runs\/overview(\?.*)?$/, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wrap(overviewPayload)) }),
  );

  await page.route(/\/api\/runviewer\/runs\/linehaul\/overview(\?.*)?$/, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wrap([])) }),
  );

  await page.route(/\/api\/runviewer\/runs\/linehaul(\?.*)?$/, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wrap([])) }),
  );

  // Primary Run List endpoint - `(\?.*)?$` guards against accidentally
  // matching /api/runviewer/runs/overview or /api/runviewer/runs/linehaul,
  // which sit under the same prefix but must be answered by the more
  // specific handlers above.
  await page.route(/\/api\/runviewer\/runs(\?.*)?$/, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wrap(runsPayload)) }),
  );

  await page.route(/\/api\/runviewer\/filters\/clients(\?.*)?$/, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wrap([])) }),
  );

  await page.route(/\/api\/runviewer\/filters\/regions(\?.*)?$/, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(wrap([{ id: PALMERSTON_NORTH_REGION_ID, label: 'Palmerston North' }])),
    }),
  );

  await page.route(/\/api\/runviewer\/filters\/speeds(\?.*)?$/, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wrap([])) }),
  );

  await page.route(/\/api\/runviewer\/filters\/suburbs(\?.*)?$/, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wrap([])) }),
  );

  await page.route(/\/api\/runviewer\/filters\/topup-services(\?.*)?$/, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wrap([])) }),
  );

  await page.route(/\/api\/runviewer\/couriers(\?.*)?$/, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wrap([])) }),
  );

  return { runDate };
}
