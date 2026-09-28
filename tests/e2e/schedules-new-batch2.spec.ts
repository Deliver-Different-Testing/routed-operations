import { test, expect, type Route, type Page } from '@playwright/test';

// E2E for the 2026-09-15 batch-2 additions on the Schedules NEW surface:
//   1. Detail modal Route tab resolves depot / speed / postcodeGroup /
//      storage / linehaulRun IDs to names via /api/schedules/lookups.
//      Prior behaviour was raw "#8, #20, #41, #67" tokens because the
//      lookup catalogue was seeded empty.
//   2. Storage state label agrees between the DEPOT card (backend-lookup
//      driven) and the Production Fields row (hardcoded temperatureLabel).
//      Prior behaviour was "Storage Frozen" vs "Storage state: Ambient"
//      because the modal's hardcoded 1=Frozen/2=Chilled/3=Ambient mapping
//      was reversed vs the backend seed (1=Ambient/2=Chilled/3=Frozen).
//   3. Roster tab surfaces recurring routes bound to the schedule via
//      the /api/recurring-routes list, filtered by scheduleId. Prior
//      behaviour was a stub italic note "the join lands in a follow-up".
//   4. New Schedule modal Linehaul leg exposes Speed override, Amount,
//      Add-on %, Insert-to-bulk, Apply-discount, Apply-add-on-%.
//   5. New Schedule modal Delivery leg exposes a Z1..Zn pill multi-select
//      driven by lookups.zoneNumbers, and clicking a pill toggles it.

const SCHEDULE_ID = 2042;

const V2_SCHEDULES = [
  {
    scheduleId: SCHEDULE_ID,
    name: 'AKL > CHCH Pre 8am Medical',
    legacyClientId: null,
    legacyClientCode: null,
    regionId: 3,
    regionName: 'Christchurch',
    speedId: 8,
    speedName: 'Morning Express',
    activeDays: [1, 2, 3, 4, 5],
    activeZonesCount: 0,
    clientCount: 2,
    postcodeCount: 0,
    polygonCount: 0,
    autoBook: true,
    hasActiveLinehaul: true,
    linkedClientCodes: ['MLC', 'PATH'],
    baseScheduleId: null,
  },
];

const V2_DETAIL = {
  scheduleId: SCHEDULE_ID,
  name: 'AKL > CHCH Pre 8am Medical',
  legacyClientId: null,
  legacyClientCode: null,
  regionId: 3,
  regionName: 'Christchurch',
  pickupDepotId: 1,
  pickupDepotName: 'Auckland',
  speedId: 8,
  speedName: 'Morning Express',
  parentSpeedId: null,
  parentSpeedName: null,
  postcodeGroupId: 67,
  postcodeGroupName: 'Christchurch AH',
  pickupPostcodeGroupId: null,
  pickupPostcodeGroupName: null,
  pickupRatingSpeed: 20,
  autoBook: false,
  bookPickup: null,
  applyPickupCutoff: null,
  pickupCutoff: null,
  storageState: 1,           // 1 = Ambient (per backend seed, aligned to ClientManager)
  deliveryState: 1,          // 1 = Ambient (per backend seed, aligned to ClientManager)
  pickupBoxDiscount: null,
  dropOffLocationId: null,
  dropOffLocationName: null,
  description: 'Book by 3 pm.',
  dayWindows: [
    { id: 1, dayOfWeek: 1, startTime: '06:00', endTime: '08:00', cutoffHours: 63 },
    { id: 2, dayOfWeek: 2, startTime: '06:00', endTime: '08:00', cutoffHours: 41 },
  ],
  zones: [{ id: 91, scheduleId: SCHEDULE_ID, zone: 2, active: true }],
  linehauls: [
    {
      id: 501,
      name: 'Akl - CHCH (Qantas Courier)',
      active: true,
      amount: 25,
      amountPercentage: 0,
      fromDepotId: 1,          // Auckland
      toDepotId: 3,            // Christchurch
      minutes: 300,
      linehaulRunId: 41,       // Qantas Courier run
      insertToBulk: true,
      applyDiscount: false,
      applyAddOnPercentage: false,
      weekDay: [1, 1, 1, 1, 1, 0, 0],
      departureAdvanceDays: 2,
      fromClientAddress: false,
      dropOffLocationId: null,
      speedId: null,
      speedName: null,
    },
  ],
  clientIds: [100, 200],
  clientCodes: ['MLC', 'PATH'],
  clientNames: ['Med Lab Co', 'Pathology Partners'],
  clientLinkedUtcs: ['2026-09-08T00:00:00Z', '2026-09-08T00:00:00Z'],
  postcodeIds: [],
  polygonIds: [],
};

