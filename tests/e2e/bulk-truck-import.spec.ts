import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page, type Route } from '@playwright/test';
import { mockEverything } from './fixtures/npSession';

// Truck rows through the New Import wizard, end to end in a real browser, using
// the synthetic Ingram-like file in fixtures/bulk-truck.
//
// SCOPE. Client-side only: every /api call is intercepted, so this proves what
// the wizard shows and what it sends. Pricing and inserts are not exercised.
// The rejected rows in the response are the ones the server is expected to
// refuse for that file, which BulkTruckRoutingTests pins on the backend side.
// BulkTruckPreviewTests pins that the preview's price is the inserted price.

const FILE = resolve(process.cwd(), 'tests/e2e/fixtures/bulk-truck/bulk-truck-ingram-like.csv');

function parseFixture(): Record<string, string>[] {
  const [head, ...lines] = readFileSync(FILE, 'utf8').trim().split(/\r?\n/).map((l) => l.split(','));
  return lines.map((cells) => Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ''])));
}

const env = { messageId: 'x', success: true, messages: [] };
const REJECTED_REASON_REGION = 'Pickup (Otahuhu) and delivery (Hornby) are in different regions. Truck jobs must stay within one region, so this row was not imported.';
const json = (r: Route, data: unknown) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });

const SPEEDS = [
  { id: 3, name: 'Standard', code: 'STD', systemName: 'ST', isTruck: false },
  { id: 43, name: 'Truck Standard', code: 'TSTD', systemName: 'TS', isTruck: true },
  { id: 52, name: 'Truck Economy', code: 'TECO', systemName: 'TY', isTruck: true },
];

interface Imported { body: any | null; preview: any | null; previewCalls: number; importCalls: number }

const previewRow = (patch: Record<string, unknown>) => ({
  rowIndex: 0, jobNumber: 'BT1001', speedName: 'Truck Economy', fromSuburb: 'Otahuhu', toSuburb: 'Onehunga', quantity: 1,
  rate: 41.43, fuel: 3.07, amount: 44.5, ratedManually: false, wouldImport: true, reason: null, warning: null,
  ...patch,
});
const refusedRow = (patch: Record<string, unknown>) =>
  previewRow({ rate: null, fuel: null, amount: null, wouldImport: false, ...patch });

// The rows the wizard is expected to show for the fixture.
const PREVIEW = {
  ...env,
  otherRowCount: 1,
  rows: [
    previewRow({}),
    previewRow({ rowIndex: 1, jobNumber: 'BT1002', rate: null, fuel: null, amount: 88, ratedManually: true }),
    refusedRow({ rowIndex: 5, jobNumber: 'BT1006', toSuburb: 'Hornby', reason: REJECTED_REASON_REGION }),
    refusedRow({ rowIndex: 6, jobNumber: 'BT1007', reason: 'Chilled Truck cannot be bulk imported yet. Book this job on the booking page.' }),
  ],
};

