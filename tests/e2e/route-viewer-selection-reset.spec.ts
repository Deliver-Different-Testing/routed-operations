import { test, expect, type Route } from '@playwright/test';
import { mockRouteViewerApis } from './fixtures/routeViewerMocks';

// #1002 (Kenneth, Medical prod, 4-6 Nov 2026): with a run selected, switching
// the Run List to Inbound emptied the list, but the job grid kept showing the
// previous run's jobs under "Run - (select a run)", and right-click still
// opened the job menu on them.
//
// Causes (RunViewer.tsx before the fix):
//   - the selection reset key was run date + regions only, so view mode,
//     speed, client and courier never cleared the selection;
//   - the Run Jobs query was enabled on the bare selected id, so it refetched
//     the dropped run with the new filters and rendered its rows.
//
// Rule now: no visible run selected = empty job grid and no job menu, and the
// dropped run's jobs are not fetched again.

const FILTER_KEY = 'rv-filters:0:dev@example.com';
const RUN_DATE = '2026-11-04';

const burbankToLab = {
  id: -15,
  name: 'Burbank to Lab',
  area: 'Burbank',
  suburbs: null,
  fromCities: null,
  toLocationName: null,
  velocity: 'green',
  hashKey: 'stub-hash',
  status: 'LIVE',
  jobs: 2,
  incompleteJobs: 0,
  totalPickup: 0,
  incompletePickup: 0,
  hasReturns: false,
  returnsTotal: 0,
  isMissing: false,
  preAssigned: 0,
  isActive: 1,
  courierName: null,
  courierCode: null,
  courierPercentageFormatted: null,
  courierOnlineStatus: '',
  courierOfflineMins: '',
  agentName: null,
  isNpAgent: false,
};

const delJob = (jobId: number, jobNumber: string) => ({
  bulkJobId: 0, jobId, jobNumber, jobStatus: 'D',
  clientCode: null, speedName: 'Will Call', speed: null,
  fromCompany: null, fromAddress: '1 Lab Way', fromSuburb: null,
  toCompany: null, toAddress: '2 Clinic Rd', toSuburb: null,
  bookDate: null, bookTime: null,
  pickupWindowStart: null, pickupWindowEnd: null, pickupWindow: null,
  pickedUp: null, dispatched: null, podTime: null, podName: null,
  amount: null, courierId: null, courierName: null, courierCode: null,
  contact: null, phone: null, deliverToContact: null, deliverToPhone: null,
  trackingEmail: null, proofOfDeliveryMobile: null, proofOfDeliveryEmail: null,
  notes: null, deliveryNotes: null, labelNotes: null,
  size: null, qty: null, weight: null, speedId: 423,
  ourRef: null, refA: null, refB: null,
  runName: 'Burbank to Lab', runOrder: 1, bulkRunId: -15,
  multiboxParentId: null, parentJobId: null, regionId: null, regionName: null,
  agentName: null, agentType: null, isNpAgent: false,
  pickUpLatitude: 34.18, pickUpLongitude: -118.3,
  deliveryLatitude: 33.6, deliveryLongitude: -117.7,
  toLat: 33.6, toLng: -117.7, fromPostCode: null, toPostCode: null,
  fromCity: null, toCity: 'Aliso Viejo',
});

test.describe('Route Viewer selection reset (#1002)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(({ key }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          clientIds: [],
          regionIds: [],
          speedIds: [],
          courierId: null,
          activeRegionsOnly: true,
          availableCouriersOnly: false,
          viewMode: 'Combined',
        }),
      );
    }, { key: FILTER_KEY });
  });

  test('switching to Inbound with no runs empties the job grid and closes off the job menu', async ({ page }) => {
    await mockRouteViewerApis(page, { runDate: RUN_DATE, includePalmyRun: false });

    // Combined: Burbank to Lab. Inbound: no runs (its rows are DEL legs).
    // Registered after the fixture so these win.
    await page.route(/\/api\/runviewer\/runs(\?.*)?$/, (route: Route) => {
      const group = new URL(route.request().url()).searchParams.get('group');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ response: group === 'Inbound' ? [] : [burbankToLab] }),
      });
    });
    const jobRequests: string[] = [];
    await page.route(/\/api\/runviewer\/runs\/-15\/jobs(\?.*)?$/, (route: Route) => {
      jobRequests.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ response: [delJob(20857, 'E896WILLDEL'), delJob(20866, 'E897WILLDEL')] }),
      });
    });

    await page.goto(`/route-viewer?runDate=${RUN_DATE}`);
    await page.getByRole('cell', { name: 'Burbank to Lab' }).click();
    await expect(page.getByText('E896WILLDEL')).toBeVisible();

    const requestsBeforeSwitch = jobRequests.length;
    await page.getByRole('button', { name: 'Inbound', exact: true }).click();

    // The regression: the old run's jobs stayed on screen.
    await expect(page.getByText('E896WILLDEL')).toHaveCount(0);
    await expect(page.getByText('Pick a run to see its jobs.')).toBeVisible();
    await expect(page.getByText('Run - (select a run)')).toBeVisible();

    // And the dropped run is not fetched again with the new filters.
    await page.waitForTimeout(500);
    const inboundRefetches = jobRequests
      .slice(requestsBeforeSwitch)
      .filter((u) => new URL(u).searchParams.get('group') === 'Inbound');
    expect(inboundRefetches).toEqual([]);

    // Back to Combined: the run is listed again but not re-selected.
    await page.getByRole('button', { name: 'Combined', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'Burbank to Lab' })).toBeVisible();
    await expect(page.getByText('E896WILLDEL')).toHaveCount(0);
  });
});
