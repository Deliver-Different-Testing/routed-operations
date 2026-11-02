import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * E2E for the three surfaces added to Schedules NEW on 2026-11-02:
 * the Pricing tab (spec 3.3), the Linehaul tab (spec 12.2), the per-client
 * depot limits on the Depots sub-view, and the zone-group map panel (11.8).
 *
 * Every /api/* call is stubbed, so no database is needed. What these cover is
 * the half the service tests cannot see: whether the SCREEN says the right
 * thing. Three of them earn their place outright, because each pins a
 * statement that is wrong in a way nobody would notice:
 *
 *   * A client's inherited price renders grey and their own renders bold with
 *     a dot. Swap those and the screen reads as the opposite of the truth,
 *     and the figures are identical either way.
 *   * The Dimensions sub-view has to say that a client with its own bands
 *     uses ONLY those. It is the opposite of the rule one pill to its left,
 *     and both views show a list of numbers.
 *   * The map names the postcodes it could not draw. A map quietly missing
 *     two of ten zones looks like a map.
 */

// ─── FIXTURES ──────────────────────────────────────────────────────────────

const GROUPS = [
  { id: 62, name: 'Auckland AH Zones', depotId: 8, depotName: 'Auckland', clientId: null },
  { id: 71, name: 'BOP Regional', depotId: 4, depotName: 'Hamilton', clientId: null },
];

const SPEEDS = [
  { speedId: 112, name: 'Overnight' },
  { speedId: 120, name: 'Same day' },
];

/** Default sheet: every cell priced, courier 60% down both columns. */
const DEFAULT_GRID = {
  postcodeGroupId: 62,
  postcodeGroupName: 'Auckland AH Zones',
  depotId: 8,
  depotName: 'Auckland',
  clientId: null,
  clientLabel: 'Default',
  zones: [1, 2],
  speeds: SPEEDS,
  cells: [
    { zone: 1, speedId: 112, rateId: 1, amount: 12.5, courierPercentage: 60, inherited: false, defaultAmount: null },
    { zone: 1, speedId: 120, rateId: 2, amount: 25, courierPercentage: 60, inherited: false, defaultAmount: null },
    { zone: 2, speedId: 112, rateId: 3, amount: 14, courierPercentage: 60, inherited: false, defaultAmount: null },
    { zone: 2, speedId: 120, rateId: 4, amount: 27, courierPercentage: 60, inherited: false, defaultAmount: null },
  ],
  overriddenCellCount: 0,
  resolvedByDepot: true,
};

/** Woop overrides exactly one cell; the other three are inherited. */
const CLIENT_GRID = {
  ...DEFAULT_GRID,
  clientId: 16867,
  clientLabel: 'WOOP Woop Ltd',
  cells: [
    { zone: 1, speedId: 112, rateId: 9, amount: 9.95, courierPercentage: 60, inherited: false, defaultAmount: 12.5 },
    { zone: 1, speedId: 120, rateId: 2, amount: 25, courierPercentage: 60, inherited: true, defaultAmount: 25 },
    { zone: 2, speedId: 112, rateId: 3, amount: 14, courierPercentage: 60, inherited: true, defaultAmount: 14 },
    { zone: 2, speedId: 120, rateId: 4, amount: 27, courierPercentage: 60, inherited: true, defaultAmount: 27 },
  ],
  overriddenCellCount: 1,
  resolvedByDepot: true,
};

const RUNS = [
  {
    runId: 1, runName: 'AKL to HAM 5am - 285',
    fromDepotId: 8, fromDepotName: 'Auckland',
    toDepotId: 4, toDepotName: 'Hamilton',
    startTime: '05:00', despatchTime: '07:30',
    anySpeed: { speedId: null, speedName: 'Any speed', rateId: 10, amount: 18, amountPercentage: null },
    speedCells: [],
    scheduleRateCount: 223,
    scheduleMinAmount: 0,
    scheduleMaxAmount: 41.2,
    usedBySchedules: ['1 hr. 5am run Auckland > Hamilton', 'BOP Regional Home Delivery 11am'],
  },
  {
    runId: 2, runName: 'AKL to TNG 6am - 286',
    fromDepotId: 8, fromDepotName: 'Auckland',
    toDepotId: 3, toDepotName: 'Tauranga',
    startTime: '06:00', despatchTime: null,
    anySpeed: { speedId: null, speedName: 'Any speed', rateId: null, amount: null, amountPercentage: null },
    speedCells: [],
    scheduleRateCount: 0,
    scheduleMinAmount: null,
    scheduleMaxAmount: null,
    usedBySchedules: [],
  },
];

