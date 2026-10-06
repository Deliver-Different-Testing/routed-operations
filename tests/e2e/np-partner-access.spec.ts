import { test, expect } from '@playwright/test';
import { asNetworkPartner, asTenantOperator, mockEverything, mockMobileJob } from './fixtures/npSession';

// Network partner access, end to end in a real browser.
//
// Covers the client half of Steve's Part 4 item J plus the Route Viewer
// surfaces from items G and I:
//
//   * Sidebar hides Route Builder and Bulk Import for a partner (T2)
//   * /routes and /bulk-import redirect a partner to /dashboard (T3)
//   * the Route Viewer Print menu and Top Up button are gone (T9, M18)
//   * the mobile job detail hides Charge and Phone (T10, T11)
//
// Every case has a tenant-operator control, because the risk with a hide is
// not that it fails to hide, it is that it hides for everybody.
//
// SCOPE. This is client-side gating only. The real gate is the RouteBuilder.*
// authorization policies, covered by RouteBuilderPoliciesTests. A partner who
// bypassed all of this would still get 403 from the API.
//
// Run:
//   npx playwright install chromium   (one-time)
//   npm run test:e2e

test.describe('Network partner - module lockout', () => {
  test.beforeEach(async ({ page }) => {
    await mockEverything(page);
  });

  test('sidebar hides Route Builder and Bulk Import, keeps the partner lane', async ({ page }) => {
    await asNetworkPartner(page);
    await page.goto('/dashboard');

    const nav = page.locator('nav');
    await expect(nav.getByText('Dashboard')).toBeVisible();
    await expect(nav.getByText('Route Viewer').first()).toBeVisible();

    for (const label of [
      'Route Builder', 'Bulk Import', 'Recurring Routes', 'Client Overrides',
      'Driver Rostering', 'Polygon Builder',
    ]) {
      await expect(nav.getByText(label)).toHaveCount(0);
    }
    await expect(nav.getByText('Schedules')).toHaveCount(0);

    // Quoting and Auto-Assign Log go too, from 2026-10-07. They stayed under
    // D1 = B because RouteBuilder.Quote and .Polygon kept no NP check and the
    // pages genuinely worked. Steve ruled on 2026-10-06 that a partner sees
    // neither, so the policy denies them and the nav follows.
    await expect(nav.getByText('Quoting')).toHaveCount(0);
    await expect(nav.getByText('Auto-Assign Log')).toHaveCount(0);
  });

  test('a tenant operator still sees both entries', async ({ page }) => {
    await asTenantOperator(page);
    await page.goto('/dashboard');

    const nav = page.locator('nav');
    await expect(nav.getByText('Route Builder')).toBeVisible();
    await expect(nav.getByText('Bulk Import')).toBeVisible();
  });

  test('a partner typing /routes is redirected to the dashboard', async ({ page }) => {
    // The nav hide is cosmetic on its own - App.tsx had no route guard at all
    // before this work, so every page was reachable by URL.
    await asNetworkPartner(page);
    await page.goto('/routes');
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('a partner typing /bulk-import is redirected to the dashboard', async ({ page }) => {
    await asNetworkPartner(page);
    await page.goto('/bulk-import');
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('every denied surface redirects', async ({ page }) => {
    // /quoting and /auto-assign-log joined this list on 2026-10-07. The
    // earlier version of this test asserted they did NOT redirect, which was
    // correct while RouteBuilder.Quote and .Polygon admitted a partner.
    await asNetworkPartner(page);
    for (const path of [
      '/schedules', '/schedules-new', '/recurring-routes',
      '/client-overrides', '/driver-scheduling', '/polygon-builder',
      '/quoting', '/auto-assign-log',
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/dashboard$/);
    }
  });

  test('a tenant operator is not redirected off /routes', async ({ page }) => {
    await asTenantOperator(page);
    await page.goto('/routes');
    await expect(page).toHaveURL(/\/routes$/);
  });

  test('the partner lane itself is never redirected', async ({ page }) => {
    // Route Viewer is the partner's own module. Scoping inside it is
    // row-level, via INpScopeGuard and @NpAgentId, not a redirect.
    await asNetworkPartner(page);
    await page.goto('/route-viewer');
    await expect(page).toHaveURL(/\/route-viewer$/);
  });
});

test.describe('Network partner - Route Viewer exports', () => {
  test.beforeEach(async ({ page }) => {
    await mockEverything(page);
  });

  test('Print and Top Up are hidden for a partner, Layout survives', async ({ page }) => {
    // Every Print entry is refused server-side for a partner, and Top Up is a
    // second entry point to the TopUpDialog that the job context menu already
    // hid (M18). Layout is per-viewer panel sizing in localStorage, so it
    // stays - that is the assertion proving the hide was scoped.
    await asNetworkPartner(page);
    await page.goto('/route-viewer');

    // Exact name, not /^Print/. The run-list toolbar has two more buttons
    // whose titles start with "Print" (Print labels for run, Print run (Sort
    // Mode picker)). Those are a separate question - see the note below.
    await expect(page.getByRole('button', { name: 'Print ▾' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Top Up' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Layout ▾' })).toBeVisible();
    // F7: the two run-list print controls are bulk-label flows the server
    // already refuses, so they go too rather than leaving a partner two
    // buttons whose only outcome is a failure toast.
    await expect(page.getByRole('button', { name: 'Print labels for run' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Print run (Sort Mode picker)' })).toHaveCount(0);
  });

  test('a tenant operator keeps the whole Print menu', async ({ page }) => {
    await asTenantOperator(page);
    await page.goto('/route-viewer');

    const print = page.getByRole('button', { name: 'Print ▾' });
    await expect(print).toBeVisible();
    await print.click();
    await expect(page.getByRole('button', { name: 'Run Allocation' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Woop Report' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print labels for run' })).toBeVisible();
  });

  test('Linehaul whole-day exports are hidden for a partner', async ({ page }) => {
    await asNetworkPartner(page);
    await page.goto('/route-viewer/linehaul');

    await expect(page.getByRole('button', { name: 'Export manifest CSV' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Download Linehaul Report' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Print labels/ })).toHaveCount(0);
  });

  test('a tenant operator keeps the Linehaul exports', async ({ page }) => {
    await asTenantOperator(page);
    await page.goto('/route-viewer/linehaul');

    await expect(page.getByRole('button', { name: 'Export manifest CSV' })).toBeVisible();
  });
});

test.describe('Network partner - mobile job detail', () => {
  test.beforeEach(async ({ page }) => {
    await mockEverything(page);
    await mockMobileJob(page);
  });

  // Runs -> Jobs -> Detail. The pane is three taps deep and the page is
  // reachable by direct URL only - it is not in the sidebar, which is a large
  // part of why it was the one Route Viewer surface that never got NP gating.
  async function drillToDetail(page: import('@playwright/test').Page) {
    await page.goto('/route-viewer/mobile');
    await page.getByText('RUN-A').click();
    await page.getByText('JOB-100').click();
    // Anchor on a row both roles see; Charge and Phone are both role-dependent.
    await expect(page.getByText('Email')).toBeVisible();
  }

  test('a tenant operator sees Charge and Phone', async ({ page }) => {
    await asTenantOperator(page);
    await drillToDetail(page);
    await expect(page.getByText('Charge')).toBeVisible();
    await expect(page.getByText('42.00')).toBeVisible();
    await expect(page.getByText('Phone', { exact: true })).toBeVisible();
    await expect(page.getByText('0229999999')).toBeVisible();
  });

  test('a partner sees neither Charge nor Phone', async ({ page }) => {
    // job.amount is TENANT revenue. Desktop hid its Pricing tile at
    // RvJobDetail.tsx:231 and gated the phone rows in the same breath; mobile
    // implemented neither half.
    await asNetworkPartner(page);
    await drillToDetail(page);
    await expect(page.getByText('Charge')).toHaveCount(0);
    await expect(page.getByText('42.00')).toHaveCount(0);
    await expect(page.getByText('Phone', { exact: true })).toHaveCount(0);
    await expect(page.getByText('0229999999')).toHaveCount(0);
  });

  test('the rest of the detail pane survives for a partner', async ({ page }) => {
    // The guard must take Charge and Phone only. Email sits directly below the
    // phone row and desktop does NOT gate it (RvJobDetail.tsx:281), so it has
    // to still be there.
    await asNetworkPartner(page);
    await drillToDetail(page);
    await expect(page.getByText('2 Del St')).toBeVisible();
    await expect(page.getByText('b@x.com')).toBeVisible();
  });
});
