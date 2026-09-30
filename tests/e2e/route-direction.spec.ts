import { test, expect, type Route } from '@playwright/test';

// E2E for Feature 5.1 / 5.5 - Route Direction in the Recurring Routes editor.
//
// This is the flow nothing else covers: the vitest suite deliberately avoids
// full-page render + MSW + multi-step interaction (see CLAUDE.md), and the
// backend xUnit tests cover the validation rules but not the operator's path
// through them. What is verified here:
//
//   1. The editor opens on a first-mile route with no Origin section.
//   2. Choosing Final mile reveals the Origin section.
//   3. The Depot tab lists depots from /api/address/regions.
//   4. The Address tab lists recent pickup addresses (K6), and picking one
//      fills the address AND its coordinates - no geocode round-trip.
//   5. Save sends direction/depotId/origin in the shape the server expects.
//   6. Switching back to First mile clears the origin, which is the guard
//      against a later flip silently inheriting a forgotten address.
//
// Every /api/* call is intercepted, so no backend or DB is needed.

const ROUTES = [
  {
    routeId: 1, name: 'Auckland CBD Collect', area: 'Auckland central',
    defaultTargetType: null, defaultTargetId: null, defaultTargetName: '',
    scheduleId: null, scheduleName: '', scheduleWindow: '', schedules: [],
    active: true, zipcodes: [], bulkPolygons: [],
    rosterEntryCount: 0, bookingCount: 0, mappedStopsCount: 0,
    createdAt: '2026-09-01T00:00:00Z', updatedAt: null,
    direction: 1, depotId: null, depotName: '', origin: null,
  },
  {
    routeId: 15, name: 'Burbank to Lab', area: 'Final Mile to Neo Lab',
    defaultTargetType: null, defaultTargetId: null, defaultTargetName: '',
    scheduleId: null, scheduleName: '', scheduleWindow: '', schedules: [],
    active: true, zipcodes: [], bulkPolygons: [],
    rosterEntryCount: 0, bookingCount: 0, mappedStopsCount: 0,
    createdAt: '2026-09-25T00:00:00Z', updatedAt: null,
    // Already configured as a depot-origin final-mile route, so the editor
    // has to land on the Depot tab rather than always defaulting to it.
    direction: 2, depotId: 38, depotName: 'Burbank', origin: null,
  },
];

const REGIONS = [
  { id: 35, name: 'MCI Sac Response Center (Neo)', fromCompany: null, fromAddress: null, fromCity: null, fromState: null, fromZipCode: null },
  { id: 38, name: 'Burbank', fromCompany: null, fromAddress: null, fromCity: null, fromState: null, fromZipCode: null },
];

const SUGGESTIONS = [
  {
    label: 'CS Logistics, 11001 West Mitchell Street, Milwaukee, 53214',
    company: 'CS Logistics', address: '11001 West Mitchell Street',
    city: 'Milwaukee', zip: '53214',
    latitude: 43.0615737, longitude: -87.8796513,
    usageCount: 104, lastUsedUtc: '2026-09-29T07:04:10Z',
  },
  {
    label: 'Ascension All Saints Hospital, 3801 Spring St, Racine, 53405',
    company: 'Ascension All Saints Hospital', address: '3801 Spring St',
    city: 'Racine', zip: '53405',
    latitude: 42.7317579, longitude: -87.8264766,
    usageCount: 32, lastUsedUtc: '2026-09-20T07:04:10Z',
  },
];

/** Captured PUT body, so the test asserts the CONTRACT and not just the UI. */
let lastSaveBody: any = null;

async function mockApi(page: import('@playwright/test').Page) {
  lastSaveBody = null;

  // Playwright matches route handlers in REVERSE registration order: the LAST
  // one registered wins (verified empirically, not from memory). So these are
  // ordered least specific FIRST, most specific LAST.
  //
  // The subtle one is '**/api/recurring-routes/*' - that glob also matches the
  // bare '/api/recurring-routes', so it has to be registered BEFORE the exact
  // handler or the route list silently comes back empty and every assertion
  // fails with "element not found" a long way from the cause.
  await page.route('**/api/**', (route: Route) =>
    route.fulfill({ json: { response: [] } }));

  await page.route('**/api/recurring-routes/*', (route: Route) => {
    const req = route.request();
    if (req.method() === 'PUT') {
      lastSaveBody = JSON.parse(req.postData() ?? '{}');
      return route.fulfill({ json: { response: { ...ROUTES[0], ...lastSaveBody } } });
    }
    return route.fulfill({ json: { response: [] } });
  });
  await page.route('**/api/recurring-routes/zipcodes/**', (route: Route) =>
    route.fulfill({ json: { response: [] } }));
  await page.route('**/api/recurring-routes/assignable-targets', (route: Route) =>
    route.fulfill({ json: { response: { couriers: [], agents: [], nps: [] } } }));
  await page.route('**/api/recurring-routes/schedules/lookup', (route: Route) =>
    route.fulfill({ json: { response: [] } }));
  await page.route('**/api/recurring-routes/pickup-address-suggestions**', (route: Route) =>
    route.fulfill({ json: { response: SUGGESTIONS } }));
  await page.route('**/api/address/regions', (route: Route) =>
    route.fulfill({ json: { regions: REGIONS } }));

  // Exact path last so it beats the single-segment glob above.
  await page.route('**/api/recurring-routes', (route: Route) =>
    route.fulfill({ json: { response: ROUTES } }));
}

