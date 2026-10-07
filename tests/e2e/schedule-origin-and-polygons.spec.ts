import { test, expect, type Route } from '@playwright/test';

// E2E for the 2026-10-07 pair of specs:
//   KEVIN-SCHEDULE-ORIGIN-CLIENT-ADDRESS-2026-10-07.md
//   KEVIN-CUSTOM-POLYGONS-ROUTES-AND-ZONES-2026-10-07.md
//
// Every API call is stubbed, so this needs neither a backend nor the
// migrations. That matters here: the polygon tables (20261007170000) are not
// applied anywhere yet, and the booking-SP migrations only change what
// happens at booking time, which no browser test can observe anyway.
//
// What is covered, and which acceptance item it maps to:
//   origin 4  Collection card has no Pickup source dropdown and no pickup
//             depot picker; the destination comes from the chain's Depot leg
//   origin 8  Collection card DOES have zone group + zones, mirroring Delivery
//   origin 5  a Collection leg appears only when the schedule books one, so a
//             delivery-only schedule no longer reads "Collect from Auckland"
//             (this is F6, seen from the UI side)
//   origin 1  the first Depot leg offers "Client address", and choosing it
//             reveals the Origin region picker
//   origin 2.1 "Add Collection" is disabled while the origin is the client
//   origin 1  a stored client-origin schedule round-trips into the editor
//   polygons 5 the recurring-route Coverage box finds postcodes AND polygons,
//             and a chosen polygon becomes a coloured chip
//
// Not covered here, deliberately: anything that only shows up in a booked
// job (coordinates on the job, which schedules the availability function
// offers). Those are the SP changes and they need a tenant, not a browser.

const DEPOTS = [
  { id: 1, name: 'Auckland' },
  { id: 3, name: 'Christchurch' },
  { id: 16, name: 'Wellington' },
];

const LOOKUPS = {
  depots: DEPOTS,
  speeds: [
    { id: 1, name: 'Medical' },
    { id: 166, name: 'Collection' },
  ],
  couriers: [],
  clients: [],
  dropOffLocations: [],
  postcodeGroups: [
    { id: 33, name: 'Christchurch metro', depotId: 3 },
    { id: 44, name: 'Auckland pickup', depotId: 1 },
  ],
  linehaulRuns: [],
  zoneNumbers: [1, 2, 3, 4],
  storageStates: [{ id: 1, label: 'Ambient' }],
  deliveryStates: [{ id: 1, label: 'Standard' }],
  pickupBoxDiscounts: [],
};

// Depot origin WITH a collection leg: the medical corridor schedule the
// origin spec names as the regression case. Collection depot Auckland,
// delivery region Christchurch - the two are different on purpose, which is
// what proves the Collection card's destination is read from the Depot leg
// rather than from the delivery region.
const DEPOT_ORIGIN_DETAIL = {
  scheduleId: 1042,
  name: 'AKL > CHCH Pre 10am Medical',
  legacyClientId: null,
  legacyClientCode: null,
  regionId: 3,
  regionName: 'Christchurch',
  pickupDepotId: 1,
  pickupDepotName: 'Auckland',
  originType: 'depot',
  originRegionId: null,
  originRegionName: null,
  speedId: 1,
  speedName: 'Medical',
  parentSpeedId: 1,
  parentSpeedName: 'Medical',
  postcodeGroupId: 33,
  postcodeGroupName: 'Christchurch metro',
  pickupPostcodeGroupId: 44,
  pickupPostcodeGroupName: 'Auckland pickup',
  pickupRatingSpeed: 166,
  autoBook: true,
  bookPickup: true,
  applyPickupCutoff: false,
  pickupCutoff: null,
  storageState: 1,
  deliveryState: 1,
  pickupBoxDiscount: null,
  dropOffLocationId: null,
  dropOffLocationName: null,
  description: 'Two day service to Christchurch.',
  dayWindows: [{ id: 1, dayOfWeek: 1, startTime: '06:00', endTime: '08:00', cutoffHours: 18 }],
  zones: [{ id: 1, scheduleId: 1, zone: 2, active: true }],
  pickupZones: [{ id: 9, scheduleId: 1, zone: 3, active: true }],
  linehauls: [],
  clientIds: [100],
  clientCodes: ['MLC'],
  postcodeIds: [],
  polygonIds: [],
  clientLinkedUtcs: [],
  clientNames: ['Medical Labs'],
  displayName: null,
  displayDescription: null,
  isActive: true,
};

