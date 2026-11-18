import { test, expect, type Page, type Route } from '@playwright/test';

// E2E for the final-mile route setup card (spec 2026-11-18, section 6).
//
// M1, master job optional (tests 1, 3, 4):
//   1. A new final-mile route opens with tote scanning OFF and saves with no
//      master and no warning.
//   3. Tote scanning ON with no master is refused with the exact message and
//      nothing is sent.
//   4. Turning tote scanning off on a route that has a master asks first,
//      names the booking, and then saves the clear (masterBookingId 0).
//
// Every /api/* call is intercepted, so no backend or DB is needed. The
// backend half of test 4 (the booking stops being IsLinehaulMaster) is the
// existing ApplyMasterBookingAsync demote, covered by its xUnit tests.

const BASE_ROUTE = {
  defaultTargetType: null, defaultTargetId: null, defaultTargetName: '',
  scheduleId: null, scheduleName: '', scheduleWindow: '', schedules: [],
  active: true, zipcodes: [], bulkPolygons: [],
  rosterEntryCount: 0, bookingCount: 0, mappedStopsCount: 0,
  createdAt: '2026-11-01T00:00:00Z', updatedAt: null,
  origin: null,
};

const ROUTES = [
  {
    ...BASE_ROUTE,
    routeId: 1, name: 'Auckland CBD Collect', area: 'Auckland central',
    direction: 1, depotId: null, depotName: '',
  },
  {
    ...BASE_ROUTE,
    routeId: 15, name: 'Burbank to Lab', area: 'Final Mile to Neo Lab',
    direction: 2, depotId: 38, depotName: 'Burbank',
    masterBookingId: 5372, masterBookingLabel: 'P5372BIO - Burbank to Lab',
    finalMileDeliveryMode: 1,
  },
];

const REGIONS = [
  { id: 38, name: 'Burbank', fromCompany: null, fromAddress: null, fromCity: null, fromState: null, fromZipCode: null },
];

let lastSave: { method: string; body: any } | null = null;

async function mockApi(page: Page) {
  lastSave = null;
  // Least specific first: Playwright uses the LAST matching handler.
  await page.route('**/api/**', (route: Route) => route.fulfill({ json: { response: [] } }));
  await page.route('**/api/recurring-routes/*', (route: Route) => {
    const req = route.request();
    if (req.method() === 'PUT') {
      lastSave = { method: 'PUT', body: JSON.parse(req.postData() ?? '{}') };
      return route.fulfill({ json: { response: { ...ROUTES[1], ...lastSave.body } } });
    }
    return route.fulfill({ json: { response: [] } });
  });
  await page.route('**/api/recurring-routes/assignable-targets', (route: Route) =>
    route.fulfill({ json: { response: { couriers: [], agents: [], nps: [] } } }));
  await page.route('**/api/recurring-routes/schedules/lookup', (route: Route) =>
    route.fulfill({ json: { response: [] } }));
  await page.route('**/api/address/regions', (route: Route) =>
    route.fulfill({ json: { regions: REGIONS } }));
  await page.route('**/api/recurring-routes', (route: Route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      lastSave = { method: 'POST', body: JSON.parse(req.postData() ?? '{}') };
      return route.fulfill({ json: { response: { ...ROUTES[0], ...lastSave.body, routeId: 99 } } });
    }
    return route.fulfill({ json: { response: ROUTES } });
  });
}

async function openRoutes(page: Page) {
  await page.goto('/recurring-routes');
  const routesTab = page.getByRole('button', { name: /^Routes$/ });
  if (await routesTab.count()) await routesTab.first().click();
  await expect(page.getByText('Auckland CBD Collect')).toBeVisible({ timeout: 15_000 });
}

const toteSwitch = (page: Page) => page.getByRole('switch', { name: 'Use tote scanning on this route' });

