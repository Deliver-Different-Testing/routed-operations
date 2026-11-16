import { test, expect, type Page, type Route } from '@playwright/test';
import { applyUserOverride, mockEverything } from './fixtures/npSession';

// #1018 Route Builder speed, the map half. Every save reloads the jobs and
// runs, and the cockpit used to clear and rebuild every marker (and re-request
// the route line) even when the reload brought back exactly the same pins.
//
// SCOPE. The Google Maps SDK is loaded by the Razor host page in production, so
// here a fake window.google is installed before the app boots and counts the
// markers it is asked to create. Every /api call is intercepted. The server
// half (the parent-id prefetch) is pinned by ParentPrefetchBoundTests.

const env = { messageId: 'x', success: true, messages: [] };
const json = (r: Route, data: unknown) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });

const job = (id: number, lat: string) => ({
  bulkJobId: id, jobNumber: `J-${id}`, bookDate: '2031-01-01', bookTime: '09:00:00', jobStatus: 0,
  clientId: 1, clientCode: 'EXMPL', amount: 0, speed: 3, speedName: 'Standard',
  fromCompany: null, fromAddress: null, fromSuburb: null, fromPostCode: null,
  toCompany: null, toAddress: `${id} Sample Street`, toSuburb: 'Otahuhu', toPostCode: 1062,
  size: 0, qty: 1, weight: 0, courierId: null, courierName: null, clientRefa: null, clientRefb: null,
  ourRef: null, notes: null, pickUpLatitude: null, pickUpLongitude: null,
  deliveryLatitude: lat, deliveryLongitude: '174.8', prebookJob: false, onHold: false, void: false, done: false,
  bulkRunId: null, runName: null, runOrder: null, multiboxParentId: null, parentId: null, regionId: null,
  barcode: null, okToLeave: null, contact: null, deliverToContact: null, deliverToPhone: null,
  trackingEmail: null, trackingMobile: null, proofOfDeliveryEmail: null, proofOfDeliveryMobile: null,
  scheduleId: null, scheduleName: null, scheduleWindowStart: null, scheduleWindowEnd: null, jobCubicM3: null,
  maxJobsPerRun: null, applyPickupCutoff: null, pickupCutoffHours: null, prefixRunName: null,
  postCodeMergeTo: null, runSequence: 0, bulkJobRunId: 0,
});

async function fakeGoogleMaps(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__markersCreated = 0;
    const handle = function (this: any) {
      this.setMap = () => {};
      this.setAnimation = () => {};
      this.addListener = () => ({ remove: () => {} });
      this.getPosition = () => ({ lat: () => 0, lng: () => 0 });
    };
    w.google = {
      maps: {
        Map: function (this: any) {
          this.setCenter = () => {};
          this.fitBounds = () => {};
          this.setZoom = () => {};
          this.addListener = () => {};
        },
        Marker: function (this: any) {
          w.__markersCreated += 1;
          handle.call(this);
        },
        Polyline: function (this: any) { this.setMap = () => {}; },
        LatLngBounds: function (this: any) { this.extend = () => {}; this.isEmpty = () => false; },
        InfoWindow: function () {},
        MapTypeId: { ROADMAP: 'ROADMAP' },
        Size: function () {},
        Point: function () {},
        Animation: { BOUNCE: 'BOUNCE' },
      },
    };
  });
}

// The cockpit lookups, empty but in the shapes the page reads.
async function mockCockpit(page: Page) {
  await mockEverything(page);
  await page.route(/\/api\/regions(\?.*)?$/, (r) => json(r, []));
  await page.route(/\/api\/speeds(\?.*)?$/, (r) => json(r, []));
  await page.route(/\/api\/fleets$/, (r) => json(r, { ...env, fleets: [] }));
  await page.route(/\/api\/couriers$/, (r) => json(r, { ...env, potentialCouriers: [] }));
  await page.route(/\/api\/jobs\/filters\/clients/, (r) => json(r, { ...env, response: { clients: [] } }));
  await page.route(/\/api\/jobs\/filters\/refs/, (r) => json(r, { ...env, ourRefs: [] }));
  await page.route(/\/api\/vehicle-sizes$/, (r) => json(r, { ...env, response: [] }));
  await page.route(/\/api\/runs(\?.*)?$/, (r) => json(r, { ...env, response: [], maxJsonLength: 0 }));
}

test('Refresh that brings back the same jobs does not redraw the map pins', async ({ page }) => {
  await applyUserOverride(page, { googleMapsKey: 'e2e-fake-key' });
  await fakeGoogleMaps(page);
  await mockCockpit(page);
  let jobLoads = 0;
  await page.route(/\/api\/jobs(\?.*)?$/, (r) => {
    jobLoads += 1;
    // A fresh array of fresh objects on every call, as the real API returns.
    return json(r, { ...env, bulkJobs: [job(1, '-36.90'), job(2, '-36.91'), job(3, '-36.92')] });
  });

  await page.goto('/routes');
  await expect.poll(() => page.evaluate(() => (window as any).__markersCreated)).toBe(3);

  const loadsBefore = jobLoads;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => jobLoads).toBeGreaterThan(loadsBefore);
  // Give the reload time to land and render before counting again.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).__markersCreated)).toBe(3);
});

test('Refresh that moves a pin does redraw the map', async ({ page }) => {
  await applyUserOverride(page, { googleMapsKey: 'e2e-fake-key' });
  await fakeGoogleMaps(page);
  await mockCockpit(page);
  // The dev build mounts the cockpit twice, so the first load is not one call.
  let moved = false;
  await page.route(/\/api\/jobs(\?.*)?$/, (r) => {
    const lat = moved ? '-36.95' : '-36.90';
    return json(r, { ...env, bulkJobs: [job(1, lat), job(2, '-36.91'), job(3, '-36.92')] });
  });

  await page.goto('/routes');
  await expect.poll(() => page.evaluate(() => (window as any).__markersCreated)).toBe(3);
  moved = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__markersCreated)).toBe(6);
});