// Delivery-only: no collection job, but it DOES still have a depot. Before
// this work the editor invented a Collection leg for every schedule, so an
// on-demand express schedule read "Collect from Auckland" although it
// collects nothing (F6).
//
// The depot is kept on purpose. With it, the F6 assertion proves the
// Collection leg is gated on BookPickup; drop it and the assertion would
// also pass for the trivial reason that there is no depot to collect into.
const DELIVERY_ONLY_DETAIL = {
  ...DEPOT_ORIGIN_DETAIL,
  scheduleId: 7,
  name: '3 Hour Express 15:00-18:00',
  bookPickup: false,
  pickupPostcodeGroupId: null,
  pickupPostcodeGroupName: null,
  pickupZones: [],
};

// Client origin: the shape this feature exists for. BookPickup = 0 with a
// null pickup depot, origin region Auckland, delivery region Christchurch.
const CLIENT_ORIGIN_DETAIL = {
  ...DEPOT_ORIGIN_DETAIL,
  scheduleId: 13342,
  name: 'PB TECH TEST (AIRPORT)',
  bookPickup: false,
  pickupDepotId: null,
  pickupDepotName: null,
  originType: 'client',
  originRegionId: 1,
  originRegionName: 'Auckland',
  pickupZones: [],
};

const LIST_ROW = {
  scheduleId: 1042,
  name: 'AKL > CHCH Pre 10am Medical',
  legacyClientId: null,
  legacyClientCode: null,
  regionId: 3,
  regionName: 'Christchurch',
  speedId: 1,
  speedName: 'Medical',
  activeDays: [1],
  activeZonesCount: 1,
  clientCount: 1,
  postcodeCount: 0,
  polygonCount: 0,
  autoBook: true,
  hasActiveLinehaul: false,
  linkedClientCodes: ['MLC'],
  baseScheduleId: null,
};

function json(route: Route, body: unknown) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Stubs the schedules page against one detail payload. */
async function stubSchedules(page: import('@playwright/test').Page, detail: unknown, row = LIST_ROW) {
  // Server-paginated envelope (2026-09-15): the page consumes
  // { rows, total, page, pageSize }, not a bare array.
  await page.route('**/api/v2/schedules?**', (r: Route) =>
    json(r, { response: { rows: [row], total: 1, page: 0, pageSize: 0 } }));
  // The specific routes have to be registered BEFORE the generic
  // /schedules/{id} below or the wildcard short-circuits them.
  await page.route('**/api/v2/schedules/*/overrides', (r: Route) => json(r, { response: [] }));
  await page.route('**/api/v2/schedules/*/overrides/*', (r: Route) => json(r, { response: [] }));
  await page.route('**/api/v2/schedules/*/clients', (r: Route) => json(r, { response: [] }));
  await page.route('**/api/v2/schedules/*/retire', (r: Route) => json(r, { response: 'ok' }));
  await page.route('**/api/v2/schedule-bundles', (r: Route) => json(r, { response: [] }));
  await page.route('**/api/recurring-routes', (r: Route) => json(r, { response: [] }));
  await page.route('**/api/recurring-linehaul-runs', (r: Route) => json(r, { response: [] }));
  await page.route('**/api/schedules/clients*', (r: Route) => json(r, { response: [] }));
  await page.route('**/api/schedules/lookups', (r: Route) => json(r, { response: LOOKUPS }));
  // Detail last so the wildcard does not swallow the routes above.
  await page.route('**/api/v2/schedules/*', (r: Route) => json(r, { response: detail }));
}

async function openRoute(page: import('@playwright/test').Page, name: string | RegExp) {
  await page.goto('/schedules-new');
  await page.getByText(name).first().click();
  await page.getByRole('button', { name: 'Route', exact: true }).click();
}

