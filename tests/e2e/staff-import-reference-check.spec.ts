import { test, expect, type Page, type Route } from '@playwright/test';
import { mockEverything, applyUserOverride } from './fixtures/npSession';

// Staff Import's client reference check, in a real browser.
//
// SCOPE. Client-side only: every /api call is intercepted, so this proves the
// operator sees each refused row before Confirm and on the result screen, and that
// the check is sent the right columns. The rule itself is pinned on the backend by
// ClientReferenceRuleTests and BulkP2PJobPinTests.

const env = { messageId: 'x', success: true, messages: [] };
const json = (r: Route, data: unknown, status = 200) =>
  r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });

const REQUIRE_A = 'Require "Reference A" - "cat"';
const NOT_IN_LIST_B = '"Reference B" - "NOPE" not in defined list.';

const FILE_ROWS = [
  { ClientID: '1', JobNumber: 'REFCHK1', 'Ref B': 'NOPE', FromSuburb: 'Newton', ToSuburb: 'Ponsonby' },
  { ClientID: '1', JobNumber: 'REFCHK2', 'Ref A': 'PO1', FromSuburb: 'Newton', ToSuburb: 'Ponsonby' },
];

async function openStaffPreview(page: Page, errors: { rowNumber: number; error: string }[]) {
  const check: { body: { rows: Record<string, unknown>[] } | null } = { body: null };
  await mockEverything(page);
  await applyUserOverride(page, { isInternal: true, clientTypeId: '4' });
  await page.route(/\/api\/bulk-import\/upload/, (r) =>
    r.fulfill({ status: 200, contentType: 'text/plain', body: JSON.stringify(FILE_ROWS) }));
  await page.route(/\/api\/bulk-import\/reference-check/, (r) => {
    check.body = r.request().postDataJSON();
    return json(r, { ...env, errors });
  });
  await page.route(/\/api\/address\/suburbs/, (r) => json(r, { ...env, suburbs: [] }));
  await page.route(/\/api\/address\/geocode/, (r) => json(r, { ...env, addresses: [] }));

  await page.goto('/bulk-import');
  await page.getByRole('button', { name: 'Staff Import' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'staff.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('ClientID,JobNumber\n1,REFCHK1\n'),
  });
  await page.getByRole('button', { name: 'Parse File' }).click();
  await expect(page.getByText(/Parsed 2 rows/)).toBeVisible();
  return check;
}

test.describe('Staff Import client reference check', () => {
  test('lists refused rows before Confirm, lets the rest through, and shows the reasons again after', async ({ page }) => {
    const check = await openStaffPreview(page, [{ rowNumber: 1, error: `${REQUIRE_A}\r\n${NOT_IN_LIST_B}` }]);

    expect(check.body?.rows).toEqual([
      { rowNumber: 1, clientId: 1, clientCode: null, referenceA: '', referenceB: 'NOPE' },
      { rowNumber: 2, clientId: 1, clientCode: null, referenceA: 'PO1', referenceB: '' },
    ]);
    await expect(page.getByTestId('staff-reference-notice')).toHaveText('1 row will be refused. The other 1 will import.');
    const table = page.getByTestId('staff-reference-errors');
    await expect(table).toContainText('REFCHK1');
    await expect(table).toContainText(REQUIRE_A);
    await expect(table).toContainText(NOT_IN_LIST_B);

    await page.route(/\/api\/bulk-import\/staff-import/, (r) =>
      json(r, {
        ...env,
        messages: [{ message: 'Import completed with 1 failed jobs out of 2 total.' }],
        successCount: 1,
        failedCount: 1,
        failedJobs: [{ rowNumber: 1, jobNumber: 'REFCHK1', error: REQUIRE_A }],
      }));
    for (const heading of [/Suburbs seems OK/, /Addresses seems OK/, /Confirm Staff Import/]) {
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(page.getByText(heading)).toBeVisible();
    }
    await expect(page.getByText('Rows that will be refused: 1')).toBeVisible();
    await page.getByRole('button', { name: 'Import 1 Jobs' }).click();

    await expect(page.getByText(/1 succeeded, 1 failed/)).toBeVisible();
    await expect(page.getByTestId('staff-result-errors')).toContainText(REQUIRE_A);
  });

  test('with every row refused nothing can go forward', async ({ page }) => {
    await openStaffPreview(page, [
      { rowNumber: 1, error: REQUIRE_A },
      { rowNumber: 2, error: NOT_IN_LIST_B },
    ]);

    await expect(page.getByTestId('staff-reference-notice')).toContainText('Every row would be refused');
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  });

  test('when no row lands the 400 still shows each row and its reason', async ({ page }) => {
    await openStaffPreview(page, []);
    await page.route(/\/api\/bulk-import\/staff-import/, (r) =>
      json(r, {
        ...env,
        success: false,
        messages: [{ message: 'Import completed with 2 failed jobs out of 2 total.' }],
        successCount: 0,
        failedCount: 2,
        failedJobs: [
          { rowNumber: 1, jobNumber: 'REFCHK1', error: REQUIRE_A },
          { rowNumber: 2, jobNumber: 'REFCHK2', error: NOT_IN_LIST_B },
        ],
      }, 400));
    for (const heading of [/Suburbs seems OK/, /Addresses seems OK/, /Confirm Staff Import/]) {
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(page.getByText(heading)).toBeVisible();
    }
    await page.getByRole('button', { name: 'Import 2 Jobs' }).click();

    const table = page.getByTestId('staff-result-errors');
    await expect(table).toContainText(REQUIRE_A);
    await expect(table).toContainText(NOT_IN_LIST_B);
    await expect(page.getByText(/0 succeeded, 2 failed/)).toBeVisible();
  });
});
