import { test, expect, type Route } from '@playwright/test';

// E2E for the Schedules NEW page (Steve's 2026-09-08
// KEVIN-NEW-SCHEDULES-VIEW-MULTI-CLIENT brief). All API calls are
// mocked so no DB is required. The spec verifies:
//   1. Sidebar carries the "Schedules NEW" entry (badge visible),
//      navigates to /schedules-new.
//   2. Page mounts the 3 tabs: Schedules / Schedule Bundles /
//      Recurring Routes.
//   3. Schedules tab renders the id-keyed table with day pills +
//      client chips, filter pills, search box, view-as-client picker.
//   4. Override rows nest under their base with the amber "O" badge.
//   5. Row-click opens the read-only edit modal with the 4 tabs +
//      disabled Save button.
//   6. Recurring Routes tab shows the route list + type filter.
//   7. Schedule Bundles tab renders (or its empty-state).

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
  clientNames: [
    'Med Lab Co', 'Pathology Partners', 'North Pole Group', 'Awapuni Ltd',
    'Kowhai Healthcare', 'South Xpress', 'Optical Ltd', 'Bay Business Supplies', 'Avondale Distribution',
  ],
  clientLinkedUtcs: [
    '2026-09-08T00:00:00Z', '2026-09-08T00:00:00Z', '2026-09-08T00:00:00Z',
    '2026-09-08T00:00:00Z', '2026-09-08T00:00:00Z', '2026-09-08T00:00:00Z',
    '2026-09-08T00:00:00Z', '2026-09-08T00:00:00Z', '2026-09-08T00:00:00Z',
  ],
  postcodeIds: [],
  polygonIds: [],
};