const SCHEDULE_RATES = [
  {
    rateId: 101, scheduleId: 694, scheduleName: 'BOP Regional Home Delivery 11am',
    speedId: null, speedName: 'Any speed', clientId: null, clientCode: null,
    amount: 37.7044, amountPercentage: null, active: true,
  },
  {
    rateId: 102, scheduleId: 697, scheduleName: 'BOP Regional Home Delivery 5am',
    speedId: null, speedName: 'Any speed', clientId: null, clientCode: null,
    amount: 17.0201, amountPercentage: null, active: true,
  },
];

const DEPOT_LIMITS = [
  { id: 8, name: 'Auckland', active: true, offForClient: false },
  { id: 4, name: 'Hamilton', active: true, offForClient: true },
  { id: 3, name: 'Tauranga', active: false, offForClient: false },
];

/** Two of the group's four codes have a boundary; the other two do not. */
const ZONE_MAP = {
  postcodeGroupId: 62,
  postcodeGroupName: 'Auckland AH Zones',
  depotId: 8,
  depotName: 'Auckland',
  depotLatitude: -36.8485,
  depotLongitude: 174.7633,
  shapes: [
    {
      zone: 2, code: '2112', zipPolygonId: 1, latitude: -37.047, longitude: 174.947,
      wkt: 'POLYGON((174.92 -37.02, 174.98 -37.02, 174.98 -37.08, 174.92 -37.08, 174.92 -37.02))',
    },
    {
      zone: 2, code: '2104', zipPolygonId: 2, latitude: -37.002, longitude: 174.879,
      wkt: 'POLYGON((174.85 -36.98, 174.91 -36.98, 174.91 -37.04, 174.85 -37.04, 174.85 -36.98))',
    },
  ],
  codesWithNoShape: ['0600', '0602'],
};

const GROUP_ROW = {
  id: 62, name: 'Auckland AH Zones', depotId: 8, depotName: 'Auckland',
  clientId: null, clientCode: null, postcodeCount: 4, zoneCount: 1,
  polygonCount: 0, deliveryScheduleCount: 0, pickupScheduleCount: 0,
};

const json = (route: Route, response: unknown) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ response }),
  });

/** Calls the page makes that these specs do not assert on. */
async function stubCommon(page: Page) {
  await page.route('**/api/v2/schedules?**', (r) => json(r, { items: [], total: 0 }));
  await page.route('**/api/v2/schedule-bundles', (r) => json(r, []));
  await page.route('**/api/recurring-routes', (r) => json(r, []));
  await page.route('**/api/recurring-linehaul-runs', (r) => json(r, []));
  await page.route('**/api/schedules/lookups', (r) =>
    json(r, {
      depots: [], speeds: [], couriers: [], clients: [], dropOffLocations: [],
      postcodeGroups: [], linehaulRuns: [], zoneNumbers: [], storageStates: [],
      deliveryStates: [], pickupBoxDiscounts: [],
    }));
  await page.route('**/api/schedules/clients*', (route: Route) => {
    const q = (new URL(route.request().url()).searchParams.get('q') ?? '').toLowerCase();
    const clients = [
      { id: 16867, name: 'WOOP Woop Ltd' },
      { id: 9673, name: 'ASURE Asure Quality' },
    ];
    return json(route, q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients);
  });
}

// ─── PRICING ───────────────────────────────────────────────────────────────

