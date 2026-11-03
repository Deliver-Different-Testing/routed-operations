import { test, expect } from '@playwright/test';
import { asTenantOperator, mockEverything } from './fixtures/npSession';
import { asCustomer, asTenantStaff } from './fixtures/customerSession';

// Customer access to Routed Operations Bulk Import, end to end in a real
// browser (ro-bulk-import-customer-scope M3).
//
// Before M3, "/" and every unknown URL went to /dashboard. A customer whose
// only switch is Bulk Import landed on "This page isn't available" next to a
// one-item menu, and a customer with no switches got the same page with an
// empty menu. Each case has a tenant control, because the risk with a
// redirect is that it moves everybody.
//
// SCOPE. Client-side only. The server decides what a customer may call
// (BulkImport.Use policy, [RequireFeature], IBulkClientScope), covered by the
// backend tests.
//
// Run:
//   npx playwright install chromium   (one-time)
//   npm run test:e2e

test.describe('Customer landing and menu', () => {
  test.beforeEach(async ({ page }) => {
    await mockEverything(page);
  });

  test('a Bulk Import only customer lands on /bulk-import with one menu item', async ({ page }) => {
    await asCustomer(page, ['hub-tile-routed-operations', 'ro-bulk-import']);
    await page.goto('/');
    await expect(page).toHaveURL(/\/bulk-import$/);

    const links = page.locator('aside nav a');
    await expect(links).toHaveCount(1);
    await expect(links.first()).toHaveText('Bulk Import');
    await expect(page.getByText("This page isn't available")).toHaveCount(0);
  });

  test('an unknown URL also lands on the first allowed page', async ({ page }) => {
    await asCustomer(page, ['ro-bulk-import']);
    await page.goto('/no-such-page');
    await expect(page).toHaveURL(/\/bulk-import$/);
  });

  test('a customer with nothing switched on gets the empty state', async ({ page }) => {
    await asCustomer(page, []);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Nothing is switched on for your account yet' })).toBeVisible();
    await expect(page.locator('aside nav a')).toHaveCount(0);
  });

  test('a tenant operator (control) still lands on /dashboard', async ({ page }) => {
    await asTenantOperator(page);
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});

test.describe('Bulk Import screen, customer vs staff', () => {
  test.beforeEach(async ({ page }) => {
    await mockEverything(page);
  });

  // The Routed Ops import wizard has no price, courier or courier-percentage
  // inputs for anyone (wizardState.urgentFieldsFor lists none, and the
  // payload never sets them), and Bulk Complete is commented out for
  // everyone, so the staff-only difference on this screen is Staff Import.
  test('a customer sees New Import but no Staff Import or Bulk Complete', async ({ page }) => {
    await asCustomer(page, ['ro-bulk-import']);
    await page.goto('/bulk-import');
    await expect(page.getByRole('button', { name: 'New Import' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Staff Import' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Bulk Complete' })).toHaveCount(0);
  });

  test('staff (control) see Staff Import, and still no Bulk Complete', async ({ page }) => {
    await asTenantStaff(page, ['ro-bulk-import']);
    await page.goto('/bulk-import');
    await expect(page.getByRole('button', { name: 'New Import' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Staff Import' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bulk Complete' })).toHaveCount(0);
  });
});
