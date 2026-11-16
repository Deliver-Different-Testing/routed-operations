import { resolve } from 'node:path';
import { test, expect, type Page, type Route } from '@playwright/test';
import { applyUserOverride, mockEverything } from './fixtures/npSession';

// New Import wizard fixes from package B2 (#316, #319, #332, #333 and the
// model-state 400 message), end to end in a real browser.
//
// SCOPE. Client-side only: every /api call is intercepted, so this proves what
// the wizard shows and what it sends. The upload endpoint is mocked too, so the
// rows under test are the ones each test hands to mockWizard, not the file on
// disk (any file satisfies the picker). The server half of each rule is pinned
// by BulkImportRequestValidatorTests, BulkImportServiceV2StaffImportTests and
// BulkImportServiceV2JobFactoryTests.

const FILE = resolve(process.cwd(), 'tests/e2e/fixtures/bulk-truck/bulk-truck-ingram-like.csv');
const env = { messageId: 'x', success: true, messages: [] };
const json = (r: Route, data: unknown, status = 200) =>
  r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });

type Row = Record<string, string>;

// One NZ on-demand row with every required column filled.
const nzRow = (n: number, patch: Row = {}): Row => ({
  'Job Number': `B2-${n}`,
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

// One US on-demand row.
const usRow = (n: number, patch: Row = {}): Row => ({
  'Job Number': `B2-${n}`,
  'From Contact': 'Test Sender',
  'Pickup Address': '1 Example Way',
  'Pickup City': 'Boston',
  'Pickup ZIP': '02110',
  'Delivery Address': `${n} Sample Street`,
  City: 'Boston',
  State: 'MA',
  ZIP: '02110',
  'Delivery Contact': 'Test Receiver',
  'Delivery Phone': '000 000 0000',
  Qty: '1',
  ...patch,
});

interface Captured { body: any | null; importCalls: number }

interface Options {
  us?: boolean;
  suburbs?: unknown[];
  geocode?: (addresses: any[]) => unknown[];
  depots?: unknown[];
  importStatus?: number;
  importResponse?: unknown;
}

async function mockWizard(page: Page, rows: Row[], options: Options = {}): Promise<Captured> {
  const us = options.us ?? false;
  const captured: Captured = { body: null, importCalls: 0 };
  const client = { id: 1, code: 'EXMPL', name: 'Example Client', isUsTenant: us };
  if (us) await applyUserOverride(page, { isUsTenant: true });

  await mockEverything(page);
  await page.route(/\/api\/clients(\?.*)?$/, (r) => json(r, { ...env, isInternal: true, isUsTenant: us, clients: [client] }));
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
  await page.route(/\/api\/address\/suburbs/, (r) =>
    json(r, { ...env, suburbs: options.suburbs ?? [{ id: 1, name: 'Otahuhu', city: null, postCode: '1062', alias: null }] }));
  await page.route(/\/api\/address\/zipcodes/, (r) =>
    json(r, { ...env, zipCodes: [{ id: 1, zoneNumber: 1, zoneName: 'Central', zip: '02110', clientId: null, applyCongestion: null }] }));
  await page.route(/\/api\/address\/geocode/, (r) => {
    const addresses = r.request().postDataJSON()?.addresses ?? [];
    const answer = options.geocode
      ? options.geocode(addresses)
      : addresses.map((a: any) => ({ ...a, latitude: '-36.9', longitude: '174.8', geoType: 1 }));
    return json(r, { ...env, addresses: answer });
  });
  await page.route(/\/api\/address\/depots\/postcodes/, (r) =>
    json(r, { ...env, depots: options.depots ?? [{ id: 1, name: 'Central', postcodes: ['1062', '0624'] }] }));
  await page.route(/\/api\/address\/locations\/zipcodes/, (r) =>
    json(r, { ...env, locations: options.depots ?? [] }));
  await page.route(/\/api\/address\/zip-polygons/, (r) => json(r, { ...env, zones: [] }));
  await page.route(/\/api\/bulk-import\/import/, (r) => {
    captured.body = r.request().postDataJSON();
    captured.importCalls += 1;
    return json(r, options.importResponse ?? { ...env, clientId: 1, bookDate: '2031-01-01', speedId: 3, jobs: [] }, options.importStatus ?? 200);
  });
  return captured;
}

async function openOnDemand(page: Page) {
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

// Map Columns -> ... -> import. US and NZ name the zip / suburb and depot steps differently.
async function importAll(page: Page, us = false) {
  await next(page, us ? 'Fix Zip Codes' : 'Fix Suburbs');
  await next(page, 'Fix Addresses');
  await next(page, us ? 'Select Regions' : 'Select Depots');
  await next(page, us ? /Boston/ : /Central/);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
}

test.describe('New Import wizard (package B2)', () => {
  // #316: the operator was told about one blank record at a time.
  test('Map Columns names every record with a blank required cell', async ({ page }) => {
    await mockWizard(page, [
      nzRow(1),
      nzRow(2, { 'Delivery Contact': '' }),
      nzRow(3),
      nzRow(4),
      nzRow(5, { 'Delivery Contact': '   ' }),
    ]);
    await openOnDemand(page);
    await expect(page.getByText('To Contact is required: records 2, 5 are blank')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  });

  // #319: a quantity that is not a whole number from 1 to 32767 used to book
  // 0, a silent 1, a truncated 2, or fail the import with a 500.
  test('Map Columns refuses a quantity that is not a whole number from 1, naming the records', async ({ page }) => {
    const captured = await mockWizard(page, [
      nzRow(1),
      nzRow(2, { Qty: '0' }),
      nzRow(3, { Qty: ' ' }),
      nzRow(4, { Qty: 'abc' }),
      nzRow(5, { Qty: '2.7' }),
    ]);
    await openOnDemand(page);
    await expect(page.getByText(
      "Quantity must be a whole number from 1 to 32767: record 2 ('0'), record 4 ('abc'), record 5 ('2.7')"
    )).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    expect(captured.importCalls).toBe(0);
  });

  test('a blank quantity is sent as nothing, so the server books 1, not 0', async ({ page }) => {
    const captured = await mockWizard(page, [nzRow(1, { Qty: '  ' }), nzRow(2, { Qty: '3' })]);
    await openOnDemand(page);
    await importAll(page);
    await expect.poll(() => captured.body).not.toBeNull();
    expect(captured.body.jobs.map((j: any) => j.quantity)).toEqual([null, 3]);
  });

  // A model-state 400 named the problem but not the row.
  test('an import the server refuses with a 400 names the rows', async ({ page }) => {
    await mockWizard(page, [nzRow(1), nzRow(2), nzRow(3)], {
      importStatus: 400,
      importResponse: {
        title: 'One or more validation errors occurred.',
        status: 400,
        errors: {
          'Jobs[1].Quantity': ['Quantity must be a whole number from 1 to 32767.'],
          'Jobs[2].Quantity': ['Quantity must be a whole number from 1 to 32767.'],
        },
      },
    });
    await openOnDemand(page);
    await importAll(page);
    await expect(page.getByText(
      'Import failed: Quantity must be a whole number from 1 to 32767. (rows 2, 3)'
    ).first()).toBeVisible();
  });

  // #333: the suburbs API pads postcodes to 4 digits and the server strips
  // macrons, so neither of these rows is a real problem.
  test('Fix Suburbs accepts an alias with the leading zero dropped and a suburb written with macrons', async ({ page }) => {
    const captured = await mockWizard(page, [
      nzRow(1, { 'To Suburb': 'Devenport', 'To Post Code': '624' }),
      nzRow(2, { 'To Suburb': 'Ōtāhuhu', 'To Post Code': '1062' }),
    ], {
      suburbs: [
        { id: 1, name: 'Otahuhu', city: null, postCode: '1062', alias: null },
        { id: 2, name: 'Devonport', city: null, postCode: '0624', alias: 'Devenport' },
      ],
    });
    await openOnDemand(page);
    await next(page, 'Fix Suburbs');
    await expect(page.getByText(/Suburbs seems OK/)).toBeVisible();
    await next(page, 'Fix Addresses');
    await next(page, 'Select Depots');
    await next(page, /Central/);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect.poll(() => captured.body).not.toBeNull();
    expect(captured.body.jobs.map((j: any) => j.toSuburb)).toEqual(['Devonport', 'Otahuhu']);
  });

  // #332 US half: the geocoder's suggestion for one row is keyed by the zip
  // value, so it rewrote every row with that zip even though the zip matched a
  // depot. The sheet zip wins when it matches.
  test('US: a sheet zip that matches a depot is sent unchanged when the geocoder suggested another', async ({ page }) => {
    const captured = await mockWizard(page, [usRow(1), usRow(2)], {
      us: true,
      depots: [
        { id: 1, name: 'Boston', zipCodes: ['02110'] },
        { id: 2, name: 'Cambridge', zipCodes: ['02139'] },
      ],
      geocode: (addresses) =>
        addresses.map((a: any, i: number) => ({
          ...a,
          latitude: '42.36',
          longitude: '-71.05',
          geoType: 1,
          zipCode: '02110',
          suggestedZipCode: i === 0 ? '02139' : null,
        })),
    });
    await openOnDemand(page);
    await importAll(page, true);
    await expect.poll(() => captured.body).not.toBeNull();
    expect(captured.body.jobs.map((j: any) => j.toZipCode)).toEqual(['02110', '02110']);
  });
});