test.describe('Schedule origin: the Collection card', () => {
  test('has no pickup source dropdown and no pickup depot picker', async ({ page }) => {
    await stubSchedules(page, DEPOT_ORIGIN_DETAIL);
    await openRoute(page, 'AKL > CHCH Pre 10am Medical');

    // The first leg is expanded on mount (ChainBuilder useState(0)), so the
    // collection editor is already open. Clicking the card here would COLLAPSE
    // it and make every absence assertion below pass vacuously.
    await expect(page.getByText('Collection speed')).toBeVisible();

    // Both controls are gone (origin spec 2.2, acceptance 4). "Pickup source"
    // was the dropdown; "Pickup depot" was the picker that duplicated the
    // Depot card sitting directly below it.
    await expect(page.getByText('Pickup source')).toHaveCount(0);
    await expect(page.getByText('Pickup depot')).toHaveCount(0);
    // The value the dropdown used to carry is gone with it.
    await expect(page.getByRole('option', { name: 'Booking-declared' })).toHaveCount(0);
  });

  test('mirrors the Delivery card: speed, zone group, zones', async ({ page }) => {
    await stubSchedules(page, DEPOT_ORIGIN_DETAIL);
    await openRoute(page, 'AKL > CHCH Pre 10am Medical');

    // Origin spec 3.2 / acceptance 8. The old Schedules page exposed only the
    // pickup zone group; Schedules NEW exposed neither until now.
    await expect(page.getByText('Collection speed')).toBeVisible();
    await expect(page.getByText('Collection zone group')).toBeVisible();
    await expect(page.getByText('Zones this leg collects from')).toBeVisible();

    // The stored pickup zone (3) round-trips into the zone checkboxes.
    const zone3 = page.locator('label').filter({ hasText: /^3$/ }).locator('input[type=checkbox]');
    await expect(zone3.first()).toBeChecked();
  });

  test('destination is read from the Depot leg, not the delivery region', async ({ page }) => {
    await stubSchedules(page, DEPOT_ORIGIN_DETAIL);
    await openRoute(page, 'AKL > CHCH Pre 10am Medical');

    // The regression case from origin spec 2.2: collection depot Auckland,
    // delivery region Christchurch. The summary has to name Auckland - if it
    // ever reads Christchurch the derivation has picked the wrong leg and
    // every existing LHP + DEL schedule would be re-pointed on save.
    await expect(page.getByText(/Collect from client address -> Auckland/)).toBeVisible();
  });
});

test.describe('Schedule origin: the Depot card', () => {
  test('a delivery-only schedule has no Collection leg at all (F6)', async ({ page }) => {
    await stubSchedules(page, DELIVERY_ONLY_DETAIL, { ...LIST_ROW, scheduleId: 7, name: '3 Hour Express 15:00-18:00' });
    await openRoute(page, '3 Hour Express 15:00-18:00');

    // seedLegsFromDto used to push a Collection leg unconditionally, so this
    // schedule rendered "Collect from Auckland" while collecting nothing.
    await expect(page.locator('span').filter({ hasText: /^COLLECTION$/ })).toHaveCount(0);
  });

  test('offers "Client address" and reveals the Origin region picker', async ({ page }) => {
    await stubSchedules(page, DEPOT_ORIGIN_DETAIL);
    await openRoute(page, 'AKL > CHCH Pre 10am Medical');

    await page.locator('span').filter({ hasText: /^DEPOT$/ }).first().click();
    const depotSelect = page.locator('select').filter({ has: page.getByRole('option', { name: 'Client address' }) }).first();
    await expect(depotSelect).toBeVisible();

    // No origin region until the origin IS the client; a real depot is its
    // own origin. Scoped to the label: the string also appears in the leg
    // summary and in the help paragraph once the picker is showing.
    const originRegionLabel = page.locator('label').filter({ hasText: 'Origin region' });
    await expect(originRegionLabel).toHaveCount(0);
    await depotSelect.selectOption({ label: 'Client address' });
    await expect(originRegionLabel).toBeVisible();

    // It must not be labelled or wired as the delivery region: Region keeps
    // coming from the Delivery leg (Steve's correction of 7 Oct).
    await expect(page.getByText('Dispatch region')).toHaveCount(0);
    // And the summary says so too, without the duplicated word the first
    // browser pass turned up ("Origin region region not set").
    await expect(page.getByText('Origin region not set')).toBeVisible();
  });

  test('disables "Add Collection" once the origin is the client address', async ({ page }) => {
    await stubSchedules(page, DELIVERY_ONLY_DETAIL, { ...LIST_ROW, scheduleId: 7, name: '3 Hour Express 15:00-18:00' });
    await openRoute(page, '3 Hour Express 15:00-18:00');

    // This schedule has no Collection leg, so the Depot leg is index 0 and
    // ChainBuilder has it expanded on mount. Clicking it would collapse it.
    const depotSelect = page.locator('select:has(option[value="client"])').first();
    await depotSelect.selectOption({ label: 'Client address' });

    // Collecting from the client INTO the depot is meaningless when the depot
    // is the client (origin spec 2.1).
    await expect(page.getByRole('button', { name: /COLLECTION/ })).toBeDisabled();
  });

  test('a stored client-origin schedule round-trips into the editor', async ({ page }) => {
    await stubSchedules(page, CLIENT_ORIGIN_DETAIL, { ...LIST_ROW, scheduleId: 13342, name: 'PB TECH TEST (AIRPORT)' });
    await openRoute(page, 'PB TECH TEST (AIRPORT)');

    // Seeded from the STORED OriginType, never from the section 5.2
    // derivation: deriving it here would let an unflagged schedule be saved
    // back as client origin.
    await expect(page.getByText('From client address')).toBeVisible();
    await expect(page.getByText(/Origin region Auckland/)).toBeVisible();
    await expect(page.locator('span').filter({ hasText: /^COLLECTION$/ })).toHaveCount(0);
  });
});

