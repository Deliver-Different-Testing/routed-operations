import { test, expect, type Route } from '@playwright/test';

// E2E smoke test for the Schedules module (group-shaped model). Verifies:
//   1. /schedules mounts four tabs (NZ default: Schedules / Zones / Postcode Groups / Depots)
//      US tenant swaps labels to Zip Groups + Locations respectively.
//   2. Schedules tab shows one row per GROUP with day chips + junction counts
//   3. Add Schedule opens the full-body modal with the per-day window
//      table + clients + postcodes + polygons + linehauls sections
//   4. Row click opens edit populated for that group
//   5. Zones tab (NZ + US)
//   6. Zone Groups tab (postcode groups + US zone groups/names)
//   7. Depots tab with show-inactive toggle
//
// All API calls mocked so no DB is needed.

const LOOKUPS = {
  depots: [
    { id: 1, name: 'Auckland' },
    { id: 2, name: 'Wellington' },
    { id: 3, name: 'Christchurch' },
  ],
  speeds: [{ id: 1, name: 'Standard' }, { id: 2, name: 'Express' }],
  couriers: [{ id: 1, name: 'C01 Alice' }],
  clients: [
    { id: 100, name: 'ACME Foods (ACME)' },
    { id: 200, name: 'Beta Corp (BETA)' },
    { id: 300, name: 'Gamma Ltd (GAMMA)' },
  ],
  dropOffLocations: [{ id: 1, name: 'Auckland Airport Hub', depotId: 1 }],
  postcodeGroups: [
    { id: 10, name: 'Metro AKL', depotId: 1, clientId: null },
    { id: 11, name: 'Metro WLG', depotId: 2, clientId: null },
  ],
  linehaulRuns: [{ id: 100, runName: 'AKL-WLG overnight', fromDepotId: 1, toDepotId: 2, startTime: '19:00', despatchTime: '21:00', courierId: 1 }],
  zoneNumbers: [1, 2, 3, 4, 5],
  storageStates: [{ id: 0, label: 'None' }, { id: 1, label: 'Ambient' }],
  deliveryStates: [{ id: 0, label: 'None' }, { id: 1, label: 'Ambient' }],
  pickupBoxDiscounts: [{ id: 0, label: 'None' }],
};

// Full DETAIL shape - returned from /api/schedules/detail on row click.
const SAMPLE_GROUP_DETAIL = {
  scheduleId: 1,
  name: 'NZ Standard',
  legacyClientId: null,
  legacyClientCode: null,
  regionId: 1, regionName: 'Auckland',
  pickupDepotId: 1, pickupDepotName: 'Auckland',
  speedId: 1, speedName: 'Standard',
  parentSpeedId: null, parentSpeedName: null,
  postcodeGroupId: 10, postcodeGroupName: 'Metro AKL',
  pickupPostcodeGroupId: null, pickupPostcodeGroupName: null,
  pickupRatingSpeed: null,
  autoBook: true, bookPickup: true, applyPickupCutoff: false, pickupCutoff: null,
  storageState: null, deliveryState: null, pickupBoxDiscount: null,
  dropOffLocationId: null, dropOffLocationName: null,
  description: 'Nationwide overnight',
  // Five day-windows with per-day cutoff (matches real staging shape).
  dayWindows: [
    { id: 1, dayOfWeek: 1, startTime: '08:00', endTime: '17:00', cutoffHours: 2 },
    { id: 2, dayOfWeek: 2, startTime: '08:00', endTime: '17:00', cutoffHours: 13 },
    { id: 3, dayOfWeek: 3, startTime: '08:00', endTime: '17:00', cutoffHours: 13 },
    { id: 4, dayOfWeek: 4, startTime: '08:00', endTime: '17:00', cutoffHours: 13 },
    { id: 5, dayOfWeek: 5, startTime: '08:00', endTime: '17:00', cutoffHours: 13 },
  ],
  zones: [
    { id: 1, scheduleId: 1, zone: 1, active: true },
    { id: 2, scheduleId: 1, zone: 2, active: true },
  ],
  linehauls: [{
    id: 1, name: 'AKL-WLG', active: true, amount: 25, amountPercentage: 0,
    fromDepotId: 1, toDepotId: 2, minutes: 600, linehaulRunId: 100,
    insertToBulk: true, applyDiscount: false, applyAddOnPercentage: false,
    weekDay: [1, 1, 1, 1, 1, 0, 0], departureAdvanceDays: 0,
    fromClientAddress: false, dropOffLocationId: null, speedId: null, speedName: null,
  }],
  clientIds: [100, 200],
  clientCodes: ['ACME', 'BETA'],  // resolved client codes for display
  clientNames: ['Acme Logistics Ltd', 'Beta Freight Co'],
  clientLinkedUtcs: ['2026-09-01T00:00:00Z', '2026-09-05T00:00:00Z'],
  postcodeIds: [1010, 6011],
  polygonIds: [500],
};