test.describe('Pricing tab', () => {
  async function stubPricing(page: Page, grid: unknown = DEFAULT_GRID) {
    await stubCommon(page);
    await page.route('**/api/pricing/bootstrap', (r) =>
      json(r, { groups: GROUPS, speeds: SPEEDS, sheets: [], rateSets: [] }));
    await page.route('**/api/pricing/zone-rates?**', (route: Route) => {
      const clientId = new URL(route.request().url()).searchParams.get('clientId');
      return json(route, clientId ? CLIENT_GRID : grid);
    });
    await page.route('**/api/pricing/package-rates**', (r) =>
      json(r, {
        clientId: null, clientLabel: 'Default', usingOwnRows: false,
        rows: [{
          id: 1, setId: null, setName: null, clientId: null, name: 'Standard',
          fromCubic: 0, toCubic: 1, fromWeight: 0, toWeight: 25, cubicRate: 1.5,
        }],
      }));
    await page.route('**/api/pricing/surcharges**', (r) => json(r, []));
    await page.route('**/api/pricing/speeds**', (r) =>
      json(r, SPEEDS.map((s) => ({
        speedId: s.speedId, name: s.name,
        offeredGlobally: true, offeredForClient: false, clientRowId: null,
      }))));
  }

  test('zone rates render as zones down and speeds across, with a courier footer', async ({ page }) => {
    await stubPricing(page);
    await page.goto('/schedules-new?tab=pricing');

    const grid = page.getByTestId('pricing-grid');
    await expect(grid).toBeVisible();
    await expect(grid.getByRole('columnheader', { name: 'Overnight' })).toBeVisible();
    await expect(grid.getByRole('columnheader', { name: 'Same day' })).toBeVisible();
    await expect(page.getByTestId('rate-1-112')).toHaveValue('12.50');
    await expect(page.getByTestId('rate-2-120')).toHaveValue('27.00');
    // One courier figure per column, because it is the same down the column.
    await expect(grid.getByText('60%').first()).toBeVisible();
  });

  test('a price still stored against the depot says so, naming the depot', async ({ page }) => {
    // Without this line the grid implies the rates already hang off the zone
    // group, which is the thing Phase 2 has not done yet.
    await stubPricing(page);
    await page.goto('/schedules-new?tab=pricing');
    await expect(page.getByText(/still stored against the Auckland depot/i)).toBeVisible();
  });

  test('an inherited client price is grey and their own is bold with a dot', async ({ page }) => {
    // The figures look the same either way round, so the only thing telling
    // an operator whose price they are editing is this styling.
    await stubPricing(page);
    await page.goto('/schedules-new?tab=pricing');

    await page.getByTestId('pricing-client-search').fill('WOOP');
    await page.getByTestId('pricing-client').selectOption({ label: 'WOOP Woop Ltd' });

    await expect(page.getByTestId('pricing-override-chip'))
      .toHaveText(/Differs from default: 1 cell$/);

    const own = page.getByTestId('rate-1-112');
    await expect(own).toHaveValue('9.95');
    await expect(own).toHaveClass(/font-medium/);
    await expect(page.locator('span[title="This client\'s own price"]')).toHaveCount(1);

    const inherited = page.getByTestId('rate-2-112');
    await expect(inherited).toHaveValue('14.00');
    await expect(inherited).toHaveClass(/text-text-muted/);
  });

  test('editing a cell sends the group, zone, speed and client', async ({ page }) => {
    await stubPricing(page);
    let body: Record<string, unknown> | null = null;
    await page.route('**/api/pricing/zone-rates', (route: Route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      body = route.request().postDataJSON();
      return json(route, {
        zone: 1, speedId: 112, rateId: 1, amount: 13,
        courierPercentage: 60, inherited: false, defaultAmount: null,
      });
    });

    await page.goto('/schedules-new?tab=pricing');
    const cell = page.getByTestId('rate-1-112');
    await cell.fill('13.00');
    await cell.blur();

    await expect.poll(() => body).not.toBeNull();
    expect(body).toMatchObject({ postcodeGroupId: 62, zone: 1, speedId: 112, amount: 13 });
  });

  test('a price that is not a number is refused before anything is sent', async ({ page }) => {
    await stubPricing(page);
    let sent = false;
    await page.route('**/api/pricing/zone-rates', (route: Route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      sent = true;
      return json(route, {});
    });

    await page.goto('/schedules-new?tab=pricing');
    const cell = page.getByTestId('rate-1-112');
    await cell.fill('abc');
    await cell.blur();

    await expect(page.getByText(/"abc" is not a number/)).toBeVisible();
    expect(sent).toBe(false);
  });

  test('Dimensions states the rule, which is the opposite of the zone rates rule', async ({ page }) => {
    await stubPricing(page);
    await page.goto('/schedules-new?tab=pricing');
    await page.getByTestId('pricing-view-dimensions').click();

    await expect(page.getByTestId('dimensions-rule'))
      .toHaveText(/Every client without bands of its own uses these/);
  });

  test('Dimensions says when a client is on its own bands only', async ({ page }) => {
    await stubPricing(page);
    await page.route('**/api/pricing/package-rates**', (r) =>
      json(r, {
        clientId: 16867, clientLabel: 'WOOP Woop Ltd', usingOwnRows: true,
        rows: [{
          id: 3, setId: null, setName: null, clientId: 16867, name: 'Theirs',
          fromCubic: null, toCubic: null, fromWeight: 0, toWeight: 10, cubicRate: 1,
        }],
      }));

    await page.goto('/schedules-new?tab=pricing');
    await page.getByTestId('pricing-client-search').fill('WOOP');
    await page.getByTestId('pricing-client').selectOption({ label: 'WOOP Woop Ltd' });
    await page.getByTestId('pricing-view-dimensions').click();

    await expect(page.getByTestId('dimensions-rule'))
      .toHaveText(/uses only these.*do not apply to them at all/);
  });
});