test.describe('Final-mile route setup - master job optional', () => {
  test('the routes list shows the master only where there is one', async ({ page }) => {
    await mockApi(page);
    await openRoutes(page);
    await expect(page.getByText('Master: P5372BIO - Burbank to Lab')).toBeVisible();
    await expect(page.getByText(/^Master:/)).toHaveCount(1);
  });

  test('new final-mile route: tote scanning off by default, saves with no master and no warning (test 1)', async ({ page }) => {
    await mockApi(page);
    await openRoutes(page);

    await page.getByRole('button', { name: /Add Route/ }).click();
    await page.getByPlaceholder('e.g. RNO200').fill('FM no master');
    await page.getByRole('button', { name: 'Final mile' }).click();
    await page.locator('select').filter({ hasText: 'Pick a depot' }).selectOption('38');

    await expect(toteSwitch(page)).not.toBeChecked();
    await expect(page.getByText('Drivers get each delivery as its own job.')).toBeVisible();
    // Picker and mode buttons are hidden while the switch is off.
    await expect(page.getByTestId('final-mile-master-search')).toHaveCount(0);
    await expect(page.getByTestId('delivery-mode-1')).toHaveCount(0);

    await page.getByRole('button', { name: /^Create$/ }).click();

    await expect.poll(() => lastSave?.method).toBe('POST');
    expect(lastSave!.body.direction).toBe(2);
    expect(lastSave!.body.masterBookingId).toBe(0);
    expect(lastSave!.body.finalMileDeliveryMode).toBeNull();
    await expect(page.getByText('Pick a master job, or turn tote scanning off.')).toHaveCount(0);
  });

  test('tote scanning on with no master is refused with the exact message (test 3)', async ({ page }) => {
    await mockApi(page);
    await openRoutes(page);

    await page.getByRole('button', { name: /Add Route/ }).click();
    await page.getByPlaceholder('e.g. RNO200').fill('FM wants totes');
    await page.getByRole('button', { name: 'Final mile' }).click();
    await page.locator('select').filter({ hasText: 'Pick a depot' }).selectOption('38');

    await toteSwitch(page).check();
    await expect(page.getByTestId('final-mile-master-search')).toBeVisible();
    await expect(page.getByText(/nothing for the\s+handset to open/)).toHaveCount(0);

    await page.getByRole('button', { name: /^Create$/ }).click();
    await expect(page.getByText('Pick a master job, or turn tote scanning off.')).toBeVisible();
    expect(lastSave).toBeNull();
  });

  test('turning tote scanning off on a route with a master confirms, then clears it (test 4)', async ({ page }) => {
    await mockApi(page);
    await openRoutes(page);

    await page.locator('tr', { hasText: 'Final Mile to Neo Lab' }).click();
    await expect(toteSwitch(page)).toBeChecked();
    await expect(page.getByText('P5372BIO - Burbank to Lab').last()).toBeVisible();

    await toteSwitch(page).uncheck();
    await page.getByRole('button', { name: /^Save$/ }).click();

    await expect(page.getByText(
      'Turning this off unbinds booking P5372BIO - Burbank to Lab from this route.')).toBeVisible();
    // Cancel first: nothing is sent.
    await page.getByRole('button', { name: /^Cancel$/ }).last().click();
    expect(lastSave).toBeNull();

    await page.getByRole('button', { name: /^Save$/ }).click();
    await page.getByRole('button', { name: 'Turn off and save' }).click();

    await expect.poll(() => lastSave?.method).toBe('PUT');
    expect(lastSave!.body.masterBookingId).toBe(0);
    expect(lastSave!.body.finalMileDeliveryMode).toBeNull();
  });

  test('picker help does not claim clearing the master unbinds the booking (switch on refuses the clear)', async ({ page }) => {
    await mockApi(page);
    await openRoutes(page);

    await page.locator('tr', { hasText: 'Final Mile to Neo Lab' }).click();
    const help = page.getByText(/The booking whose daily job the driver opens/);
    await expect(help).toBeVisible();
    await expect(help).not.toContainText('Clearing it also unbinds');
  });

  test('a route with a master saves unchanged with the switch left on (test 2)', async ({ page }) => {
    await mockApi(page);
    await openRoutes(page);

    await page.locator('tr', { hasText: 'Final Mile to Neo Lab' }).click();
    await page.getByRole('button', { name: /^Save$/ }).click();

    await expect.poll(() => lastSave?.method).toBe('PUT');
    expect(lastSave!.body.masterBookingId).toBe(5372);
    expect(lastSave!.body.finalMileDeliveryMode).toBe(1);
  });
});

// M3, coverage filter on the schedules list (tests 5, 6, 7, 8 plus the
// endpoint-failure fallback). The overlap itself is computed server-side by
// the region TVF; here the endpoint is mocked so the flow checks what the
// editor sends and what it shows.