test.describe('Custom polygons: one Coverage lookup on the route modal', () => {
  // Full DTO shape, copied from the known-good fixture in
  // schedules-new.spec.ts. A partial route renders nothing at all, and the
  // empty list then looks like a stub that never fired.
  const ROUTE = {
    routeId: 1,
    name: 'Waikato Outer',
    area: 'Waikato',
    defaultTargetType: 1,
    defaultTargetId: 200,
    defaultTargetName: 'V. Patel',
    scheduleId: null,
    scheduleName: null,
    scheduleWindow: null,
    schedules: [],
    active: true,
    zipcodes: [],
    bulkPolygons: [],
    rosterEntryCount: 0,
    bookingCount: 0,
    mappedStopsCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: null,
  };

  test('finds postcodes and polygons in one box, and chips the polygon', async ({ page }) => {
    // Catch-all FIRST: page.route matches handlers in reverse registration
    // order, so everything registered after this one overrides it. It exists
    // so an unstubbed call cannot reach the vite proxy, get ECONNREFUSED and
    // leave the modal half-mounted, which reads like a bad selector rather
    // than a missing stub.
    await page.route('**/api/**', (r: Route) => json(r, { response: [] }));
    await page.route('**/api/recurring-routes', (r: Route) => json(r, { response: [ROUTE] }));
    await page.route('**/api/recurring-routes/1', (r: Route) => json(r, { response: ROUTE }));
    await page.route('**/api/recurring-routes/assignable-targets', (r: Route) =>
      json(r, { response: { couriers: [], agents: [], networkPartners: [] } }));
    await page.route('**/api/recurring-routes/schedules/lookup**', (r: Route) => json(r, { response: [] }));
    await page.route('**/api/recurring-routes/zipcodes/centroids', (r: Route) => json(r, { response: [] }));
    await page.route('**/api/recurring-routes/pickup-address-suggestions', (r: Route) => json(r, { response: [] }));
    // The new combined lookup (polygons spec part 1). Postcodes first, then
    // polygons, which is the order the grouped list renders.
    // The chip resolves its label from the fetched shape; without this the
    // catch-all answers and the chip falls back to "Polygon #77", which would
    // make the assertion below pass or fail for the wrong reason.
    await page.route('**/api/bulk-polygons/77', (r: Route) =>
      json(r, {
        response: {
          polygonId: 77,
          name: 'Test Regional Cambridge - Tirau',
          colorHex: '#ff8800',
          sourceType: 0,
          sourceCode: null,
          centroidLatitude: -37.9,
          centroidLongitude: 175.5,
          active: true,
          points: [],
          attachedRouteCount: 0,
          attachedRoutes: [],
          zoneMemberships: [],
          partiallyIncludedZips: null,
          createdUtc: '2026-01-01T00:00:00Z',
          createdBy: 'test',
          lastModifiedUtc: null,
          updatedBy: null,
          attachedScheduleNames: [],
        },
      }));
    await page.route('**/api/recurring-routes/coverage/lookup**', (r: Route) =>
      json(r, {
        response: [
          { kind: 'postcode', id: 11, label: '3434', colorHex: null, latitude: -37.9, longitude: 175.5 },
          { kind: 'polygon', id: 77, label: 'Test Regional Cambridge - Tirau', colorHex: '#ff8800', latitude: -37.9, longitude: 175.5 },
        ],
      }));

    await page.goto('/recurring-routes');

    // Open via the row rather than the ?edit= deep link: the deep link races
    // the list fetch, and a half-open modal looks exactly like a bad selector.
    await expect(page.getByText('Waikato Outer')).toBeVisible();
    await page.getByText('Waikato Outer').first().click();

    // One box now, labelled Coverage: the modal used to have a postcode
    // typeahead AND a separate read-only polygon list for the same idea.
    const box = page.getByPlaceholder(/polygon name/i);
    await box.fill('test');

    // Grouped results, with the polygon under its own heading.
    await expect(page.getByText('Polygons')).toBeVisible();
    const polygonResult = page.getByRole('button', { name: /Test Regional Cambridge - Tirau/ });
    await expect(polygonResult).toBeVisible();

    await polygonResult.click();

    // It becomes a chip in the same row as the postcode chips, and the count
    // in the field label counts both kinds.
    await expect(page.getByTitle(/Zoom map to "Test Regional Cambridge - Tirau"/)).toBeVisible();
    await expect(page.getByText(/Coverage \(1\)/)).toBeVisible();
  });
});
