import { test, expect, type Route } from '@playwright/test';
import { mockRouteViewerApis } from './fixtures/routeViewerMocks';

// #897: Scan Manager (Routed mode) rendered every leg chip and most Stage
// pills grey. The procs emit lowercase leg states
// (completed | exception | picked | packed | pending) and Stage phrases built
// from the CurrentLeg's state; the front end only knew legacy uppercase codes.
//
// This spec drives the real page against a mocked /api/runviewer/scans/routed
// payload shaped like RVW_stpScanJobsRouted output (Legs is a JSON string,
// CurrentLeg names the first non-completed leg), and the item-progress panel
// against a payload shaped like RVW_stpScanManagerItemProgress.

const RUN_DATE = '2026-11-06';
const wrap = (data: unknown) => ({ response: data });

const legs = (states: Array<[string, string]>) =>
  JSON.stringify(states.map(([Leg, State]) => ({ Leg, State, LinehaulRunId: null, LinehaulRunName: null })));

const ROUTED_ROWS = [
  {
    jobId: 9001, bulkJobId: 0, jobNumber: 'ZZ9001', clientCode: 'ZZC', toAddress: 'x', suburb: 'y', companyName: null,
    stage: 'LH2 - in transit', currentLeg: 'LH2', itemCount: 1, scannedItems: 1, expectedItems: 1,
    legs: legs([['LHP', 'completed'], ['LH1', 'completed'], ['LH2', 'picked'], ['LH3', 'pending'], ['DEL', 'pending']]),
    hasShort: false, isDivergent: false,
  },
  {
    jobId: 9002, bulkJobId: 0, jobNumber: 'ZZ9002', clientCode: 'ZZC', toAddress: 'x', suburb: 'y', companyName: null,
    stage: 'LH1 - exception', currentLeg: 'LH1', itemCount: 1, scannedItems: 0, expectedItems: 1,
    legs: legs([['LHP', 'completed'], ['LH1', 'exception'], ['DEL', 'pending']]),
    hasShort: false, isDivergent: false,
  },
  {
    jobId: 9003, bulkJobId: 0, jobNumber: 'ZZ9003', clientCode: 'ZZC', toAddress: 'x', suburb: 'y', companyName: null,
    stage: 'LH1 - staged at depot', currentLeg: 'LH1', itemCount: 1, scannedItems: 1, expectedItems: 1,
    legs: legs([['LHP', 'completed'], ['LH1', 'packed'], ['DEL', 'pending']]),
    hasShort: false, isDivergent: false,
  },
  {
    jobId: 9004, bulkJobId: 0, jobNumber: 'ZZ9004', clientCode: 'ZZC', toAddress: 'x', suburb: 'y', companyName: null,
    stage: 'Awaiting LHP pickup', currentLeg: 'LHP', itemCount: 1, scannedItems: 0, expectedItems: 1,
    legs: legs([['LHP', 'pending'], ['LH1', 'pending'], ['DEL', 'pending']]),
    hasShort: false, isDivergent: false,
  },
];

const ITEM_PROGRESS_9001 = [
  ['LHP', 'completed', false], ['LH1', 'completed', false], ['LH2', 'picked', true], ['LH3', 'pending', false], ['DEL', 'pending', false],
].map(([leg, state, isCurrent]) => ({
  jobId: 9001, itemBarcode: 'ZZ9001-1', leg, state, tote: null, isCurrent, scanTime: null,
}));

test.describe('Scan Manager routed chips (#897)', () => {
  test.beforeEach(async ({ page }) => {
    await mockRouteViewerApis(page, { runDate: RUN_DATE, includePalmyRun: false });
    await page.route(/\/api\/runviewer\/scans\/routed(\?.*)?$/, (route: Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wrap(ROUTED_ROWS)) }),
    );
    await page.route(/\/api\/runviewer\/scans\/item-progress(\?.*)?$/, (route: Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wrap(ITEM_PROGRESS_9001)) }),
    );
  });

  test('leg chips, stage pills and item chips take the proc state colours; current leg is ringed', async ({ page }) => {
    await page.goto('/route-viewer/scans');
    await page.getByRole('button', { name: 'Routed', exact: true }).click();

    const row = (jobNumber: string) => page.locator('tr', { has: page.getByRole('cell', { name: jobNumber, exact: true }) });
    const legChip = (jobNumber: string, leg: string) => row(jobNumber).getByTitle(new RegExp(`^${leg}: `));
    const stage = (jobNumber: string) => row(jobNumber).getByTestId('sm-stage-swatch');

    await expect(row('ZZ9001')).toBeVisible();

    // Leg chip colours per state.
    await expect(legChip('ZZ9001', 'LHP')).toHaveClass(/bg-emerald-100/);
    await expect(legChip('ZZ9001', 'LH2')).toHaveClass(/bg-amber-100/);
    await expect(legChip('ZZ9001', 'LH3')).toHaveClass(/bg-slate-100/);
    await expect(legChip('ZZ9002', 'LH1')).toHaveClass(/bg-red-100/);
    await expect(legChip('ZZ9003', 'LH1')).toHaveClass(/bg-amber-100/);

    // Current leg ring: only on the CurrentLeg chip.
    await expect(legChip('ZZ9001', 'LH2')).toHaveClass(/ring-brand-cyan/);
    await expect(legChip('ZZ9001', 'LH1')).not.toHaveClass(/ring-brand-cyan/);
    await expect(legChip('ZZ9001', 'DEL')).not.toHaveClass(/ring-brand-cyan/);

    // Stage pills follow the CurrentLeg's state.
    await expect(stage('ZZ9001')).toHaveClass(/bg-amber-100/);
    await expect(stage('ZZ9002')).toHaveClass(/bg-red-100/);
    await expect(stage('ZZ9003')).toHaveClass(/bg-amber-100/);
    await expect(stage('ZZ9004')).toHaveClass(/bg-slate-100/);

    // Item chips in the expanded panel use the same state colours.
    await row('ZZ9001').getByRole('button', { name: 'Expand' }).click();
    const itemChip = (leg: string) => page.locator('tr', { has: page.getByRole('cell', { name: 'ZZ9001-1', exact: true }) }).getByTitle(new RegExp(`^${leg}: `));
    await expect(itemChip('LHP')).toHaveClass(/bg-emerald-100/);
    await expect(itemChip('LH2')).toHaveClass(/bg-amber-100/);
    await expect(itemChip('LH2')).toHaveClass(/ring-brand-cyan/);
    await expect(itemChip('DEL')).toHaveClass(/bg-slate-100/);
  });
});