async function mockWizardApis(
  page: Page,
  speeds: unknown[],
  importResponse: Record<string, unknown>,
  options: { importStatus?: number; preview?: Record<string, unknown>; previewStatus?: number } = {}
): Promise<Imported> {
  const rows = parseFixture();
  const postcodes = Array.from(new Set(rows.flatMap((r) => [r['To Post Code'], r['Pickup Post Code']])));
  const imported: Imported = { body: null, preview: null, previewCalls: 0, importCalls: 0 };

  await mockEverything(page);
  await page.route(/\/api\/clients(\?.*)?$/, (r) =>
    json(r, { ...env, isInternal: true, isUsTenant: false, clients: [{ id: 1, code: 'EXMPL', name: 'Example Client', isUsTenant: false }] }));
  await page.route(/\/api\/clients\/search/, (r) =>
    json(r, { ...env, clients: [{ id: 1, code: 'EXMPL', name: 'Example Client', isUsTenant: false }] }));
  await page.route(/\/api\/clients\/\d+\/settings/, (r) =>
    json(r, {
      ...env,
      settings: {
        id: 1, code: 'EXMPL', name: 'Example Client', jobPrefix: null, isUsTenant: false, contacts: [],
        speeds,
        stockSizes: [{ id: 1, name: 'Half Pallet', length: 120, width: 100, height: 90, weight: 250 }],
        schedules: [],
        referenceAMandatory: false, referenceAMessage: null, referenceBMandatory: false, referenceBMessage: null,
        createBulkHomeDeliveryPickup: false,
      },
    }));
  await page.route(/\/api\/bulk-import\/upload/, (r) =>
    r.fulfill({ status: 200, contentType: 'text/plain', body: JSON.stringify(rows) }));
  await page.route(/\/api\/templates/, (r) => json(r, { ...env, templates: [] }));
  await page.route(/\/api\/address\/suburbs/, (r) =>
    json(r, { ...env, suburbs: rows.map((row, id) => ({ id, name: row['To Suburb'], city: null, postCode: row['To Post Code'], alias: null })) }));
  await page.route(/\/api\/address\/geocode/, (r) =>
    json(r, { ...env, addresses: rows.map((row) => ({ address: row['Delivery Address'], suburb: row['To Suburb'], postCode: row['To Post Code'], latitude: '-36.9', longitude: '174.8', geoType: 1 })) }));
  await page.route(/\/api\/address\/depots\/postcodes/, (r) =>
    json(r, { ...env, depots: [{ id: 1, name: 'Central', postcodes }] }));
  await page.route(/\/api\/bulk-import\/truck-preview/, (r) => {
    imported.preview = r.request().postDataJSON();
    imported.previewCalls += 1;
    return r.fulfill({
      status: options.previewStatus ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(options.preview ?? PREVIEW),
    });
  });
  await page.route(/\/api\/bulk-import\/import/, (r) => {
    imported.body = r.request().postDataJSON();
    imported.importCalls += 1;
    return r.fulfill({ status: options.importStatus ?? 200, contentType: 'application/json', body: JSON.stringify(importResponse) });
  });
  return imported;
}

async function openOnDemandFile(page: Page) {
  await page.goto('/bulk-import');
  await page.getByRole('button', { name: 'New Import' }).click();
  await page.getByPlaceholder(/Search clients/).fill('Example');
  await page.getByRole('option').first().click();
  await page.locator('input[name="importType"]').nth(1).check();
  await page.locator('input[type="file"]').setInputFiles(FILE);
  await page.getByRole('button', { name: 'Upload File', exact: true }).last().click();
  await expect(page.getByText('Map the Columns')).toBeVisible();
}

async function next(page: Page, heading: string | RegExp) {
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText(heading).first()).toBeVisible();
}

const REJECTED = [
  { jobNumber: 'BT1006', toAddress: '70 Distant Road', toSuburb: 'Hornby', toPostCode: '8042', truckRejected: true, errorMessage: 'Pickup (Otahuhu) and delivery (Hornby) are in different regions. Truck jobs must stay within one region, so this row was not imported.' },
  { jobNumber: 'BT1007', toAddress: '80 Frosty Way', toSuburb: 'Onehunga', toPostCode: '1061', truckRejected: true, errorMessage: 'No truck rate for Chilled Truck from Otahuhu to Onehunga. The row was not imported.' },
];

