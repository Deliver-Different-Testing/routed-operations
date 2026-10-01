import type { Page, Route } from '@playwright/test';

// Fixtures for driving the app as a logged-in network partner.
//
// WHY THIS WORKS WITHOUT A REAL PARTNER
//   `NpAgentId` is NULL on 100% of rows on every tenant, staging and prod
//   alike, and no NP user exists to log in as. None of that matters here: the
//   E2E harness boots vite dev (which stamps its own window.__APP_USER__) and
//   intercepts every /api/* call, so the session and the data are both ours to
//   author. The frontend decides partner-ness purely from
//   `window.__APP_USER__.isNetworkPartner`, which is exactly what we override.
//
//   This covers the CLIENT-SIDE gating only: nav hiding, route redirects and
//   conditional rendering. The authoritative server-side denial lives in the
//   RouteBuilder.* policies and is covered by RouteBuilderPoliciesTests.
//
// THE OVERRIDE HAS TO BE A SETTER
//   index.html assigns `window.__APP_USER__ = {...}` in a <head> script.
//   addInitScript runs BEFORE page scripts, so a plain assignment here would
//   just be overwritten a moment later. Installing an accessor instead lets us
//   merge our fields into whatever the page assigns.
//
// See NP-PAY-PART4-TODO.md T1-T4, T9-T12.

/** Marks every subsequent navigation on this page as a network-partner session. */
export async function asNetworkPartner(page: Page) {
  await applyUserOverride(page, { isNetworkPartner: true, npAgentId: 42 });
}

/** Explicit tenant-operator session, for the control cases. */
export async function asTenantOperator(page: Page) {
  await applyUserOverride(page, { isNetworkPartner: false, npAgentId: null });
}

async function applyUserOverride(page: Page, override: Record<string, unknown>) {
  await page.addInitScript((patch) => {
    let current: Record<string, unknown> = { ...patch };
    Object.defineProperty(window, '__APP_USER__', {
      configurable: true,
      get: () => current,
      // Merge AFTER whatever the page assigns, so our fields win while the
      // dev bootstrap's tenant / timezone / email survive.
      set: (assigned: Record<string, unknown>) => {
        current = { ...assigned, ...patch };
      },
    });
  }, override);
}

/**
 * Blanket JSON mocks so a page under test renders instead of hanging on a
 * fetch. Deliberately permissive: these specs assert on what the UI chooses to
 * show a partner, not on any particular payload.
 */
export async function mockEverything(page: Page) {
  await page.route(/\/api\//, (route: Route) => {
    const type = route.request().resourceType();
    if (type === 'xhr' || type === 'fetch') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ response: [] }),
      });
    }
    return route.continue();
  });
}

/**
 * Enough Route Viewer data for the mobile drill Runs -> Jobs -> Detail.
 *
 * Playwright matches routes in REVERSE registration order, so `mockEverything`
 * must be registered BEFORE this, and these specific matchers win. Same
 * ordering rule the Route Viewer fixtures call out.
 */
export async function mockMobileJob(page: Page) {
  const job = {
    bulkJobId: 1, jobId: 100, jobNumber: 'JOB-100', jobStatus: 'D',
    clientCode: 'ACME', speedName: 'CORT', speed: 'CORT',
    fromCompany: 'Pick Co', fromAddress: '1 Pick St', fromSuburb: 'A',
    toCompany: 'Del Co', toAddress: '2 Del St', toSuburb: 'B',
    bookDate: '13/08/2026', bookTime: '09:00:00',
    pickupWindow: '09:00 - 10:00',
    amount: 42,
    contact: 'Alice', phone: '021111111',
    deliverToContact: 'Bob', deliverToPhone: '0229999999',
    trackingEmail: 'b@x.com',
    notes: 'Pickup notes', deliveryNotes: 'Delivery notes',
    size: 'S', qty: 3, weight: 2, speedId: 1,
    ourRef: 'ORef', refA: 'RefA', refB: 'RefB',
    runName: 'RUN-A', runOrder: 5, bulkRunId: 20,
    toLat: -36.86, toLng: 174.77, fromPostCode: 1011, toPostCode: 1021,
    fromCity: 'AKL', toCity: 'AKL',
  };
  const run = { id: 20, name: 'RUN-A', area: 'North', jobs: 1, courierName: 'Kev' };
  const json = (data: unknown) => ({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ response: data }),
  });

  await page.route(/\/api\/runviewer\/runs\/\d+\/jobs/, (r: Route) => r.fulfill(json([job])));
  await page.route(/\/api\/runviewer\/runs(\?.*)?$/, (r: Route) => r.fulfill(json([run])));
  await page.route(/\/api\/runviewer\/jobs\/\d+(\?.*)?$/, (r: Route) => r.fulfill(json(job)));
  await page.route(/\/api\/runviewer\/couriers\/position/, (r: Route) => r.fulfill(json(null)));
}
