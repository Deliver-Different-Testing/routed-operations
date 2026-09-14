import { test, expect, type Route } from '@playwright/test';

// E2E for the Schedules NEW page (Steve's 2026-09-08
// KEVIN-NEW-SCHEDULES-VIEW-MULTI-CLIENT brief). All API calls are
// mocked so no DB is required. The spec verifies:
//   1. Sidebar carries the "Schedules NEW" entry (badge visible),
//      navigates to /schedules-new.
//   2. Page mounts the 3 tabs: Schedules / Schedule Groups /
//      Recurring Routes.
//   3. Schedules tab renders the id-keyed table with day pills +
//      client chips, filter pills, search box, view-as-client picker.
//   4. Override rows nest under their base with the amber "O" badge.
//   5. Row-click opens the read-only edit modal with the 4 tabs +
//      disabled Save button.
//   6. Recurring Routes tab shows the route list + type filter.
//   7. Schedule Groups tab renders (or its empty-state).

const V2_SCHEDULES = [
  {
    scheduleId: 1042,
    name: 'AKL > CHCH Pre 8am Medical',
    legacyClientId: null,
    legacyClientCode: null,
    regionId: 3,
    regionName: 'Christchurch',
    speedId: 1,
    speedName: 'Medical',
    activeDays: [1, 2, 3, 4, 5],
    activeZonesCount: 4,
    clientCount: 9,
    postcodeCount: 0,
    polygonCount: 0,
    autoBook: true,
    hasActiveLinehaul: true,
    linkedClientCodes: ['MLC', 'PATH', 'NPG'],
    baseScheduleId: null,
  },
  {
    // Override of #1042. Amber "O" badge nests under its base.
    scheduleId: 1051,
    name: 'AKL > CHCH Pre 8am Medical',
    legacyClientId: null,
    legacyClientCode: null,
    regionId: 3,
    regionName: 'Christchurch',
    speedId: 1,
    speedName: 'Medical',
    activeDays: [1, 2, 3, 4, 5],
    activeZonesCount: 4,
    clientCount: 1,
    postcodeCount: 0,
    polygonCount: 0,
    autoBook: false,
    hasActiveLinehaul: true,
    linkedClientCodes: ['HRAD'],
    baseScheduleId: 1042,
  },
  {
    scheduleId: 7,
    name: 'Auckland Afternoons',
    legacyClientId: null,
    legacyClientCode: null,
    regionId: 1,
    regionName: 'Auckland',
    speedId: 2,
    speedName: 'Standard',
    activeDays: [1, 2, 3, 4, 5],
    activeZonesCount: 0,
    clientCount: 0,
    postcodeCount: 0,
    polygonCount: 0,
    autoBook: true,
    hasActiveLinehaul: false,
    linkedClientCodes: [],
    baseScheduleId: null,
  },
];

const V2_DETAIL = {
  scheduleId: 1042,
  name: 'AKL > CHCH Pre 8am Medical',
  legacyClientId: null,
  legacyClientCode: null,
  regionId: 3,
  regionName: 'Christchurch',
  pickupDepotId: 1,
  pickupDepotName: 'Auckland',
  speedId: 1,
  speedName: 'Medical',
  parentSpeedId: 1,
  parentSpeedName: 'Medical',
  postcodeGroupId: 33,
  postcodeGroupName: 'Christchurch metro',
  pickupPostcodeGroupId: null,
  pickupPostcodeGroupName: null,
  pickupRatingSpeed: 166,
  autoBook: true,
  bookPickup: true,
  applyPickupCutoff: true,
  pickupCutoff: 3,
  storageState: 1,
  deliveryState: 1,
  pickupBoxDiscount: null,
  dropOffLocationId: null,
  dropOffLocationName: null,
  description: 'Book by 2 pm. Next business day service to Christchurch.',
  dayWindows: [
    { id: 1, dayOfWeek: 1, startTime: '06:00', endTime: '08:00', cutoffHours: 66 },
    { id: 2, dayOfWeek: 2, startTime: '06:00', endTime: '08:00', cutoffHours: 18 },
    { id: 3, dayOfWeek: 3, startTime: '06:00', endTime: '08:00', cutoffHours: 18 },
    { id: 4, dayOfWeek: 4, startTime: '06:00', endTime: '08:00', cutoffHours: 18 },
    { id: 5, dayOfWeek: 5, startTime: '06:00', endTime: '08:00', cutoffHours: 18 },
  ],
  zones: [],
  linehauls: [
    {
      id: 1,
      name: 'AKL - CHCH Night Air',
      active: true,
      amount: 25,
      amountPercentage: 0,
      fromDepotId: 1,
      toDepotId: 3,
      minutes: 300,
      linehaulRunId: 12,
      insertToBulk: true,
      applyDiscount: false,
      applyAddOnPercentage: false,
      weekDay: [1, 2, 3, 4, 5],
      departureAdvanceDays: 0,
      fromClientAddress: false,
      dropOffLocationId: null,
    },
  ],
  clientIds: [100, 200, 300, 400, 500, 600, 700, 800, 900],
  clientCodes: ['MLC', 'PATH', 'NPG', 'AWA', 'KOW', 'SXP', 'OPT', 'BBS', 'AVD'],
  postcodeIds: [],
  polygonIds: [],
};