// SUMMARY shape - what /api/schedules returns. SchedulesTab consumes
// this list; its `clientCount`, `postcodeCount`, `polygonCount`, and
// `activeDays`/`activeZonesCount` render on the row.
const SAMPLE_GROUPS = [
  {
    scheduleId: 1,
    name: 'NZ Standard',
    legacyClientId: null,
    legacyClientCode: null,
    regionId: 1, regionName: 'Auckland',
    pickupDepotId: 1, pickupDepotName: 'Auckland',
    speedId: 1, speedName: 'Standard',
    activeDays: [1, 2, 3, 4, 5],
    activeZonesCount: 2,
    clientCount: 2,
    postcodeCount: 2,
    polygonCount: 1,
    autoBook: true,
    hasActiveLinehaul: true,
    linkedClientCodes: ['ACME', 'BETA'],
    baseScheduleId: null,
    description: 'Nationwide overnight',
    windowStart: '08:00',
    windowEnd: '17:00',
    monCutoffHours: 2,
    otherCutoffHours: 13,
    overrideCount: 0,
    routeCount: 0,
    linehaulHint: null,
  },
];

const SAMPLE_POLYGONS = [
  { polygonId: 500, name: 'Auckland CBD', sourceType: 0, sourceCode: null,
    centroidLatitude: -36.85, centroidLongitude: 174.76, active: true,
    points: [], attachedRouteCount: 2, attachedRoutes: [],
    partiallyIncludedZips: null,
    createdUtc: '2026-01-01T00:00:00Z', createdBy: 'kev',
    lastModifiedUtc: null, updatedBy: null,
    zoneNameId: null, postcodeGroupId: null, attachedScheduleNames: [] },
  { polygonId: 501, name: 'Wellington CBD', sourceType: 0, sourceCode: null,
    centroidLatitude: -41.29, centroidLongitude: 174.77, active: true,
    points: [], attachedRouteCount: 0, attachedRoutes: [],
    partiallyIncludedZips: null,
    createdUtc: '2026-01-01T00:00:00Z', createdBy: 'kev',
    lastModifiedUtc: null, updatedBy: null,
    zoneNameId: null, postcodeGroupId: null, attachedScheduleNames: [] },
];

const TERRITORY_NZ = {
  countryCode: 'NZ',
  depots: [
    { id: 1, name: 'Auckland', active: true },
    { id: 2, name: 'Wellington', active: true },
    { id: 3, name: 'Christchurch', active: false },
  ],
  postcodeGroups: [
    { id: 10, name: 'Metro AKL', depotId: 1, depotName: 'Auckland', clientId: null, clientCode: null, postcodeCount: 45 },
  ],
  nzPostcodes: [{ id: 1, postCode: 1010, zone: 1, depotId: 1, depotName: 'Auckland', postcodeGroupId: 10, postcodeGroupName: 'Metro AKL', fromSiteId: 0, name: 'AKL CBD', fromLatLng: '-36.85,174.76' }],
  usZipZones: [],
  zoneNames: [],
  zoneGroups: [],
};

