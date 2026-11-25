import { resolve } from 'node:path';
import { test, expect, type Page, type Route } from '@playwright/test';
import { mockEverything } from './fixtures/npSession';

// #332 NZ (round 2): a geocoder postcode is a suggestion, not a rewrite. Fix
// Addresses used to store HERE's suggestedPostCode for every row whose sheet
// postcode differed, with no prompt, and Select Depots then grouped (and
// booked) the row under the suggested postcode. Now the operator sees
// "sheet says X, map says Y" and chooses: only an accepted value reaches
// depot grouping, and a kept sheet postcode that matches no depot lands in
// Unmatched with that reason.
//
// SCOPE. Client-side only, every /api call intercepted (same harness as
// bulk-import-b2.spec.ts).

const FILE = resolve(process.cwd(), 'tests/e2e/fixtures/bulk-truck/bulk-truck-ingram-like.csv');
const env = { messageId: 'x', success: true, messages: [] };
const json = (r: Route, data: unknown, status = 200) =>
  r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });

type Row = Record<string, string>;
const nzRow = (n: number, patch: Row = {}): Row => ({
  'Job Number': `GS-${n}`,
  'From Contact': 'Test Sender',
  'Pickup Address': '10 Example Road',
  'Pickup Suburb': 'Otahuhu',
  'Pickup Post Code': '1062',
  'Delivery Address': `${n} Sample Street`,
  'To Suburb': 'Otahuhu',
  'To Post Code': '1062',
  'Delivery Contact': 'Test Receiver',
  'Delivery Phone': '000 000 000',
  Qty: '1',
  ...patch,
});

type Depot = { id: number; name: string; postcodes: string[] };
const CENTRAL: Depot[] = [{ id: 1, name: 'Central', postcodes: ['1062'] }];

// suggest(address, sheetPostCode) -> the map's postcode, or null when it agrees.
const mapSays1062 = (_address: string, postCode: string) => (postCode === '1062' ? null : '1062');

async function mockWizard(
  page: Page,
  rows: Row[],
  depots: Depot[] = CENTRAL,
  suggest: (address: string, postCode: string) => string | null = mapSays1062,
) {
  const captured: { body: any | null; all: any[] } = { body: null, all: [] };
  const client = { id: 1, code: 'EXMPL', name: 'Example Client', isUsTenant: false };
  await mockEverything(page);
  await page.route(/\/api\/clients(\?.*)?$/, (r) => json(r, { ...env, isInternal: true, isUsTenant: false, clients: [client] }));
  await page.route(/\/api\/clients\/search/, (r) => json(r, { ...env, clients: [client] }));
  await page.route(/\/api\/clients\/\d+\/settings/, (r) =>
    json(r, {
      ...env,
      settings: {
        ...client, jobPrefix: null, contacts: [],
        speeds: [{ id: 3, name: 'Standard', code: 'STD', systemName: 'ST', isTruck: false }],
        stockSizes: [], schedules: [],
        referenceAMandatory: false, referenceAMessage: null, referenceBMandatory: false, referenceBMessage: null,
        createBulkHomeDeliveryPickup: false,
      },
    }));
  await page.route(/\/api\/bulk-import\/upload/, (r) =>
    r.fulfill({ status: 200, contentType: 'text/plain', body: JSON.stringify(rows) }));
  await page.route(/\/api\/templates/, (r) => json(r, { ...env, templates: [] }));
  await page.route(/\/api\/bulk-import\/check-references/, (r) => json(r, { ...env, errors: [] }));
  await page.route(/\/api\/bulk-import\/suburb-aliases/, (r) => json(r, { ...env, aliases: [] }));
  await page.route(/\/api\/address\/suburbs/, (r) =>
    json(r, { ...env, suburbs: [{ id: 1, name: 'Otahuhu', city: null, postCode: '1062', alias: null }] }));
  // Every address geocodes; suggest() decides the map's postcode.
  await page.route(/\/api\/address\/geocode/, (r) => {
    const addresses = r.request().postDataJSON()?.addresses ?? [];
    return json(r, {
      ...env,
      addresses: addresses.map((a: any) => ({
        ...a, latitude: '-36.9', longitude: '174.8', geoType: 1,
        suggestedPostCode: suggest(a.address, a.postCode),
      })),
    });
  });
  await page.route(/\/api\/address\/depots\/postcodes/, (r) =>
    json(r, { ...env, depots }));
  await page.route(/\/api\/address\/zip-polygons/, (r) => json(r, { ...env, zones: [] }));
  await page.route(/\/api\/bulk-import\/import/, (r) => {
    captured.body = r.request().postDataJSON();
    captured.all.push(captured.body);
    return json(r, { ...env, clientId: 1, bookDate: '2031-01-01', speedId: 3, jobs: [] });
  });
  return captured;
}