const V2_BUNDLES = [
  {
    bundleId: 1,
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
    const page = parseInt(url.searchParams.get('page') ?? '0', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') ?? '0', 10);
    let rows = V2_SCHEDULES;
    if (type === 'default') rows = rows.filter((s) => s.baseScheduleId == null && s.clientCount === 0 && s.legacyClientId == null);
    if (type === 'shared') rows = rows.filter((s) => s.baseScheduleId == null && !(s.legacyClientId == null && s.clientCount === 0));
    if (q) rows = rows.filter((s) => s.name.toLowerCase().includes(q));
    if (clientId) rows = rows.filter((s) => s.linkedClientCodes.length > 0 || s.baseScheduleId == null);
    const total = rows.length;
    const paged = pageSize > 0 ? rows.slice(page * pageSize, (page + 1) * pageSize) : rows;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      // Server-paginated envelope (2026-09-15) - the frontend now
      // consumes `{ rows, total, page, pageSize }` from
      // /api/v2/schedules.
      body: JSON.stringify({
        response: { rows: paged, total, page, pageSize },
      }),
    });
  });
  // GET /overrides must be routed BEFORE the generic /schedules/{id}
  // match or the wildcard catch-all short-circuits it.
  await page.route('**/api/v2/schedules/*/overrides', (route: Route) => {
    // Steve F1 (2026-09-22): the /overrides endpoint returns per-client
    // delta rows out of tblBulkRunScheduleOverride, not clone-header
    // refs. Seed one delta: HRAD (client 300) differs on the schedule
    // scope (cutoffHours=3).
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        response: [
          {
            scheduleId: 1050,
            clientId: 300,
            clientCode: 'HRAD',
            clientName: 'Harmony Radiology',
            schedule: {
              cutoffHours: 3,
              cutoffDay: null,
              cutoffTime: null,
              weekDays: null,
              isActive: null,
              displayName: null,
              displayDescription: null,
            },
            collection: null,
            delivery: null,
            updatedUtc: '2026-09-22T00:00:00Z',
            updatedBy: 'steve',
          },
        ],
      }),
    });
  });
  await page.route('**/api/v2/schedules/*/overrides/*', (route: Route) => {
    if (route.request().method() === 'PUT') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ response: null }),
      });
    }
    if (route.request().method() === 'DELETE') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ response: { deleted: true } }),
      });
    }
    return route.fulfill({ status: 405, body: '' });
  });
  await page.route('**/api/v2/schedules/*/clients', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ response: { added: 1 } }),
    }),
  );
  await page.route('**/api/v2/schedules/*/retire', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ response: 'ok' }),
    }),
  );
  await page.route('**/api/v2/schedules/*', (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ response: V2_DETAIL }),
    });
  });
  await page.route('**/api/v2/schedule-bundles', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ response: V2_BUNDLES }),
    }),
  );
  await page.route('**/api/recurring-routes', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ response: V2_ROUTES }),
    }),
  );
  // Linehaul runs power the Middle-mile rows on the Recurring Routes
  // tab. Empty list is fine for most tests; specific tests can add a
  // narrower stub with `page.route(...)` after this one.
  await page.route('**/api/recurring-linehaul-runs', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ response: [] }),
    }),
  );
  await page.route('**/api/schedules/clients*', (route: Route) => {
    const url = new URL(route.request().url());
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const clients = [
      { id: 100, name: 'MedLab Central (MLC)' },
      { id: 200, name: 'Pathway Diagnostics (PATH)' },
      { id: 300, name: 'Harbour Radiology (HRAD)' },
      // NOT in V2_DETAIL.clientIds - used by the attach-wire test as
      // the "picked client" so the row is actually tickable.
      { id: 1001, name: 'Fresh Attach Test (FAT)' },
    ];
    const hits = q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ response: hits }),
    });
  });
  // /api/schedules/lookups is the depot source now. Only depots +
  // clients are actually consumed by this page; the rest are seeded
  // as empty so type-checks pass.
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
          speeds: [],
          couriers: [],
          clients: [],
          dropOffLocations: [],
          postcodeGroups: [],
          linehaulRuns: [],
          zoneNumbers: [],
          storageStates: [],
          deliveryStates: [],
          pickupBoxDiscounts: [],
        },
      }),
    }),
  );
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
    await expect(page.getByRole('button', { name: /^Schedule Bundles\b/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Recurring Routes\b/ })).toBeVisible();
  });

  test('Schedules tab renders table with day pills + client chips', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules-new');

    // Base row visible.
    await expect(page.getByText('AKL > CHCH Pre 8am Medical').first()).toBeVisible();
    await expect(page.getByText('#1042').first()).toBeVisible();
    // Client chip strip on the base.
    await expect(page.getByText('MLC').first()).toBeVisible();
    // Default schedule (no clients) surfaces the All-clients pill.
    await expect(page.getByText('All clients').first()).toBeVisible();
  });

  test('row-click opens the edit modal with 4 tabs + Save dirty-gated', async ({ page }) => {
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

    // Save button is dirty-gated - disabled until form differs from seed.
    // Legacy per-client schedules would otherwise silently migrate on a
    // no-op save.
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeDisabled();

    // Edit the name; Save becomes enabled.
    const nameInput = page.locator('input[type=text]').first();
    await nameInput.fill('Renamed by test');
    await expect(save).toBeEnabled();

    // Route tab shows the vertical leg stack. Scope to the leg-card
    // badge span so the editable ChainBuilder chooser at the bottom
    // (which also renders COLLECTION / DELIVERY add buttons) doesn't
    // trip strict-mode.
    await page.getByRole('button', { name: 'Route', exact: true }).click();
    await expect(page.locator('span').filter({ hasText: /^COLLECTION$/ }).first()).toBeVisible();
    await expect(page.locator('span').filter({ hasText: /^DELIVERY$/ }).first()).toBeVisible();

    // Operating days tab: editable time + cut-off inputs.
    await page.getByRole('button', { name: 'Operating days', exact: true }).click();
    await expect(page.getByText('Mon').first()).toBeVisible();
    await expect(page.locator('input[type=time]').first()).toBeVisible();

    await page.keyboard.press('Escape');
  });

  test('Recurring Routes tab renders routes with schedule chip + type filter', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules-new');

    await page.getByRole('button', { name: /^Recurring Routes\b/ }).click();

    await expect(page.getByText('AKL Medical AM - North Shore')).toBeVisible();
    await expect(page.getByText('V. Patel')).toBeVisible();
    // Schedule chip on the route row.
    await expect(page.getByTitle('AKL > CHCH Pre 8am Medical').first()).toBeVisible();
    // Type filter pills (Middle mile now live).
    await expect(page.getByRole('button', { name: 'All types' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'First mile' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Middle mile' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Final mile' })).toBeVisible();
    // New columns per Steve's §2 brief.
    await expect(page.getByRole('columnheader', { name: 'Master job' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Clients via schedule' })).toBeVisible();
  });

  test('Schedule Bundles tab renders bundle with expand', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules-new');

    await page.getByRole('button', { name: /^Schedule Bundles\b/ }).click();

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

    // Attach button starts disabled with nothing selected. Use
    // exact: true to disambiguate from the row-level icon buttons.
    await expect(page.getByRole('button', { name: 'Attach', exact: true })).toBeDisabled();

    // Cancel closes the modal.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: /Attach clients to #/ })).toHaveCount(0);
  });

  test('Attach clients wire submits selection + closes modal on success', async ({ page }) => {
    let attachPayload: any = null;
    await stubApis(page);
    // Capture the POST body to verify the wire hit /clients with the
    // ticked ids.
    await page.route('**/api/v2/schedules/1042/clients', async (route) => {
      if (route.request().method() === 'POST') {
        attachPayload = await route.request().postDataJSON();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ response: { added: 1 } }),
        });
      }
      return route.fallback();
    });
    await page.goto('/schedules-new');

    await page.getByTitle('Attach clients').first().click();
    await expect(page.getByRole('heading', { name: /Attach clients to #1042/ })).toBeVisible();

    // Pathway Diagnostics (PATH, id 200) is NOT in the mocked schedule's
    // clientIds so it's tickable. Wait for the initial client list load
    // so the checkboxes are all in the DOM.
    const searchBox = page.getByPlaceholder('Search clients by name or code...');
    await searchBox.fill('fresh');
    // Client 1001 (FAT) is NOT in V2_DETAIL.clientIds so the row is
    // tickable. Click the label (checkbox wrapper), which is
    // interactive; the inner span alone is not.
    const label = page.locator('label').filter({ hasText: 'Fresh Attach Test (FAT)' });
    await expect(label).toBeVisible();
    await label.click();

    // Attach button enables + submits.
    const attachBtn = page.getByRole('button', { name: 'Attach', exact: true });
    await expect(attachBtn).toBeEnabled();
    await attachBtn.click();

    // Modal closes on success + the payload includes the tick.
    await expect(page.getByRole('heading', { name: /Attach clients to #/ })).toHaveCount(0);
    expect(attachPayload).toMatchObject({ clientIds: [1001] });
  });

  test('Retire schedule confirm + wire hits retire endpoint', async ({ page }) => {
    let retireHit = false;
    await stubApis(page);
    await page.route('**/api/v2/schedules/1042/retire', async (route) => {
      if (route.request().method() === 'POST') {
        retireHit = true;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ response: 'ok' }),
        });
      }
      return route.fallback();
    });
    await page.goto('/schedules-new');

    // Row #1042 -> Retire icon. Trigger confirm dialog. Playwright's
    // headless browser accepts native confirm() prompts via a listener;
    // RoutedOps ConfirmContext renders a modal so we click the button.
    // Retire icon is the 3rd action on the row (Attach / Copy / Retire).
    await page.getByTitle(/Retire schedule/).first().click();
    // Confirm modal appears with the danger label. Its "Retire"
    // button has accessible name "Retire" exactly; the row-icon
    // buttons all read "Retire schedule".
    await expect(page.getByRole('heading', { name: 'Retire schedule?' })).toBeVisible();
    await page.getByRole('button', { name: 'Retire', exact: true }).click();

    // Confirm modal should close on accept. Polling until it goes;
    // avoids a hang if waitForRequest doesn't match the URL exactly.
    await expect(page.getByRole('heading', { name: 'Retire schedule?' })).toHaveCount(0);
    // Then the POST fires in the mutation. Give it a beat.
    await expect.poll(() => retireHit, { timeout: 5000 }).toBe(true);
  });

  test('Server pagination envelope renders total from server', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules-new');

    // The stub returns 2 rows and the total. The "Showing 2 of 2
    // schedules" caption sources its count from the server total,
    // not from client-side derived slicing.
    await expect(page.getByText(/Showing \d+ of \d+ schedules/)).toBeVisible();
  });

  test('Depot dropdown lists depots from the lookups endpoint', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules-new');

    // Depot filter pulls the full tenant list from
    // /api/schedules/lookups, not just depots seen in the current
    // page. The 2026-09-17 filter refactor replaced the plain <select>
    // with `DepotMultiPicker` - a trigger button labelled "All depots"
    // (when nothing selected) that reveals a panel (testid
    // `depot-multi-picker-panel`) with one checkbox row per depot.
    // Assert the trigger exists, then open the panel and assert every
    // seeded depot renders as a row.
    const trigger = page.getByRole('button', { name: 'All depots' });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const panel = page.getByTestId('depot-multi-picker-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Auckland', { exact: true })).toBeVisible();
    await expect(panel.getByText('Christchurch', { exact: true })).toBeVisible();
    await expect(panel.getByText('Gisborne', { exact: true })).toBeVisible();
  });

  test('Bundles tab New bundle wire creates + refreshes list', async ({ page }) => {
    let created: any = null;
    await stubApis(page);
    await page.route('**/api/v2/schedule-bundles', async (route) => {
      if (route.request().method() === 'POST') {
        created = await route.request().postDataJSON();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ response: { bundleId: 999 } }),
        });
      }
      // fall back to the seeded GET stub
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ response: V2_BUNDLES }),
      });
    });
    await page.goto('/schedules-new');
    await page.getByRole('button', { name: /^Schedule Bundles\b/ }).click();

    // + New bundle opens the modal + submits.
    await page.getByRole('button', { name: '+ New bundle' }).click();
    await expect(page.getByRole('heading', { name: 'New schedule bundle' })).toBeVisible();
    await page.getByPlaceholder('AKL medical overnight bundle').fill('Wednesday HFAK bundle');
    await page.getByPlaceholder('What a new medical client gets on day one...').fill('Chilled produce mid-week.');
    await page.getByRole('button', { name: 'Create bundle' }).click();

    // Modal closes on success + POST payload matches the form.
    await expect(page.getByRole('heading', { name: 'New schedule bundle' })).toHaveCount(0);
    expect(created).toMatchObject({
      name: 'Wednesday HFAK bundle',
      description: 'Chilled produce mid-week.',
    });
  });

  test('Bundles Delete confirm + wire hits delete endpoint', async ({ page }) => {
    let deleteHit = false;
    await stubApis(page);
    await page.route('**/api/v2/schedule-bundles/1', async (route) => {
      if (route.request().method() === 'DELETE') {
        deleteHit = true;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ response: 'ok' }),
        });
      }
      return route.fallback();
    });
    await page.goto('/schedules-new');
    await page.getByRole('button', { name: /^Schedule Bundles\b/ }).click();

    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Delete bundle?' })).toBeVisible();
    // The confirm modal's danger button reads "Delete" too - danger
    // variant. Use exact match to pick it out of the row-level button.
    await page.getByRole('button', { name: 'Delete', exact: true }).nth(1).click();
    await expect.poll(() => deleteHit, { timeout: 5000 }).toBe(true);
  });

  test('Copy schedule action opens modal + POSTs newName', async ({ page }) => {
    let copyPayload: any = null;
    await stubApis(page);
    await page.route('**/api/v2/schedules/1042/copy', async (route) => {
      if (route.request().method() === 'POST') {
        copyPayload = await route.request().postDataJSON();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ response: { scheduleId: 9999 } }),
        });
      }
      return route.fallback();
    });
    await page.goto('/schedules-new');

    await page.getByTitle('Copy schedule').first().click();
    // Modal opens with source header + editable new-name input seeded
    // with "{source} (copy)".
    await expect(page.getByRole('heading', { name: /Copy schedule #1042/ })).toBeVisible();
    const nameInput = page.locator('input[type=text]').last();
    await nameInput.fill('Cloned schedule name');
    await page.getByRole('button', { name: 'Copy', exact: true }).click();

    await expect.poll(() => copyPayload).not.toBeNull();
    expect(copyPayload).toMatchObject({ newName: 'Cloned schedule name' });
    // Modal closes on success.
    await expect(page.getByRole('heading', { name: /Copy schedule #/ })).toHaveCount(0);
  });

  test('New Schedule modal creates + closes on success', async ({ page }) => {
    let createPayload: any = null;
    await stubApis(page);
    // The New Schedule modal now hits POST /api/v2/schedules
    // (v2 upsert) instead of the legacy PUT /api/schedules. Match both
    // shapes so this test survives during the transition.
    await page.route('**/api/v2/schedules', async (route) => {
      if (route.request().method() === 'POST') {
        createPayload = await route.request().postDataJSON();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ response: { scheduleId: 5555, name: createPayload.name } }),
        });
      }
      return route.fallback();
    });
    await page.route('**/api/schedules', async (route) => {
      if (route.request().method() === 'PUT') {
        createPayload = await route.request().postDataJSON();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ response: { scheduleId: 5555, name: createPayload.name } }),
        });
      }
      return route.fallback();
    });
    await page.goto('/schedules-new');

    await page.getByRole('button', { name: '+ New Schedule' }).click();
    await expect(page.getByRole('heading', { name: 'New Schedule' })).toBeVisible();

    await page.getByPlaceholder('AKL > CHCH Pre 10am Medical').fill('New MVP Schedule');

    // ChainBuilder flow: pick DELIVERY as first leg so the modal
    // has a destination region. Then choose a region in the inline
    // editor. Depots stub seeds ids 1 / 3 / 4 - use 1 (Auckland).
    await page.getByRole('button', { name: /DELIVERY/ }).click();
    const regionSelect = page.locator('label').filter({ hasText: 'Region' }).locator('select');
    await regionSelect.selectOption('1');

    // Modal defaults Mon-Fri enabled + 08:00-17:00 + 2h cutoff, so
    // "at least one day enabled" is already satisfied.
    await page.getByRole('button', { name: 'Create schedule' }).click();

    await expect(page.getByRole('heading', { name: 'New Schedule' })).toHaveCount(0);
    expect(createPayload).toMatchObject({
      name: 'New MVP Schedule',
      regionId: 1,
    });
  });

  test('Bundle Attach clients modal picks + POSTs to /clients', async ({ page }) => {
    let attachPayload: any = null;
    await stubApis(page);
    await page.route('**/api/v2/schedule-bundles/1/clients', async (route) => {
      if (route.request().method() === 'POST') {
        attachPayload = await route.request().postDataJSON();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ response: { added: 3 } }),
        });
      }
      return route.fallback();
    });
    await page.goto('/schedules-new');
    await page.getByRole('button', { name: /^Schedule Bundles\b/ }).click();

    // Attach clients link on the seeded bundle card.
    await page.getByRole('button', { name: 'Attach clients' }).click();
    await expect(page.getByRole('heading', { name: /Attach clients to bundle #1/ })).toBeVisible();

    // Open the picker + tick one client.
    await page.getByRole('button', { name: 'Pick clients...' }).click();
    const panel = page.getByTestId('client-multi-picker-panel');
    await panel.getByPlaceholder('Search clients...').fill('med');
    await panel.getByText('MedLab Central (MLC)').click();

    // Submit + verify payload.
    await page.getByRole('button', { name: 'Attach', exact: true }).click();
    await expect.poll(() => attachPayload).not.toBeNull();
    expect(attachPayload).toMatchObject({ clientIds: [100] });
  });
});
