import type { Page, Route } from '@playwright/test';
import { applyUserOverride } from './npSession';

// Fixtures for driving the app as a customer contact (ClientTypeId 2) or as
// tenant staff, with an explicit set of Access Control switches.
//
// Same mechanism as npSession: the vite harness stamps window.__APP_USER__,
// and we merge our fields over it. The dev bootstrap sets
// bypassesFeatureSwitches = true (DF Admin behaviour); a customer must NOT
// bypass, so the menu and the landing redirect read /api/me/visible-features,
// which we answer with the keys the test names.
//
// Client-side only. The server half (BulkImport.Use policy, IBulkClientScope,
// [RequireFeature]) is covered by the backend tests.

/** A customer contact whose visible switches are exactly `keys`. */
export async function asCustomer(page: Page, keys: string[]) {
  await applyUserOverride(page, {
    bypassesFeatureSwitches: false,
    isInternal: false,
    isNetworkPartner: false,
    npAgentId: null,
    clientTypeId: '2',
  });
  await mockVisibleFeatures(page, keys);
}

/** Tenant staff (ClientTypeId 4) with exactly `keys` switched on. */
export async function asTenantStaff(page: Page, keys: string[]) {
  await applyUserOverride(page, {
    bypassesFeatureSwitches: false,
    isInternal: true,
    isNetworkPartner: false,
    npAgentId: null,
    clientTypeId: '4',
  });
  await mockVisibleFeatures(page, keys);
}

/** Register AFTER mockEverything: Playwright matches the last route first. */
async function mockVisibleFeatures(page: Page, keys: string[]) {
  await page.route(/\/api\/me\/visible-features/, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(keys) }));
}