const V2_GROUPS = [
  {
    groupId: 1,
    name: 'AKL medical overnight bundle',
    description: 'What a new medical client gets on day one.',
    isActive: true,
    scheduleCount: 3,
    clientCount: 10,
    scheduleIds: [1042, 1050, 1060],
    scheduleNames: [
      'AKL > CHCH Pre 8am Medical',
      'AKL > CHCH Pre 10am Medical',
      'AKL > Gisborne pre 10am',
    ],
  },
];

const V2_ROUTES = [
  {
    routeId: 501,
    name: 'AKL Medical AM - North Shore',
    area: 'North Shore',
    defaultTargetType: 1,
    defaultTargetId: 200,
    defaultTargetName: 'V. Patel',
    scheduleId: 1042,
    scheduleName: 'AKL > CHCH Pre 8am Medical',
    scheduleWindow: '06:00 - 08:00',
    schedules: [{ scheduleId: 1042, name: 'AKL > CHCH Pre 8am Medical' }],
    active: true,
    zipcodes: [{ zipPolygonId: 1, code: '0620' }, { zipPolygonId: 2, code: '0630' }],
    bulkPolygons: [],
    rosterEntryCount: 3,
    bookingCount: 12,
    mappedStopsCount: 8,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: null,
  },
];

async function stubApis(page: import('@playwright/test').Page) {
  await page.route('**/api/v2/schedules?**', (route: Route) => {
    const url = new URL(route.request().url());
    const type = url.searchParams.get('type') ?? 'all';
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const clientId = url.searchParams.get('clientId');
    let rows = V2_SCHEDULES;
    if (type === 'default') rows = rows.filter((s) => s.baseScheduleId == null && s.clientCount === 0 && s.legacyClientId == null);
    if (type === 'shared') rows = rows.filter((s) => s.baseScheduleId == null && !(s.legacyClientId == null && s.clientCount === 0));
    if (type === 'override') rows = rows.filter((s) => s.baseScheduleId != null);
    if (q) rows = rows.filter((s) => s.name.toLowerCase().includes(q));
    if (clientId) rows = rows.filter((s) => s.linkedClientCodes.length > 0 || s.baseScheduleId == null);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ response: rows }),
    });
  });
  await page.route('**/api/v2/schedules/*', (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ response: V2_DETAIL }),
    });
  });
  await page.route('**/api/v2/schedule-groups', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ response: V2_GROUPS }),
    }),
  );
  await page.route('**/api/recurring-routes', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ response: V2_ROUTES }),
    }),
  );
  await page.route('**/api/schedules/clients*', (route: Route) => {
    const url = new URL(route.request().url());
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const clients = [
      { id: 100, name: 'MedLab Central (MLC)' },
      { id: 200, name: 'Pathway Diagnostics (PATH)' },
      { id: 300, name: 'Harbour Radiology (HRAD)' },
    ];
    const hits = q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ response: hits }),
    });
  });
}