test.describe('Truck rows in the bulk import wizard', () => {
  test('a file with truck speeds shows the truck fields, sends them, and lists refused rows with reasons', async ({ page }) => {
    const imported = await mockWizardApis(page, SPEEDS, { ...env, clientId: 1, bookDate: '2031-01-01', speedId: 3, jobs: REJECTED });

    await openOnDemandFile(page);

    // The Speed column names truck speeds, so the truck fields appear unasked.
    await expect(page.getByTestId('truck-jobs-toggle')).toBeChecked();
    await expect(page.getByText('Weight (per pallet)').first()).toBeVisible();
    await expect(page.getByLabel('Map Tail Lift DO')).toHaveValue('Tail Lift DO');
    await expect(page.getByLabel('Map Total Weight')).toHaveValue('');

    await next(page, 'Fix Suburbs');
    await next(page, 'Fix Addresses');
    await next(page, 'Select Depots');
    await next(page, /Central/);

    await expect(page.getByTestId('truck-defaults')).toBeVisible();
    await page.getByLabel('Default pallet type').selectOption('Half Pallet');
    await page.getByLabel('Tail lift at delivery').check();
    await page.locator('#sp-speed').selectOption('3');
    await page.getByRole('button', { name: 'Next', exact: true }).click();

    // Prices and refusals are on screen, and nothing has been imported yet.
    await expect(page.getByText('Check Truck Prices')).toBeVisible();
    expect(imported.importCalls).toBe(0);
    const previewRows = page.getByTestId('truck-preview-row');
    await expect(previewRows).toHaveCount(4);
    await expect(previewRows.nth(0)).not.toHaveAttribute('data-rejected');
    await expect(previewRows.nth(0).getByTestId('truck-preview-price')).toContainText('44.50');
    await expect(previewRows.nth(1).getByTestId('truck-preview-manual')).toHaveText('Rated manually');
    await expect(previewRows.nth(1).getByTestId('truck-preview-price')).toContainText('88.00');
    await expect(previewRows.nth(2)).toHaveAttribute('data-rejected', 'true');
    await expect(previewRows.nth(2).getByTestId('truck-preview-reason')).toContainText('different regions');
    await expect(previewRows.nth(3)).toHaveAttribute('data-rejected', 'true');
    await expect(page.getByTestId('truck-preview-total')).toContainText('132.50');
    await expect(page.getByTestId('truck-preview-rejected-count')).toHaveText('2');
    await expect(page.getByTestId('truck-preview-other')).toContainText('1 other job is not on a truck speed');

    // It asked about the same rows it is about to import.
    expect(imported.preview.truckDefaults).toMatchObject({ palletType: 'Half Pallet', tailLiftDropoff: true });

    await page.getByRole('button', { name: 'Import 3 jobs' }).click();

    // Refused rows reach the summary with their reasons, not km-rated review.
    await expect(page.getByText(/Import Summary/)).toBeVisible();
    const reasons = page.getByTestId('summary-reason');
    await expect(reasons).toHaveCount(2);
    await expect(reasons.first()).toContainText('different regions');
    await expect(reasons.nth(1)).toContainText('No truck rate');
    await expect(page.getByText(/Confirm km-rated jobs/)).toHaveCount(0);

    const body = imported.body;
    expect(body.jobs).toEqual(imported.preview.jobs);
    expect(body.truckDefaults).toMatchObject({ palletType: 'Half Pallet', tailLiftDropoff: true });
    const byNumber = (n: string) => body.jobs.find((j: any) => j.jobNumber === n);
    expect(byNumber('BT1001')).toMatchObject({ speed: 'TECO', palletType: 'Half Pallet', weight: 250, quantity: 1 });
    expect(byNumber('BT1004')).toMatchObject({ tailLiftDropoff: true, residential: true });
    expect(byNumber('BT1005')).toMatchObject({ dgClass: 3 });
  });

  test('going back and changing the book date prices the rows again', async ({ page }) => {
    const imported = await mockWizardApis(page, SPEEDS, { ...env, clientId: 1, bookDate: '2031-01-01', speedId: 3, jobs: [] });

    await openOnDemandFile(page);
    await next(page, 'Fix Suburbs');
    await next(page, 'Fix Addresses');
    await next(page, 'Select Depots');
    await next(page, /Central/);
    await page.locator('#sp-speed').selectOption('52');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText('Check Truck Prices')).toBeVisible();

    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.locator('#sp-speed')).toBeVisible();
    const firstDate = imported.preview.bookDate;
    const picked = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    await page.locator('#sp-book-date').fill(picked);
    await page.getByRole('button', { name: 'Next', exact: true }).click();

    await expect(page.getByText('Check Truck Prices')).toBeVisible();
    expect(imported.previewCalls).toBe(2);
    expect(imported.preview.bookDate).not.toBe(firstDate);
    expect(imported.importCalls).toBe(0);
  });

  test('when the prices cannot be checked nothing is imported and the reason stays on screen', async ({ page }) => {
    const imported = await mockWizardApis(page, SPEEDS, { ...env, jobs: [] }, {
      previewStatus: 400,
      preview: { messageId: 'x', success: false, messages: [{ message: 'Invalid client.' }] },
    });

    await openOnDemandFile(page);
    await next(page, 'Fix Suburbs');
    await next(page, 'Fix Addresses');
    await next(page, 'Select Depots');
    await next(page, /Central/);
    await page.locator('#sp-speed').selectOption('52');
    await page.getByRole('button', { name: 'Next', exact: true }).click();

    await expect(page.getByTestId('sp-truck-preview-error')).toContainText('Invalid client.');
    expect(imported.importCalls).toBe(0);
  });

  // The server answers 400 when no row lands, as HandleBulkResponse does for any
  // Success = false, so this mock has to as well to prove the real path.
  test('when every row is refused the operator still gets the summary, not a one-line failure', async ({ page }) => {
    await mockWizardApis(page, SPEEDS, {
      messageId: 'x', success: false,
      messages: [{ message: 'Failed to create any of the 2 job(s). See per-job reasons below.' }],
      jobs: REJECTED,
    }, {
      importStatus: 400,
      preview: { ...env, otherRowCount: 0, rows: [refusedRow({ rowIndex: 5, reason: REJECTED_REASON_REGION }), refusedRow({ rowIndex: 6, reason: 'No truck rate' })] },
    });

    await openOnDemandFile(page);
    await next(page, 'Fix Suburbs');
    await next(page, 'Fix Addresses');
    await next(page, 'Select Depots');
    await next(page, /Central/);
    await page.locator('#sp-speed').selectOption('52');
    await page.getByRole('button', { name: 'Next', exact: true }).click();

    await expect(page.getByTestId('truck-preview-rejected-count')).toHaveText('2');
    await page.getByRole('button', { name: 'Import 0 jobs' }).click();

    await expect(page.getByText(/Import Summary/)).toBeVisible();
    await expect(page.getByTestId('summary-reason')).toHaveCount(2);
  });

  test('a client with no truck speeds sees and sends nothing new', async ({ page }) => {
    const imported = await mockWizardApis(page, [SPEEDS[0]], { ...env, clientId: 1, bookDate: '2031-01-01', speedId: 3, jobs: [] });

    await openOnDemandFile(page);

    await expect(page.getByTestId('truck-jobs-toggle')).toHaveCount(0);
    await expect(page.getByLabel('Map Tail Lift DO')).toHaveCount(0);
    await expect(page.getByLabel('Map Speed')).toHaveCount(0);

    await next(page, 'Fix Suburbs');
    await next(page, 'Fix Addresses');
    await next(page, 'Select Depots');
    await next(page, /Central/);
    await expect(page.getByTestId('truck-defaults')).toHaveCount(0);
    await page.getByRole('button', { name: 'Next', exact: true }).click();

    await expect.poll(() => imported.body).not.toBeNull();
    expect(imported.previewCalls).toBe(0);
    await expect(page.getByText('Check Truck Prices')).toHaveCount(0);
    expect(imported.body.truckDefaults).toBeUndefined();
    for (const job of imported.body.jobs) {
      expect(job.speed).toBeUndefined();
      expect(job.palletType).toBeUndefined();
      expect(job.tailLiftDropoff).toBeUndefined();
    }
  });
});