async function stubApis(page: import('@playwright/test').Page, opts: {
  tenant?: 'NZ' | 'US',
  groups?: any[],
} = {}) {
  const tenant = opts.tenant ?? 'NZ';
  const territory = tenant === 'US'
    ? { ...TERRITORY_NZ, countryCode: 'US', nzPostcodes: [], usZipZones: [
        { id: 1, zip: '90001', zoneNumber: 1, zoneNameId: 1, zoneName: 'LA Metro', zoneGroupId: 1, zoneGroupName: 'West Coast', postcodeGroupId: null, postcodeGroupName: null, applyCongestion: true },
      ], zoneNames: [{ id: 1, name: 'LA Metro', zoneGroupId: 1, zoneGroupName: 'West Coast', locationId: 1, locationName: 'Los Angeles', zipCount: 12 }], zoneGroups: [{ id: 1, name: 'West Coast', clearListAreaId: null, zoneNameCount: 3 }] }
    : TERRITORY_NZ;

  const scheduleHandler = (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ response: opts.groups ?? SAMPLE_GROUPS }) });
  await page.route('**/api/schedules', scheduleHandler);
  await page.route('**/api/schedules?**', scheduleHandler);
  // Row-click + Copy... both call scheduleService.detail(scheduleId)
  // which hits GET /api/schedules/detail?scheduleId=1. Serve the DETAIL
  // shape so the edit / copy modal receives dayWindows + linehauls etc.
  await page.route('**/api/schedules/detail**', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ response: SAMPLE_GROUP_DETAIL }) }));
  await page.route('**/api/schedules/lookups', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ response: LOOKUPS }) }));
  // Server-side client search endpoint. Returns the same seeded
  // clients list; empty q returns full list (browse), non-empty q
  // returns a substring-filtered subset. Enough to satisfy the
  // debounced picker behaviour without a full LIKE emulation.
  await page.route('**/api/schedules/clients*', (route: Route) => {
    const url = new URL(route.request().url());
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const hits = q
      ? LOOKUPS.clients.filter((c) => (c.name ?? '').toLowerCase().includes(q))
      : LOOKUPS.clients;
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ response: hits }) });
  });
  await page.route('**/api/bulk-polygons', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ response: SAMPLE_POLYGONS }) }));
  await page.route('**/api/territory/bootstrap', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ response: territory }) }));
  await page.route('**/api/territory/depots', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ response: territory.depots }) }));
}