const V2_ROUTES = [
  {
    routeId: 601,
    name: 'AKL Medical AM - Christchurch',
    area: 'CBD',
    defaultTargetType: 1,
    defaultTargetId: 200,
    defaultTargetName: 'V. Patel',
    scheduleId: SCHEDULE_ID,
    scheduleName: V2_DETAIL.name,
    scheduleWindow: '06:00 - 08:00',
    // Batch-2 wiring: RosterTab filters this array by scheduleId.
    schedules: [
      { scheduleId: SCHEDULE_ID, name: V2_DETAIL.name, window: '06:00 - 08:00', days: [1, 2, 3, 4, 5] },
    ],
    active: true,
    zipcodes: [],
    bulkPolygons: [],
    rosterEntryCount: 4,
    bookingCount: 15,
    mappedStopsCount: 9,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: null,
  },
  {
    // Second route bound to a DIFFERENT schedule so the filter step is
    // exercised. Should NOT surface in the modal.
    routeId: 602,
    name: 'AKL Standard PM - Wellington',
    area: 'CBD',
    defaultTargetType: 1,
    defaultTargetId: 300,
    defaultTargetName: 'A. Ng',
    scheduleId: 9999,
    scheduleName: 'Unrelated schedule',
    scheduleWindow: '13:00 - 17:00',
    schedules: [
      { scheduleId: 9999, name: 'Unrelated schedule', window: '13:00 - 17:00', days: [1, 2, 3, 4, 5] },
    ],
    active: true,
    zipcodes: [],
    bulkPolygons: [],
    rosterEntryCount: 0,
    bookingCount: 0,
    mappedStopsCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: null,
  },
];

async function stubApis(page: Page) {
  await page.route('**/api/v2/schedules?**', (route: Route) => {
    const url = new URL(route.request().url());
    const p = parseInt(url.searchParams.get('page') ?? '0', 10);
    const size = parseInt(url.searchParams.get('pageSize') ?? '0', 10);
    const rows = V2_SCHEDULES;
    const paged = size > 0 ? rows.slice(p * size, (p + 1) * size) : rows;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        response: { rows: paged, total: rows.length, page: p, pageSize: size },
      }),
    });
  });
  await page.route('**/api/v2/schedules/*/overrides', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ response: [] }) }),
  );
  await page.route('**/api/v2/schedules/*', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ response: V2_DETAIL }) }),
  );
  await page.route('**/api/v2/schedule-bundles', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ response: [] }) }),
  );
  await page.route('**/api/recurring-routes', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ response: V2_ROUTES }) }),
  );
  await page.route('**/api/schedules/clients*', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ response: [] }) }),
  );
  // Seeded lookups payload: this is the axis under test for batch-2
  // task #100 (Route tab resolves names) + task #101 (storage state
  // label uses backend mapping) + task #102 (delivery zone multi-select
  // reads zoneNumbers).
  await page.route('**/api/schedules/lookups', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        response: {
          depots: [
            { id: 1, name: 'Auckland' },
            { id: 3, name: 'Christchurch' },
            { id: 4, name: 'Gisborne' },
          ],
          speeds: [
            { id: 8, name: 'Morning Express' },
            { id: 20, name: 'Speed Collection' },
          ],
          couriers: [],
          clients: [],
          dropOffLocations: [],
          postcodeGroups: [
            { id: 67, name: 'Christchurch AH' },
          ],
          linehaulRuns: [
            { id: 41, runName: 'Qantas Courier', fromDepotId: 1, toDepotId: 3 },
          ],
          zoneNumbers: [1, 2, 3, 4, 5],
          storageStates: [
            { id: 0, label: 'None' },
            { id: 1, label: 'Ambient' },
            { id: 2, label: 'Chilled' },
            { id: 3, label: 'Frozen' },
          ],
          deliveryStates: [
            { id: 0, label: 'None' },
            { id: 1, label: 'Ambient' },
            { id: 2, label: 'Chilled' },
            { id: 3, label: 'Frozen' },
          ],
          pickupBoxDiscounts: [],
        },
      }),
    }),
  );
}