const LOOKUP = [
  { id: 10, headerId: 1, name: 'Alpha run', startTime: '08:00', endTime: '12:00', days: [1], isActive: true, clientCodes: [] },
  { id: 20, headerId: 2, name: 'Bravo run', startTime: '08:00', endTime: '12:00', days: [1], isActive: true, clientCodes: ['NEO'] },
  { id: 30, headerId: 3, name: 'Charlie run', startTime: '08:00', endTime: '12:00', days: [1], isActive: true, clientCodes: [] },
  { id: 40, headerId: 4, name: 'Delta run', startTime: '08:00', endTime: '12:00', days: [1], isActive: true, clientCodes: [] },
];

const ZIPS = Array.from({ length: 40 }, (_, i) => ({ zipPolygonId: 1000 + i, zip: String(91500 + i) }));

const COVERAGE_ROUTES = [
  {
    ...BASE_ROUTE,
    routeId: 21, name: 'FM forty zips', area: 'Forty postcodes area',
    direction: 2, depotId: 38, depotName: 'Burbank',
    zipcodes: ZIPS,
    // Delta is ticked and shares no postcode with the route (test 6).
    schedules: [{ scheduleId: 40, name: 'Delta run', window: '08:00-12:00', days: [1], headerId: 4 }],
  },
  {
    ...BASE_ROUTE,
    routeId: 22, name: 'FM polygon only', area: 'Polygon only area',
    direction: 2, depotId: 38, depotName: 'Burbank',
    bulkPolygons: [{ polygonId: 77, name: 'Lab corridor', centroidLatitude: 34.18, centroidLongitude: -118.31 }],
  },
];

let coverageCalls: any[] = [];

async function mockCoverage(page: Page, mode: 'ok' | 'fail' = 'ok') {
  await mockApi(page);
  coverageCalls = [];
  await page.route('**/api/bulk-polygons/*', (route: Route) => route.fulfill({ json: { response: null } }));
  await page.route('**/api/recurring-routes/schedules/lookup', (route: Route) =>
    route.fulfill({ json: { response: LOOKUP } }));
  await page.route('**/api/recurring-routes/schedules/coverage-match', (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    coverageCalls.push(body);
    if (mode === 'fail') {
      return route.fulfill({ status: 500, json: { title: 'Coverage filter unavailable' } });
    }
    if ((body.bulkPolygonIds ?? []).includes(77)) {
      // Test 8: the polygon touches a postcode only Charlie delivers to.
      return route.fulfill({ json: { response: { routePostcodeCount: 3,
        rows: [{ scheduleId: 30, headerId: 3, matchedCount: 1, depotWide: false }] } } });
    }
    return route.fulfill({ json: { response: { routePostcodeCount: 40, rows: [
      { scheduleId: 10, headerId: 1, matchedCount: 1, depotWide: false },
      { scheduleId: 20, headerId: 2, matchedCount: 12, depotWide: false },
    ] } } });
  });
  await page.route('**/api/recurring-routes', (route: Route) =>
    route.fulfill({ json: { response: [...ROUTES, ...COVERAGE_ROUTES] } }));
}

const coverageBox = (page: Page) => page.getByTestId('schedule-coverage-filter');
const scheduleRow = (page: Page, name: string) => page.locator('li', { hasText: name });

