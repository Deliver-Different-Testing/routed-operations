import { resolve } from 'node:path';
import { test, expect, type Page, type Route } from '@playwright/test';
import { mockEverything } from './fixtures/npSession';

// #333 (round 2): the suburb an operator picks in Fix Suburbs is remembered
// for the client. The next file for that client with the same sheet suburb
// is not asked again; the fix is shown as remembered, applied to the import,
// and can be cleared from the pop-up, after which the pick is asked again.
//
// SCOPE. Client-side only, every /api call intercepted. The alias endpoints
// are backed by an in-test store so "the next import" sees what the first
// one saved, as the real tblBulkSuburbAlias would.

const FILE = resolve(process.cwd(), 'tests/e2e/fixtures/bulk-truck/bulk-truck-ingram-like.csv');
const env = { messageId: 'x', success: true, messages: [] };
const json = (r: Route, data: unknown, status = 200) =>
  r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });

const rows = [
  {
    'Job Number': 'SM-1',
    'From Contact': 'Test Sender',
    'Pickup Address': '10 Example Road',
    'Pickup Suburb': 'Otahuhu',
    'Pickup Post Code': '1062',
    'Delivery Address': '1 Sample Street',
    'To Suburb': 'Otahoohoo',
    'To Post Code': '1062',
    'Delivery Contact': 'Test Receiver',
    'Delivery Phone': '000 000 000',
    Qty: '1',
  },
  // B5: 'Mt Eden' is tucSuburb 'Mount Eden' under the shared normaliser, so
  // it is never asked and books as 'Mount Eden'.
  {
    'Job Number': 'SM-2',
    'From Contact': 'Test Sender',
    'Pickup Address': '10 Example Road',
    'Pickup Suburb': 'Otahuhu',
    'Pickup Post Code': '1062',
    'Delivery Address': '2 Sample Street',
    'To Suburb': 'Mt Eden',
    'To Post Code': '1024',
    'Delivery Contact': 'Test Receiver',
    'Delivery Phone': '000 000 000',
    Qty: '1',
  },
];

interface Alias {
  id: number; clientId: number | null; rawSuburb: string; rawPostCode: string | null;
  suburbId: number; suburbName: string | null; postCode: string | null;
}

async function mockWizard(page: Page, store: { aliases: Alias[]; posts: any[]; deletes: number[]; imports: any[] }) {
  const client = { id: 1, code: 'EXMPL', name: 'Example Client', isUsTenant: false };
  const suburbs = [
    { id: 11, name: 'Otahuhu', city: null, postCode: '1062', alias: null },
    { id: 12, name: 'Ponsonby', city: null, postCode: '1011', alias: null },
    { id: 13, name: 'Mount Eden', city: null, postCode: '1024', alias: null },
  ];
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
  await page.route(/\/api\/bulk-import\/suburb-aliases/, (r) => {
    const method = r.request().method();
    if (method === 'GET') {
      const clientId = Number(new URL(r.request().url()).searchParams.get('clientId'));
      return json(r, { ...env, aliases: store.aliases.filter((a) => a.clientId === clientId || a.clientId === null) });
    }
    if (method === 'POST') {
      const body = r.request().postDataJSON();
      store.posts.push(body);
      const s = suburbs.find((x) => x.id === body.suburbId)!;
      const saved: Alias = {
        id: store.aliases.length + 100, clientId: body.clientId,
        rawSuburb: String(body.rawSuburb).toLowerCase(), rawPostCode: body.rawPostCode,
        suburbId: s.id, suburbName: s.name, postCode: s.postCode,
      };
      store.aliases.push(saved);
      return json(r, { ...env, alias: saved });
    }
    const id = Number(r.request().url().split('/').pop());
    store.deletes.push(id);
    store.aliases = store.aliases.filter((a) => a.id !== id);
    return json(r, env);
  });
  await page.route(/\/api\/address\/suburbs/, (r) => json(r, { ...env, suburbs }));
  await page.route(/\/api\/address\/geocode/, (r) => {
    const addresses = r.request().postDataJSON()?.addresses ?? [];
    return json(r, {
      ...env,
      addresses: addresses.map((a: any) => ({ ...a, latitude: '-36.9', longitude: '174.8', geoType: 1, suggestedPostCode: null })),
    });
  });
  await page.route(/\/api\/address\/depots\/postcodes/, (r) =>
    json(r, { ...env, depots: [{ id: 1, name: 'Central', postcodes: ['1062', '1024'] }] }));
  await page.route(/\/api\/address\/zip-polygons/, (r) => json(r, { ...env, zones: [] }));
  await page.route(/\/api\/bulk-import\/import/, (r) => {
    store.imports.push(r.request().postDataJSON());
    return json(r, { ...env, clientId: 1, bookDate: '2031-01-01', speedId: 3, jobs: [] });
  });
}