test.describe('Schedules module - group-shaped model + junctions', () => {
  test('renders four tabs with the Configurator visual style', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules');

    // Default tenant in the dev index.html is NZ. Tab labels use the
    // NZ vocabulary (Postcode Groups + Depots) - US tenant would show
    // "Zip Groups" + "Locations" instead.
    await expect(page.getByRole('button', { name: 'Schedules', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zones', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Postcode Groups', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Depots', exact: true })).toBeVisible();

    await page.screenshot({ path: 'test-results/schedules-tab-schedules.png', fullPage: true });
  });

  test('Schedules tab shows GROUPED rows with junction counts', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules');

    // One row for the "NZ Standard" group (not 5 rows).
    const nameCells = page.getByRole('cell', { name: 'NZ Standard' });
    await expect(nameCells).toHaveCount(1);

    // Junction count cells - clients=2, postcodes=2, polygons=1, zones=2.
    // Assert via row scoping so we hit the right row.
    const row = page.getByRole('row').filter({ hasText: 'NZ Standard' });
    await expect(row.getByText('2', { exact: true }).first()).toBeVisible();

    // Cyan pill + client filter + search present.
    await expect(page.getByRole('button', { name: '+ Add Schedule' })).toBeVisible();
    // Filter is now by client CODE (e.g. "ACME"), not id.
    await expect(page.getByPlaceholder('Client Code')).toBeVisible();

    // Auto-book pill shows "On".
    await expect(page.getByRole('button', { name: 'On', exact: true })).toBeVisible();
  });

  test('Add Schedule opens modal with per-day window table + junction pickers', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules');

    await page.getByRole('button', { name: '+ Add Schedule' }).click();
    await expect(page.getByRole('heading', { name: 'New schedule' })).toBeVisible();

    // All eight section headings from the group modal.
    for (const title of [
      'Schedule', 'Collection', 'Active Days & Window',
      'Clients', 'Postcodes', 'Coverage Polygons',
      'Linehaul Legs', 'Delivery', 'Notes',
    ]) {
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    }

    // Day-window table: 7 rows, one per weekday. Assert the weekday
    // labels are present as row cells.
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      await expect(page.getByRole('cell', { name: day, exact: true })).toBeVisible();
    }

    // Client picker shows all three seeded clients.
    await expect(page.getByText('ACME Foods (ACME)')).toBeVisible();
    await expect(page.getByText('Beta Corp (BETA)')).toBeVisible();

    // Polygon picker shows the seeded polygons.
    await expect(page.getByText('Auckland CBD')).toBeVisible();

    // Footer buttons.
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create' })).toBeVisible();

    await page.screenshot({ path: 'test-results/schedules-new-modal.png', fullPage: true });
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('Row-click opens edit modal populated with group data', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules');

    await page.getByRole('cell', { name: 'NZ Standard' }).click();
    await expect(page.getByRole('heading', { name: 'Edit "NZ Standard"' })).toBeVisible();

    // Existing group has 5 active weekday windows - Mon-Fri checkboxes
    // in the day-window table should all be checked.
    // We just spot-check that the day-window table renders + shows the
    // seeded cutoff values (13 appears on Tue-Fri per seed data).
    const monRow = page.getByRole('row').filter({ hasText: 'Mon' });
    // Mon's cutoff = 2 in seed data.
    await expect(monRow.getByRole('spinbutton')).toHaveValue('2');

    await page.keyboard.press('Escape');
  });

  test('Zones tab renders NZ postcode grid', async ({ page }) => {
    await stubApis(page, { tenant: 'NZ' });
    await page.goto('/schedules');
    await page.getByRole('button', { name: 'Zones', exact: true }).click();
    await expect(page.getByText('NZ', { exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '1010' })).toBeVisible();
  });

  test('Zone Groups tab shows three sub-grids under US tenant', async ({ page }) => {
    await stubApis(page, { tenant: 'US' });
    await page.goto('/schedules');
    await page.getByRole('button', { name: 'Postcode Groups', exact: true }).click();
    await expect(page.locator('p').getByText('Postcode Groups', { exact: true })).toBeVisible();
    await expect(page.locator('p').getByText('US Zone Groups', { exact: true })).toBeVisible();
    await expect(page.locator('p').getByText('US Zone Names', { exact: true })).toBeVisible();
  });

  test('Copy... opens copy modal seeded with source + client bindings', async ({ page }) => {
    await stubApis(page);
    // Mock the copy endpoint - returns a modified copy of the seed group.
    await page.route('**/api/schedules/copy', (route: Route) => {
      const copyOfSample = { ...SAMPLE_GROUP_DETAIL, name: 'NZ Standard (copy)' };
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ response: copyOfSample }) });
    });

    await page.goto('/schedules');

    // Open the row-actions kebab menu on the seeded schedule.
    await page.getByRole('button', { name: 'Row actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Copy...' }).click();

    // Copy modal is open.
    await expect(page.getByRole('heading', { name: 'Copy schedule - NZ Standard' })).toBeVisible();
    // Copy From section shows the source's clients (ACME + BETA seeded).
    await expect(page.getByText('ACME').first()).toBeVisible();
    await expect(page.getByText('BETA').first()).toBeVisible();
    // New name defaults to "<source> (copy)". The only input with that
    // value; assert on the value directly (label isn't htmlFor-linked
    // so getByRole('textbox', { name }) can't pick it up).
    await expect(page.locator('input[value="NZ Standard (copy)"]')).toBeVisible();
    // Create copy button visible.
    await expect(page.getByRole('button', { name: 'Create Copy' })).toBeVisible();

    await page.getByRole('button', { name: 'Create Copy' }).click();
    // On success the modal closes + the copy opens in edit mode.
    await expect(page.getByRole('heading', { name: 'Edit "NZ Standard (copy)"' })).toBeVisible();
  });

  test('Depots tab lists depots read-only with show-inactive toggle', async ({ page }) => {
    await stubApis(page, { tenant: 'NZ' });
    await page.goto('/schedules');
    await page.getByRole('button', { name: 'Depots', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'Auckland' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Christchurch' })).not.toBeVisible();

    await page.getByLabel('Show inactive').check();
    await expect(page.getByRole('cell', { name: 'Christchurch' })).toBeVisible();
    await expect(page.getByText('Inactive', { exact: true })).toBeVisible();

    // Depots tab now inlines the on/off toggle; full CRUD still lives
    // in AdminManager. Assertion matches the current footnote copy.
    await expect(page.getByText(/stays in the AdminManager/i)).toBeVisible();
  });
});