// ─── LINEHAUL ──────────────────────────────────────────────────────────────

test.describe('Linehaul tab', () => {
  async function stubLinehaul(page: Page) {
    await stubCommon(page);
    await page.route('**/api/linehaul-rates/bootstrap', (r) =>
      json(r, {
        fromDepots: [{ depotId: 8, name: 'Auckland' }],
        toDepots: [{ depotId: 4, name: 'Hamilton' }, { depotId: 3, name: 'Tauranga' }],
        speeds: SPEEDS,
      }));
    await page.route('**/api/linehaul-rates/runs/*/schedules**', (r) => json(r, SCHEDULE_RATES));
    await page.route('**/api/linehaul-rates?**', (route: Route) => {
      const to = new URL(route.request().url()).searchParams.get('toDepotId');
      return json(route, to ? RUNS.filter((x) => String(x.toDepotId) === to) : RUNS);
    });
    await page.route('**/api/linehaul-rates', (route: Route) =>
      route.request().method() === 'GET' ? json(route, RUNS) : route.fallback());
  }

  test('runs list with their depots and the run-level price is editable', async ({ page }) => {
    await stubLinehaul(page);
    await page.goto('/schedules-new?tab=linehaul');

    await expect(page.getByText('AKL to HAM 5am - 285')).toBeVisible();
    await expect(page.getByTestId('lh-cell-1-any')).toHaveValue('18.00');
    await expect(page.getByTestId('lh-cell-2-any')).toHaveValue('');
  });

  test('the row reports how many schedules price the run, and the spread', async ({ page }) => {
    // The whole reason the tab is not the flat grid the mock drew: one run
    // carries hundreds of schedule prices and the row has to admit it.
    await stubLinehaul(page);
    await page.goto('/schedules-new?tab=linehaul');

    await expect(page.getByText('223')).toBeVisible();
    await expect(page.getByText('(0.00 to 41.20)')).toBeVisible();
    await expect(page.getByText('none').first()).toBeVisible();
  });

  test('expanding a run lists the schedules that price it', async ({ page }) => {
    await stubLinehaul(page);
    await page.goto('/schedules-new?tab=linehaul');

    await page.getByTestId('lh-run-toggle-1').click();
    const table = page.getByTestId('lh-schedules-1');
    await expect(table).toBeVisible();
    await expect(table.getByText('BOP Regional Home Delivery 11am')).toBeVisible();
    await expect(page.getByTestId('lh-schedule-cell-101')).toHaveValue('37.70');
    await expect(page.getByTestId('lh-schedule-cell-102')).toHaveValue('17.02');
  });

  test('the to-depot filter narrows the runs', async ({ page }) => {
    await stubLinehaul(page);
    await page.goto('/schedules-new?tab=linehaul');

    await page.getByTestId('lh-to-depot').selectOption({ label: 'Tauranga' });
    await expect(page.getByText('AKL to TNG 6am - 286')).toBeVisible();
    await expect(page.getByText('AKL to HAM 5am - 285')).toHaveCount(0);
  });

  test('editing a run price sends the run with no schedule and no speed', async ({ page }) => {
    // A run-level price must not be written against a schedule, or it stops
    // applying to every other schedule on that run.
    await stubLinehaul(page);
    let body: Record<string, unknown> | null = null;
    await page.route('**/api/linehaul-rates', (route: Route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      body = route.request().postDataJSON();
      return json(route, { speedId: null, speedName: 'Any speed', rateId: 10, amount: 19.75, amountPercentage: null });
    });

    await page.goto('/schedules-new?tab=linehaul');
    const cell = page.getByTestId('lh-cell-1-any');
    await cell.fill('19.75');
    await cell.blur();

    await expect.poll(() => body).not.toBeNull();
    expect(body).toMatchObject({ linehaulRunId: 1, scheduleId: null, speedId: null, amount: 19.75 });
  });
});