test.describe('Final-mile route setup - schedules filtered by coverage', () => {
  test('40-postcode route: overlapping schedules only, largest first, with counts (test 5); ticked with no overlap keeps the amber tag (test 6)', async ({ page }) => {
    await mockCoverage(page);
    await openRoutes(page);
    await page.locator('tr', { hasText: 'Forty postcodes area' }).locator('td').first().click();

    await expect(coverageBox(page)).toBeChecked();
    await expect(scheduleRow(page, 'Bravo run')).toContainText('12 of 40 postcodes');
    // Sharing exactly one postcode is enough to be listed.
    await expect(scheduleRow(page, 'Alpha run')).toContainText('1 of 40 postcodes');
    await expect(scheduleRow(page, 'Charlie run')).toHaveCount(0);
    // Ticked, no overlap: still listed, still ticked, tagged.
    await expect(scheduleRow(page, 'Delta run')).toContainText('no postcodes in common');
    await expect(scheduleRow(page, 'Delta run').getByRole('checkbox')).toBeChecked();

    const order = await page.locator('li').filter({ hasText: / run/ }).locator('span.font-medium.truncate').allTextContents();
    expect(order).toEqual(['Bravo run', 'Alpha run', 'Delta run']);
    expect(coverageCalls[0].direction).toBe(2);
    expect(coverageCalls[0].zipPolygonIds).toHaveLength(40);

    // Text filter on top of the coverage filter.
    const textFilter = page.getByPlaceholder('Filter schedules by name or client code...');
    await textFilter.fill('neo');
    await expect(scheduleRow(page, 'Bravo run')).toBeVisible();
    await expect(scheduleRow(page, 'Alpha run')).toHaveCount(0);

    // Off: the lookup, as today.
    await textFilter.fill('');
    await coverageBox(page).uncheck();
    await expect(scheduleRow(page, 'Charlie run')).toBeVisible();
    await expect(page.getByText(/of 40 postcodes/)).toHaveCount(0);
  });

  test('route with no coverage: tick box disabled with the hint, full list (test 7)', async ({ page }) => {
    await mockCoverage(page);
    await openRoutes(page);
    await page.getByRole('button', { name: /Add Route/ }).click();
    await page.getByRole('button', { name: 'Final mile' }).click();

    await expect(coverageBox(page)).toBeDisabled();
    await expect(page.getByText('Add postcodes or a polygon to filter by coverage')).toBeVisible();
    await expect(coverageBox(page)).toHaveAccessibleDescription('Add postcodes or a polygon to filter by coverage');
    for (const n of ['Alpha run', 'Bravo run', 'Charlie run', 'Delta run']) {
      await expect(scheduleRow(page, n)).toBeVisible();
    }
    expect(coverageCalls).toHaveLength(0);
  });

  test('route covered only by a custom polygon lists schedules covering a postcode it touches (test 8)', async ({ page }) => {
    await mockCoverage(page);
    await openRoutes(page);
    await page.locator('tr', { hasText: 'Polygon only area' }).click();

    await expect(scheduleRow(page, 'Charlie run')).toContainText('1 of 3 postcodes');
    await expect(scheduleRow(page, 'Bravo run')).toHaveCount(0);
    expect(coverageCalls[0].bulkPolygonIds).toEqual([77]);
    expect(coverageCalls[0].zipPolygonIds).toEqual([]);
  });

  test('endpoint failure: full list with the muted note', async ({ page }) => {
    await mockCoverage(page, 'fail');
    await openRoutes(page);
    await page.locator('tr', { hasText: 'Forty postcodes area' }).locator('td').first().click();

    await expect(page.getByText('Coverage filter unavailable')).toBeVisible();
    await expect(coverageBox(page)).toHaveAccessibleDescription('Coverage filter unavailable');
    for (const n of ['Alpha run', 'Bravo run', 'Charlie run', 'Delta run']) {
      await expect(scheduleRow(page, n)).toBeVisible();
    }
  });

  test('first-mile route: no tick box, list as today', async ({ page }) => {
    await mockCoverage(page);
    await openRoutes(page);
    await page.locator('tr', { hasText: 'Auckland central' }).click();

    await expect(coverageBox(page)).toHaveCount(0);
    await expect(scheduleRow(page, 'Charlie run')).toBeVisible();
    expect(coverageCalls).toHaveLength(0);
  });
});

// Coverage filter timing (spec 4.3.6, 4.3.7): what the list shows while a
// coverage-match request is pending, after the coverage changes, and when
// answers arrive out of order. The endpoint answers after a set delay.

const TIMING_ROUTE = {
  ...BASE_ROUTE,
  routeId: 31, name: 'FM zips and polygon', area: 'Timing area',
  direction: 2, depotId: 38, depotName: 'Burbank',
  zipcodes: ZIPS,
  bulkPolygons: [{ polygonId: 77, name: 'Lab corridor', centroidLatitude: 34.18, centroidLongitude: -118.31 }],
};

const TIMING_ZIP_ROWS = { routePostcodeCount: 40, rows: [
  { scheduleId: 10, headerId: 1, matchedCount: 3, depotWide: false },
  { scheduleId: 20, headerId: 2, matchedCount: 12, depotWide: false },
] };
const TIMING_POLY_ROWS = { routePostcodeCount: 3, rows: [
  { scheduleId: 30, headerId: 3, matchedCount: 1, depotWide: false },
] };