test.describe('Schedules NEW - Steve 2026-09-08 brief', () => {
  test('sidebar has NEW-badged Schedules entry that opens the page', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules-new');

    // Sidebar renders both the legacy Schedules entry and the new one.
    await expect(page.getByRole('link', { name: /^Schedules$/ }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Schedules NEW' })).toBeVisible();

    // Page header + 3 tabs. Tab buttons now carry a count pill so their
    // accessible name is like "Schedules 14" - use a startsWith regex.
    await expect(page.getByRole('heading', { name: 'Schedules', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Schedules\b/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Schedule Groups\b/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Recurring Routes\b/ })).toBeVisible();
  });

  test('Schedules tab renders table with day pills + client chips + nested overrides', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules-new');

    // Base row + override row visible.
    await expect(page.getByText('AKL > CHCH Pre 8am Medical').first()).toBeVisible();
    await expect(page.getByText('#1042').first()).toBeVisible();
    // Override "O" badge + Based-on line.
    await expect(page.getByTitle('Client override')).toBeVisible();
    await expect(page.getByText('Based on #1042')).toBeVisible();
    // Client chip strip on the base.
    await expect(page.getByText('MLC').first()).toBeVisible();
    // Default schedule (no clients) surfaces the All-clients pill.
    await expect(page.getByText('All clients').first()).toBeVisible();
  });

  test('type filter narrows to overrides', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules-new');

    await page.getByRole('button', { name: 'Overrides' }).click();
    // Only the override row survives - based-on line still shows the
    // base id. Rely on the base id NOT appearing as an own-row #id.
    await expect(page.getByText('Based on #1042')).toBeVisible();
    // Data table rows count: exactly one (the override).
    await expect(page.locator('table tbody tr')).toHaveCount(1);
  });

  test('row-click opens the read-only edit modal with 4 tabs + disabled Save', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules-new');

    // Click the base row.
    await page.getByText('AKL > CHCH Pre 8am Medical').first().click();

    // Modal header + 4 tabs.
    await expect(page.getByRole('heading', { level: 3, name: /AKL > CHCH Pre 8am Medical/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clients', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Route', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Operating days', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Roster', exact: true })).toBeVisible();

    // Attached clients tab is default; shows 9 linked chip count.
    await expect(page.getByText('9 linked')).toBeVisible();

    // Save button is disabled for Phase 1.
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeDisabled();

    // Route tab shows the vertical leg stack. Exact-match on the leg
    // tag copy to disambiguate from "Delivery state" in the production-
    // fields section below.
    await page.getByRole('button', { name: 'Route', exact: true }).click();
    await expect(page.getByText('COLLECTION', { exact: true })).toBeVisible();
    await expect(page.getByText('DELIVERY', { exact: true })).toBeVisible();

    // Operating days tab shows per-day cards with cut-off text.
    await page.getByRole('button', { name: 'Operating days', exact: true }).click();
    await expect(page.getByText('cut-off 66h')).toBeVisible();

    await page.keyboard.press('Escape');
  });

  test('Recurring Routes tab renders routes with schedule chip + type filter', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules-new');

    await page.getByRole('button', { name: /^Recurring Routes\b/ }).click();

    await expect(page.getByText('AKL Medical AM - North Shore')).toBeVisible();
    // Area cell is scoped to a table cell so it doesn't collide with the
    // Name column which also contains the string "North Shore".
    await expect(page.getByRole('cell', { name: 'North Shore', exact: true })).toBeVisible();
    await expect(page.getByText('V. Patel')).toBeVisible();
    // Schedule chip on the route row.
    await expect(page.getByTitle('AKL > CHCH Pre 8am Medical').first()).toBeVisible();
    // Type filter pills.
    await expect(page.getByRole('button', { name: 'All types' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'First mile' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Final mile' })).toBeVisible();
  });

  test('Schedule Groups tab renders bundle with expand', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules-new');

    await page.getByRole('button', { name: /^Schedule Groups\b/ }).click();

    await expect(page.getByText('AKL medical overnight bundle')).toBeVisible();
    await expect(page.getByText('3 schedules')).toBeVisible();
    await expect(page.getByText('10 clients')).toBeVisible();

    // Expand the bundle.
    await page.getByText('AKL medical overnight bundle').click();
    await expect(page.getByText('#1042 - AKL > CHCH Pre 8am Medical')).toBeVisible();
  });

  // ─── Kevin's 2026-09-14 review items ─────────────────────────────

  test('AutoBook column header (renamed from Status)', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules-new');

    await expect(page.getByRole('columnheader', { name: 'AutoBook' })).toBeVisible();
    // Status header should no longer exist on the Schedules tab.
    await expect(page.getByRole('columnheader', { name: 'Status', exact: true })).toHaveCount(0);
  });

  test('View as opens a multi-select client picker with search + select', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules-new');

    // Trigger reads "All schedules" when nothing selected.
    const trigger = page.getByRole('button', { name: 'All schedules' });
    await expect(trigger).toBeVisible();
    await trigger.click();

    // Panel opens, autofocused search input.
    const panel = page.getByTestId('client-multi-picker-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByPlaceholder('Search clients...')).toBeVisible();

    // Live server-side search (server route stubbed above returns the
    // seeded clients when q is a substring match).
    await panel.getByPlaceholder('Search clients...').fill('med');
    await expect(panel.getByText('MedLab Central (MLC)')).toBeVisible();

    // Tick + verify the trigger label switches to a count.
    await panel.getByText('MedLab Central (MLC)').click();
    await expect(page.getByRole('button', { name: 'MedLab Central (MLC)' })).toBeVisible();

    // Deselect via Clear inside the panel.
    await panel.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByRole('button', { name: 'All schedules' })).toBeVisible();
  });

  test('Attach clients action opens the modal with search + already-attached', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules-new');

    // First row's Attach clients icon (aria title "Attach clients").
    await page.getByTitle('Attach clients').first().click();

    // Modal opens with the schedule-specific title.
    await expect(page.getByRole('heading', { name: /Attach clients to #1042/ })).toBeVisible();
    await expect(page.getByText(/each client you tick gets a link row/)).toBeVisible();

    // Server-side search still fires against /api/schedules/clients.
    const searchBox = page.getByPlaceholder('Search clients by name or code...');
    await expect(searchBox).toBeVisible();
    await searchBox.fill('med');
    await expect(page.getByText('MedLab Central (MLC)')).toBeVisible();

    // MedLab Central is in the mocked schedule's clientIds so it
    // renders "already attached" and is not toggleable.
    await expect(page.getByText('already attached').first()).toBeVisible();

    // Attach button is Phase-1 disabled. Use exact: true to
    // disambiguate from the row-level "Attach clients" icon buttons.
    await expect(page.getByRole('button', { name: 'Attach', exact: true })).toBeDisabled();

    // Cancel closes the modal.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: /Attach clients to #/ })).toHaveCount(0);
  });
});