// ─── DEPOT LIMITS ──────────────────────────────────────────────────────────

test.describe('Per-client depot limits', () => {
  async function stubDepots(page: Page) {
    await stubCommon(page);
    await page.route('**/api/territory/bootstrap', (r) =>
      json(r, {
        countryCode: 'NZ',
        depots: DEPOT_LIMITS.map((d) => ({ id: d.id, name: d.name, active: d.active })),
        postcodeGroups: [], nzPostcodes: [], usZipZones: [], zoneNames: [], zoneGroups: [],
      }));
    await page.route('**/api/territory/depots', (r) =>
      json(r, DEPOT_LIMITS.map((d) => ({ id: d.id, name: d.name, active: d.active }))));
    await page.route('**/api/territory/depots/client-limits**', (r) => json(r, DEPOT_LIMITS));
    await page.route('**/api/territory/postcode-groups?**', (r) => json(r, []));
  }

  test('picking a client switches the table into the limit editor', async ({ page }) => {
    await stubDepots(page);
    await page.goto('/schedules-new?tab=zonegroups');
    await page.getByRole('button', { name: 'Depots', exact: true }).click();

    await page.getByTestId('depot-client-picker-search').fill('WOOP');
    await page.getByTestId('depot-client-picker').selectOption({ label: 'WOOP Woop Ltd' });

    await expect(page.getByRole('columnheader', { name: /For WOOP Woop Ltd/ })).toBeVisible();
    await expect(page.getByTestId('depot-client-toggle-8')).toBeChecked();
    await expect(page.getByTestId('depot-client-toggle-4')).not.toBeChecked();
  });

  test('a depot that is off everywhere cannot be turned on for one client', async ({ page }) => {
    // Two different switches, and the row has to say which one is holding it
    // off or an operator ticks a box that cannot help.
    await stubDepots(page);
    await page.goto('/schedules-new?tab=zonegroups');
    await page.getByRole('button', { name: 'Depots', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Show inactive' }).check();

    await page.getByTestId('depot-client-picker-search').fill('WOOP');
    await page.getByTestId('depot-client-picker').selectOption({ label: 'WOOP Woop Ltd' });

    const inactive = page.getByTestId('depot-client-toggle-3');
    await expect(inactive).toBeDisabled();
    await expect(page.getByText('Off everywhere', { exact: true })).toBeVisible();
  });

  test('unticking a depot posts off for that client', async ({ page }) => {
    await stubDepots(page);
    let body: Record<string, unknown> | null = null;
    await page.route('**/api/territory/depots/*/client-limit', (route: Route) => {
      body = route.request().postDataJSON();
      return json(route, { id: 8, name: 'Auckland', active: true, offForClient: true });
    });

    await page.goto('/schedules-new?tab=zonegroups');
    await page.getByRole('button', { name: 'Depots', exact: true }).click();
    await page.getByTestId('depot-client-picker-search').fill('WOOP');
    await page.getByTestId('depot-client-picker').selectOption({ label: 'WOOP Woop Ltd' });
    // click(), not uncheck(): the box is controlled and only flips once the
    // POST resolves, so uncheck() reports the state as unchanged.
    await page.getByTestId('depot-client-toggle-8').click();

    await expect.poll(() => body).not.toBeNull();
    expect(body).toMatchObject({ clientId: 16867, off: true });
  });

  test('the client picker searches, because the server caps the list', async ({ page }) => {
    // A plain dropdown cannot reach a client past the server's 200-row cap,
    // and nothing on screen would say why it is missing.
    await stubDepots(page);
    await page.goto('/schedules-new?tab=zonegroups');
    await page.getByRole('button', { name: 'Depots', exact: true }).click();

    const search = page.getByTestId('depot-client-picker-search');
    await expect(search).toBeVisible();
    await search.fill('ASURE');
    await expect(page.getByTestId('depot-client-picker'))
      .toContainText('ASURE Asure Quality');
  });
});

// ─── ZONE GROUP MAP ────────────────────────────────────────────────────────

test.describe('Zone group map panel', () => {
  test('names the postcodes it could not draw instead of dropping them', async ({ page }) => {
    // A map silently missing two of a group's zones still looks like a map.
    await stubCommon(page);
    // The tab lists groups out of the bootstrap payload, not out of
    // /api/territory/postcode-groups, so the fixture has to live here.
    await page.route('**/api/territory/bootstrap', (r) =>
      json(r, {
        countryCode: 'NZ',
        depots: [{ id: 8, name: 'Auckland', active: true }],
        postcodeGroups: [GROUP_ROW],
        nzPostcodes: [], usZipZones: [], zoneNames: [], zoneGroups: [],
      }));
    await page.route('**/api/territory/postcode-groups/62/detail', (r) =>
      json(r, {
        group: GROUP_ROW,
        zones: [{
          zone: 2, label: 'Clover Park', memberCount: 4,
          members: [{ id: 1, code: '2112', value: 2112, suburb: 'Takanini' }],
        }],
        schedules: [],
        polygons: [],
      }));
    await page.route('**/api/territory/postcode-groups/62/map', (r) => json(r, ZONE_MAP));

    await page.goto('/schedules-new?tab=zonegroups');
    await page.getByText('Auckland AH Zones').first().click();

    await expect(page.getByTestId('zone-map-panel')).toBeVisible();
    await expect(page.getByTestId('zone-map-missing'))
      .toHaveText(/2 postcodes not drawn, with no boundary on file: 0600, 0602/);
    // The legend is the key to the shading, so a zone that is drawn is named.
    await expect(page.getByTestId('zone-map-legend-2')).toContainText('Zone 2');
  });

  test('a group whose postcodes have no boundaries says so rather than showing a blank map', async ({ page }) => {
    await stubCommon(page);
    await page.route('**/api/territory/bootstrap', (r) =>
      json(r, {
        countryCode: 'NZ',
        depots: [{ id: 8, name: 'Auckland', active: true }],
        postcodeGroups: [{ ...GROUP_ROW, postcodeCount: 2 }],
        nzPostcodes: [], usZipZones: [], zoneNames: [], zoneGroups: [],
      }));
    await page.route('**/api/territory/postcode-groups/62/detail', (r) =>
      json(r, {
        group: { ...GROUP_ROW, postcodeCount: 2 },
        zones: [{ zone: 2, label: 'Clover Park', memberCount: 2, members: [] }],
        schedules: [],
        polygons: [],
      }));
    await page.route('**/api/territory/postcode-groups/62/map', (r) =>
      json(r, { ...ZONE_MAP, shapes: [], codesWithNoShape: ['0600', '0602'] }));

    await page.goto('/schedules-new?tab=zonegroups');
    await page.getByText('Auckland AH Zones').first().click();

    await expect(page.getByTestId('zone-map-empty'))
      .toHaveText(/None of this group's postcodes has a boundary on file/);
  });
});