async function next(page: Page, heading: string | RegExp) {
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText(heading).first()).toBeVisible();
}

async function toFixSuburbs(page: Page) {
  await page.goto('/bulk-import');
  await page.getByRole('button', { name: 'New Import' }).click();
  await page.getByPlaceholder(/Search clients/).fill('Example');
  await page.getByRole('option').first().click();
  await page.locator('input[name="importType"]').nth(1).check();
  await page.locator('input[type="file"]').setInputFiles(FILE);
  await page.getByRole('button', { name: 'Upload File', exact: true }).last().click();
  await expect(page.getByText('Map the Columns')).toBeVisible();
  await next(page, 'Fix Suburbs');
}

async function finishImport(page: Page) {
  await next(page, 'Fix Addresses');
  await next(page, 'Select Depots');
  await next(page, /Central/);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
}

const pickRow = (page: Page) => page.locator('div.grid', { hasText: 'Otahoohoo (1062)' });

test.describe('New Import: a chosen suburb fix is remembered for the client (#333)', () => {
  test('a chosen fix is not asked again for that client, and can be cleared', async ({ page }) => {
    const store = { aliases: [] as Alias[], posts: [] as any[], deletes: [] as number[], imports: [] as any[] };
    await mockWizard(page, store);

    // First file: the operator is asked and picks Otahuhu.
    await toFixSuburbs(page);
    // 'Mt Eden' matches 'Mount Eden' with no pop-up row; only Otahoohoo is asked.
    await expect(page.locator('div.grid', { hasText: 'Mt Eden (1024)' })).toHaveCount(0);
    await expect(page.locator('div.grid select')).toHaveCount(1);
    await pickRow(page).locator('select').selectOption('Otahuhu');
    await expect.poll(() => store.posts.length).toBe(1);
    expect(store.posts[0]).toMatchObject({ clientId: 1, rawSuburb: 'Otahoohoo', rawPostCode: '1062', suburbId: 11 });
    await finishImport(page);
    await expect.poll(() => store.imports.length).toBe(1);
    expect(store.imports[0].jobs.map((j: any) => j.toSuburb)).toEqual(['Otahuhu', 'Mount Eden']);

    // Second file for the same client: not asked, shown as remembered, applied.
    await toFixSuburbs(page);
    await expect(page.getByTestId('remembered-fix-otahoohoo|1062')).toContainText('Otahoohoo (1062) -> Otahuhu');
    await expect(pickRow(page).locator('select')).toHaveCount(0);
    await finishImport(page);
    await expect.poll(() => store.imports.length).toBe(2);
    expect(store.imports[1].jobs.map((j: any) => j.toSuburb)).toEqual(['Otahuhu', 'Mount Eden']);
    expect(store.posts).toHaveLength(1);

    // Third file: the operator clears the fix, and is asked again.
    await toFixSuburbs(page);
    await page.getByTestId('remembered-fix-otahoohoo|1062').getByRole('button', { name: 'Forget' }).click();
    await expect.poll(() => store.deletes).toEqual([100]);
    await expect(pickRow(page).locator('select')).toHaveValue('');
  });
});