async function openRoutesTab(page: import('@playwright/test').Page) {
  await page.goto('/recurring-routes');
  const routesTab = page.getByRole('button', { name: /^Routes$/ });
  if (await routesTab.count()) await routesTab.first().click();
  await expect(page.getByText('Auckland CBD Collect')).toBeVisible({ timeout: 15_000 });
}

test.describe('Feature 5 - Route Direction in the Recurring Routes editor', () => {
  test('a first-mile route shows no Origin section until Final mile is chosen', async ({ page }) => {
    await mockApi(page);
    await openRoutesTab(page);

    await page.getByText('Auckland CBD Collect').click();

    await expect(page.getByText('Direction')).toBeVisible();
    // First mile is the stored value, so Origin must not be on screen.
    await expect(page.getByRole('button', { name: 'A depot' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Final mile' }).click();

    await expect(page.getByRole('button', { name: 'A depot' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'An address' })).toBeVisible();
    await expect(
      page.getByText('Switching back to first mile clears the origin below.'),
    ).toBeVisible();
  });

  test('the depot picker is populated from the regions endpoint', async ({ page }) => {
    await mockApi(page);
    await openRoutesTab(page);

    await page.getByText('Auckland CBD Collect').click();
    await page.getByRole('button', { name: 'Final mile' }).click();

    const depotSelect = page.locator('select').filter({ hasText: 'Pick a depot' });
    await expect(depotSelect).toBeVisible();
    await expect(depotSelect.locator('option')).toContainText(['Burbank']);
  });

  test('picking a recent pickup address fills the address AND its coordinates', async ({ page }) => {
    await mockApi(page);
    await openRoutesTab(page);

    await page.getByText('Auckland CBD Collect').click();
    await page.getByRole('button', { name: 'Final mile' }).click();
    await page.getByRole('button', { name: 'An address' }).click();

    // K6: the list only loads once this tab is shown.
    await expect(page.getByText('Recently collected from')).toBeVisible();
    await expect(page.getByText(/CS Logistics.*Milwaukee/)).toBeVisible();
    await expect(page.getByText(/104 jobs.*already located/)).toBeVisible();

    await page.getByRole('button', { name: /CS Logistics/ }).click();

    // The whole point: coordinates arrive with the suggestion, so the
    // "not located yet" prompt is replaced without any geocode call.
    await expect(page.getByText(/Located at 43\.06157, -87\.87965/)).toBeVisible();
    await expect(page.getByPlaceholder('Origin address')).toHaveValue(/CS Logistics/);
  });

  test('saving a final-mile address origin sends the contract the server expects', async ({ page }) => {
    await mockApi(page);
    await openRoutesTab(page);

    await page.getByText('Auckland CBD Collect').click();
    await page.getByRole('button', { name: 'Final mile' }).click();
    await page.getByRole('button', { name: 'An address' }).click();
    await page.getByRole('button', { name: /CS Logistics/ }).click();
    await page.getByRole('button', { name: /^Save$/ }).click();

    await expect.poll(() => lastSaveBody).not.toBeNull();
    expect(lastSaveBody.direction).toBe(2);
    // depotId must be null on the address branch, not left over from the
    // depot tab - the two origins are mutually exclusive.
    expect(lastSaveBody.depotId).toBeNull();
    expect(lastSaveBody.origin).toMatchObject({
      zip: '53214',
      latitude: 43.0615737,
      longitude: -87.8796513,
      radiusM: 5000,
    });
  });

  test('switching back to first mile clears the origin on save', async ({ page }) => {
    await mockApi(page);
    await openRoutesTab(page);

    // Route 15 opens already final mile with a depot origin.
    await page.getByText('Burbank to Lab').click();
    await expect(page.getByRole('button', { name: 'A depot' })).toBeVisible();

    await page.getByRole('button', { name: 'First mile' }).click();
    await expect(page.getByRole('button', { name: 'A depot' })).toHaveCount(0);

    await page.getByRole('button', { name: /^Save$/ }).click();

    await expect.poll(() => lastSaveBody).not.toBeNull();
    expect(lastSaveBody.direction).toBe(1);
    expect(lastSaveBody.depotId).toBeNull();
    expect(lastSaveBody.origin).toBeNull();
  });
});