async function mockTiming(page: Page, delays: { withZips: number; polygonOnly: number }) {
  await page.route('**/api/**', (r: Route) => r.fulfill({ json: { response: [] } }));
  await page.route('**/api/recurring-routes/assignable-targets', (r: Route) =>
    r.fulfill({ json: { response: { couriers: [], agents: [], nps: [] } } }));
  await page.route('**/api/address/regions', (r: Route) => r.fulfill({ json: { regions: REGIONS } }));
  await page.route('**/api/bulk-polygons/*', (r: Route) => r.fulfill({ json: { response: null } }));
  await page.route('**/api/recurring-routes/schedules/lookup', (r: Route) =>
    r.fulfill({ json: { response: LOOKUP } }));
  await page.route('**/api/recurring-routes/schedules/coverage-match', async (r: Route) => {
    const body = JSON.parse(r.request().postData() ?? '{}');
    const withZips = (body.zipPolygonIds ?? []).length > 0;
    await new Promise((res) => setTimeout(res, withZips ? delays.withZips : delays.polygonOnly));
    await r.fulfill({ json: { response: withZips ? TIMING_ZIP_ROWS : TIMING_POLY_ROWS } }).catch(() => {});
  });
  await page.route('**/api/recurring-routes', (r: Route) =>
    r.fulfill({ json: { response: [TIMING_ROUTE] } }));
}

async function openTimingRoute(page: Page) {
  await page.goto('/recurring-routes');
  const routesTab = page.getByRole('button', { name: /^Routes$/ });
  if (await routesTab.count()) await routesTab.first().click();
  await page.locator('tr', { hasText: 'Timing area' }).locator('td').first().click();
}

async function clearZips(page: Page) {
  await page.getByRole('button', { name: 'Clear zips' }).click();
  await page.getByRole('button', { name: 'Clear zips' }).last().click();
}

const checkingNote = (page: Page) => page.getByText('Checking coverage...', { exact: true });

test.describe('Final-mile route setup - coverage filter timing', () => {
  test('first load: "Checking coverage..." shows while the request is pending, then the filtered list replaces it', async ({ page }) => {
    await mockTiming(page, { withZips: 4000, polygonOnly: 0 });
    await openTimingRoute(page);
    await expect(coverageBox(page)).toBeChecked();
    // Pending: the cue is shown and the list is the lookup, untouched.
    await expect(checkingNote(page)).toBeVisible();
    await expect(coverageBox(page)).toHaveAccessibleDescription('Checking coverage...');
    for (const n of ['Alpha run', 'Bravo run', 'Charlie run', 'Delta run']) {
      await expect(scheduleRow(page, n)).toBeVisible();
    }
    // Answered: cue gone, filtered list.
    await expect(scheduleRow(page, 'Bravo run')).toContainText('12 of 40 postcodes', { timeout: 10_000 });
    await expect(checkingNote(page)).toHaveCount(0);
    await expect(scheduleRow(page, 'Charlie run')).toHaveCount(0);
  });

  test('after the coverage changes, the previous list stays with "Checking coverage..." until the new answer arrives', async ({ page }) => {
    await mockTiming(page, { withZips: 0, polygonOnly: 3000 });
    await openTimingRoute(page);
    await expect(scheduleRow(page, 'Bravo run')).toContainText('12 of 40 postcodes');
    await expect(checkingNote(page)).toHaveCount(0);

    await clearZips(page);
    // Pending: the old list is kept (no flash to the full lookup) and flagged.
    await expect(checkingNote(page)).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(checkingNote(page)).toBeVisible();
    await expect(scheduleRow(page, 'Bravo run')).toContainText('12 of 40 postcodes');
    await expect(scheduleRow(page, 'Charlie run')).toHaveCount(0);

    await expect(scheduleRow(page, 'Charlie run')).toContainText('1 of 3 postcodes', { timeout: 10_000 });
    await expect(checkingNote(page)).toHaveCount(0);
    await expect(scheduleRow(page, 'Bravo run')).toHaveCount(0);
  });

  test('a slow answer for the old coverage does not overwrite the newer one (out of order)', async ({ page }) => {
    await mockTiming(page, { withZips: 2500, polygonOnly: 0 });
    await openTimingRoute(page);
    // Clear the zips before the first (zips) answer lands.
    await page.waitForTimeout(600);
    await clearZips(page);
    await expect(scheduleRow(page, 'Charlie run')).toContainText('1 of 3 postcodes', { timeout: 10_000 });
    // Let the stale zips answer arrive; it must be ignored.
    await page.waitForTimeout(3000);
    await expect(scheduleRow(page, 'Charlie run')).toContainText('1 of 3 postcodes');
    await expect(scheduleRow(page, 'Bravo run')).toHaveCount(0);
  });
});