test.describe('Schedules NEW - batch-2 (lookups, storage state, recurring routes join, per-leg fields)', () => {
  test('Route tab resolves depot / linehaul-run / postcodeGroup names (no raw #IDs)', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules-new');

    await page.getByText('AKL > CHCH Pre 8am Medical').first().click();
    await page.getByRole('button', { name: 'Route', exact: true }).click();

    // Auckland depot (id=1) resolves on the DEPOT card as name, not #1.
    // Scope to the leg card badge span; the editable ChainBuilder
    // chooser at the bottom now also renders a "DEPOT" add button.
    await expect(page.locator('span').filter({ hasText: /^DEPOT$/ }).first()).toBeVisible();
    await expect(page.getByText('Auckland').first()).toBeVisible();

    // Linehaul run (id=41) → "Qantas Courier". Was raw "run #41" pre-fix.
    await expect(page.getByText(/Qantas Courier/)).toBeVisible();
    // Postcode group (id=67) → "Christchurch AH". Was "zone group #67".
    await expect(page.getByText(/zone group Christchurch AH/)).toBeVisible();
    // Delivery region (id=3) → Christchurch.
    await expect(page.getByText(/Deliver in Christchurch/)).toBeVisible();
    // No raw hash tokens leak through.
    await expect(page.getByText(/#67/)).toHaveCount(0);
    await expect(page.getByText(/run #41/)).toHaveCount(0);
  });

  test('Storage state label on DEPOT card uses backend seed mapping (id=1 -> Ambient)', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules-new');

    await page.getByText('AKL > CHCH Pre 8am Medical').first().click();
    await page.getByRole('button', { name: 'Route', exact: true }).click();

    // DEPOT card summary uses the backend seed mapping for storage
    // state. Backend seed 1=Ambient; the earlier bug was that the
    // modal's hardcoded temperatureLabel reversed the mapping. The
    // stubbed lookups payload carries the same 1=Ambient order.
    await expect(page.getByText('Storage Ambient')).toBeVisible();
    // Delivery state (id=1 -> Ambient) now surfaces in the editable
    // "Advanced" collapsible section under the ChainBuilder. Expand it
    // and assert the select's selected option is "Ambient".
    await page.getByRole('button', { name: /Advanced \(schedule speed/ }).click();
    const deliveryStateSelect = page.locator('label').filter({ hasText: 'Delivery state' }).locator('select');
    await expect(deliveryStateSelect).toHaveValue('1');
  });

  test('Roster tab surfaces the recurring route bound to this schedule', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules-new');

    await page.getByText('AKL > CHCH Pre 8am Medical').first().click();
    await page.getByRole('button', { name: 'Roster', exact: true }).click();

    // Bound route surfaces.
    await expect(page.getByText('AKL Medical AM - Christchurch')).toBeVisible();
    // "1 route" counter (only route with matching scheduleId).
    await expect(page.getByText('1 route', { exact: true })).toBeVisible();
    // The other route (scheduleId=9999) is filtered out.
    await expect(page.getByText('AKL Standard PM - Wellington')).toHaveCount(0);
  });

  test('Roster tab empty state renders when nothing is bound', async ({ page }) => {
    await stubApis(page);
    await page.route('**/api/recurring-routes', (route: Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ response: [] }) }),
    );
    await page.goto('/schedules-new');

    await page.getByText('AKL > CHCH Pre 8am Medical').first().click();
    await page.getByRole('button', { name: 'Roster', exact: true }).click();

    await expect(page.getByText('No recurring routes bound to this schedule.')).toBeVisible();
    await expect(page.getByText('0 routes')).toBeVisible();
  });

  test('New Schedule Linehaul leg exposes Speed override + Amount + Add-on % + 3 charging flags', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules-new');

    await page.getByRole('button', { name: /New Schedule/ }).click();

    // Add a Linehaul leg via the "Choose first leg" chooser.
    await page.getByRole('button', { name: 'LINEHAUL' }).first().click();

    // Editor auto-expands. Scope every assertion to a <label> so the
    // footer help copy ("Save picks up ... speed override + amount +
    // add-on % + charging flags") doesn't collide.
    await expect(page.locator('label').filter({ hasText: 'Speed override' })).toBeVisible();
    await expect(page.locator('label').filter({ hasText: 'Amount ($)' })).toBeVisible();
    await expect(page.locator('label').filter({ hasText: 'Add-on %' })).toBeVisible();
    await expect(page.locator('label').filter({ hasText: /Insert into bulk/ })).toBeVisible();
    await expect(page.locator('label').filter({ hasText: 'Apply schedule discount' })).toBeVisible();
    await expect(page.locator('label').filter({ hasText: 'Apply add-on percentage' })).toBeVisible();
  });

  test('Detail modal Save wire PUTs ScheduleGroupUpsertBody with scheduleId + edited name', async ({ page }) => {
    let putBody: any = null;
    await stubApis(page);
    // The Save button on Schedules NEW now hits PUT
    // /api/v2/schedules/{id} (v2 upsert with path-id winning). Legacy
    // /api/schedules PUT still exists for the old page.
    await page.route(`**/api/v2/schedules/${SCHEDULE_ID}`, (route: Route) => {
      if (route.request().method() === 'PUT') {
        putBody = route.request().postDataJSON();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ response: { ...V2_DETAIL, name: 'Renamed by test' } }),
        });
      }
      return route.fallback();
    });
    await page.route('**/api/schedules', (route: Route) => {
      if (route.request().method() === 'PUT') {
        putBody = route.request().postDataJSON();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ response: { ...V2_DETAIL, name: 'Renamed by test' } }),
        });
      }
      return route.fallback();
    });
    await page.goto('/schedules-new');

    // Open the detail modal on schedule #2042.
    await page.getByText('AKL > CHCH Pre 8am Medical').first().click();
    await expect(page.getByRole('heading', { level: 3, name: /AKL > CHCH Pre 8am Medical/ })).toBeVisible();

    // Edit the name in the header input.
    const nameInput = page.locator('input[type=text]').filter({ hasNot: page.locator('[type=search]') }).first();
    await nameInput.fill('Renamed by test');

    // Save. Modal closes on success.
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { level: 3, name: /AKL > CHCH Pre 8am Medical/ })).toHaveCount(0);

    // Server received the expected body.
    expect(putBody).not.toBeNull();
    expect(putBody.scheduleId).toBe(SCHEDULE_ID);
    expect(putBody.name).toBe('Renamed by test');
    // regionId is required by the backend upsert and comes from the
    // Delivery leg reconstructed on load (regionId = 3).
    expect(putBody.regionId).toBe(3);
    // dayWindows are derived from the DaysTab state (Mon + Tue enabled).
    expect(putBody.dayWindows.length).toBe(2);
    // Client link rows are preserved verbatim (managed via the /clients
    // attach/detach endpoints, not through upsert).
    expect(putBody.clientCodes).toEqual(V2_DETAIL.clientCodes);
  });

  test('New Schedule Delivery leg exposes Z-pill multi-select + toggles selection', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules-new');

    await page.getByRole('button', { name: /New Schedule/ }).click();

    // Add a Delivery leg (only one accepted at end of chain).
    await page.getByRole('button', { name: 'DELIVERY' }).first().click();

    // Section label from ChainBuilder.
    await expect(page.getByText('Zones this leg fulfils')).toBeVisible();

    // 5 zone pills seeded from lookups.zoneNumbers = [1..5].
    for (const z of ['Z1', 'Z2', 'Z3', 'Z4', 'Z5']) {
      await expect(page.getByText(z, { exact: true })).toBeVisible();
    }
    // Sanity: zoneNumbers = [1..5], so Z6 does not appear.
    await expect(page.getByText('Z6', { exact: true })).toHaveCount(0);

    // Click Z1 - selection border swaps to brand-cyan. The hidden
    // checkbox is bound to the Z1 label via getByLabel('Z1').
    const z1Checkbox = page.getByLabel('Z1');
    const z1Label = page.getByText('Z1', { exact: true });
    await z1Label.click();
    await expect(z1Checkbox).toBeChecked();

    // Toggle off.
    await z1Label.click();
    await expect(z1Checkbox).not.toBeChecked();
  });

  test('URL deep-link ?edit=<id> opens detail modal on load', async ({ page }) => {
    await stubApis(page);
    // Navigate directly with ?edit=2042 - the detail modal should
    // open on mount for the id in the URL, no click required.
    await page.goto(`/schedules-new?edit=${SCHEDULE_ID}`);

    // Detail modal header + tabs render.
    await expect(page.getByRole('heading', { level: 3, name: /AKL > CHCH Pre 8am Medical/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Route', exact: true })).toBeVisible();

    // Close clears the query param so the URL isn't stuck on ?edit.
    // Two "Close" buttons render: the modal's aria-label icon in the
    // header + the footer text button. Click the footer one.
    await page.getByText('Close', { exact: true }).click();
    await expect(page.getByRole('heading', { level: 3, name: /AKL > CHCH Pre 8am Medical/ })).toHaveCount(0);
    await expect(page).toHaveURL(/\/schedules-new(?!\?edit=)/);
  });

  test('Row click updates URL to ?edit=<id> for sharing', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules-new');

    await page.getByText('AKL > CHCH Pre 8am Medical').first().click();
    await expect(page.getByRole('heading', { level: 3, name: /AKL > CHCH Pre 8am Medical/ })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`edit=${SCHEDULE_ID}`));
  });
});