async function toFixAddresses(page: Page) {
  await page.goto('/bulk-import');
  await page.getByRole('button', { name: 'New Import' }).click();
  await page.getByPlaceholder(/Search clients/).fill('Example');
  await page.getByRole('option').first().click();
  await page.locator('input[name="importType"]').nth(1).check();
  await page.locator('input[type="file"]').setInputFiles(FILE);
  await page.getByRole('button', { name: 'Upload File', exact: true }).last().click();
  await expect(page.getByText('Map the Columns')).toBeVisible();
  await next(page, 'Fix Suburbs');
  await next(page, 'Fix Addresses');
}

async function next(page: Page, heading: string | RegExp) {
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText(heading).first()).toBeVisible();
}

test.describe('New Import: geocoder postcode is a suggestion (#332 NZ)', () => {
  test('only an accepted suggestion moves a row into a depot; a kept sheet postcode goes to Unmatched with the reason', async ({ page }) => {
    const captured = await mockWizard(page, [
      nzRow(1),
      nzRow(2, { 'To Post Code': '0614' }),
      nzRow(3, { 'To Post Code': '9999' }),
    ]);
    await toFixAddresses(page);

    // Rows 3 and 4 in the spreadsheet (header is row 1).
    const row3 = page.getByTestId('geocode-suggestion-pc-1');
    const row4 = page.getByTestId('geocode-suggestion-pc-2');
    await expect(row3).toContainText('Row 3: postcode - sheet says 0614, map says 1062');
    await expect(row4).toContainText('Row 4: postcode - sheet says 9999, map says 1062');
    await row3.getByRole('button', { name: 'Accept' }).click();
    await row4.getByRole('button', { name: 'Keep sheet' }).click();

    await next(page, 'Select Depots');
    await expect(page.getByText('Central ( 0 of 2 jobs imported )')).toBeVisible();
    await expect(page.getByText('Unmatched ( 0 of 1 jobs imported )')).toBeVisible();
    await page.getByRole('button', { name: 'View / export' }).click();
    await expect(page.getByText('Sheet postcode 9999 kept (map says 1062); not covered by any depot')).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();

    await next(page, /Central/);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect.poll(() => captured.body).not.toBeNull();
    expect(captured.body.jobs.map((j: any) => j.toPostCode)).toEqual(['1062', '1062']);
  });

  // Behaviour only: the operator walks straight past Fix Addresses. Before the
  // fix the suggestion was applied silently and row 3 joined Central.
  test('an undecided suggestion is not applied', async ({ page }) => {
    await mockWizard(page, [nzRow(1), nzRow(2, { 'To Post Code': '0614' })]);
    await toFixAddresses(page);
    await expect(page.getByText(/Addresses seems OK|map says/).first()).toBeVisible();
    await next(page, 'Select Depots');
    await expect(page.getByText('Central ( 0 of 1 jobs imported )')).toBeVisible();
    await expect(page.getByText('Unmatched ( 0 of 1 jobs imported )')).toBeVisible();
    await page.getByRole('button', { name: 'View / export' }).click();
    await expect(page.getByText('Map says 1062: accept it in Fix Addresses to use it')).toBeVisible();
  });

  // Browser test 23 Nov: the sheet postcode 1062 already matched a depot, so
  // Select Depots ignored the accepted 1010 and the job was booked as 1062.
  test('an accepted postcode is used even when the sheet postcode also matches a depot', async ({ page }) => {
    const captured = await mockWizard(
      page,
      [nzRow(1), nzRow(2)],
      [
        { id: 1, name: 'Central', postcodes: ['1062'] },
        { id: 2, name: 'Auckland CBD', postcodes: ['1010'] },
      ],
      (address) => (address === '2 Sample Street' ? '1010' : null),
    );
    await toFixAddresses(page);
    const row3 = page.getByTestId('geocode-suggestion-pc-1');
    await expect(row3).toContainText('Row 3: postcode - sheet says 1062, map says 1010');
    await row3.getByRole('button', { name: 'Accept' }).click();

    await next(page, 'Select Depots');
    await expect(page.getByText('Auckland CBD ( 0 of 1 jobs imported )')).toBeVisible();
    await expect(page.getByText('Central ( 0 of 1 jobs imported )')).toBeVisible();

    // One step per depot, then import.
    const toPostCodes = () =>
      Object.fromEntries(captured.all.flatMap((b) => b.jobs).map((j: any) => [j.toAddress, j.toPostCode]));
    for (let i = 0; i < 6 && Object.keys(toPostCodes()).length < 2; i++) {
      const speed = page.getByRole('combobox', { name: 'Speed' });
      if ((await speed.count()) && !(await speed.inputValue())) await speed.selectOption({ label: 'Standard' });
      const bookTime = page.getByRole('textbox', { name: 'Book Time' });
      if ((await bookTime.count()) && !(await bookTime.inputValue())) await bookTime.fill('09:00');
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await page.waitForTimeout(300);
    }
    const byJob = toPostCodes();
    expect(byJob).toEqual({ '1 Sample Street': '1062', '2 Sample Street': '1010' });
  });
});
