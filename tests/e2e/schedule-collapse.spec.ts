import { test, expect, type Page, type Route } from '@playwright/test';

// E2E for the schedule collapse, UI side (collapse plan section 4 +
// occurrences-ahead spec section 6).
//
// WHAT THIS COVERS, AND WHAT IT DOES NOT
//
// Every /api/* call is stubbed, so this spec proves what the OPERATOR sees
// given a backend answer: that a collapsed schedule is marked as such, that
// the occurrences-ahead field appears only where it can be saved, that a
// bad value cannot be submitted, and that a schedule the database declines
// to collapse says so instead of closing silently.
//
// It does NOT prove the collapse itself. Turning per-day absolute cutoffs
// into one relative rule happens in dbo.uspScheduleConvert, and that was
// verified against a real database (a save produced WeekDays 1110000, a
// 'W' rule at 0 days before 15:00, day rows emptied to key rows, and the
// view reconstructing cutoffDay 1/2/3 from the single rule). A stubbed
// browser test cannot see any of that, and pretending otherwise is how a
// green suite ends up meaning nothing.
//
// The two halves are deliberately complementary: the database verifies the
// derivation, this verifies that the answer reaches the operator.

/** Collapsed: one detail row behind it, so N is editable. */
const COLLAPSED = {
  scheduleId: 500,
  name: 'Collapsed Weekday Run',
  legacyClientId: null,
  legacyClientCode: null,
  regionId: 1,
  regionName: 'Auckland',
  speedId: 2,
  speedName: 'Standard',
  activeDays: [1, 2, 3],
  activeZonesCount: 0,
  clientCount: 0,
  postcodeCount: 0,
  polygonCount: 0,
  autoBook: true,
  hasActiveLinehaul: false,
  linkedClientCodes: [],
  baseScheduleId: null,
  isCollapsed: true,
  occurrencesAhead: 3,
};

/** Old shape: payload still per day row, so there is nowhere to put N. */
const OLD_SHAPE = {
  ...COLLAPSED,
  scheduleId: 501,
  name: 'Old Shape Varying Run',
  activeDays: [1, 2],
  isCollapsed: false,
  occurrencesAhead: null,
};

function detailFor(row: typeof COLLAPSED) {
  return {
    scheduleId: row.scheduleId,
    name: row.name,
    legacyClientId: null,
    legacyClientCode: null,
    regionId: 1,
    regionName: 'Auckland',
    pickupDepotId: 1,
    pickupDepotName: 'Auckland',
    speedId: 2,
    speedName: 'Standard',
    parentSpeedId: 2,
    parentSpeedName: 'Standard',
    postcodeGroupId: null,
    postcodeGroupName: null,
    pickupPostcodeGroupId: null,
    pickupPostcodeGroupName: null,
    pickupRatingSpeed: null,
    originType: 'depot',
    originRegionId: null,
    originRegionName: null,
    clientsMissingGeocode: [],
    autoBook: true,
    bookPickup: false,
    applyPickupCutoff: false,
    pickupCutoff: null,
    storageState: null,
    deliveryState: null,
    pickupBoxDiscount: null,
    dropOffLocationId: null,
    dropOffLocationName: null,
    description: null,
    dayWindows: row.activeDays.map((d, i) => ({
      id: row.scheduleId * 10 + i,
      dayOfWeek: d,
      startTime: '08:00',
      endTime: '17:00',
      cutoffDay: d,
      cutoffTime: '15:00',
      cutoffHours: 0,
    })),
    zones: [],
    pickupZones: [],
    linehauls: [],
    clientIds: [],
    clientCodes: [],
    postcodeIds: [],
    polygonIds: [],
    clientLinkedUtcs: [],
    clientNames: [],
    displayName: null,
    displayDescription: null,
    isActive: true,
    isCollapsed: row.isCollapsed,
    occurrencesAhead: row.occurrencesAhead,
    convertRefusalReasons: null,
  };
}

interface StubOptions {
  /** What the backend reports after the save. null = it collapsed. */
  refusalOnSave?: string | null;
  /** Receives the parsed PUT body so a test can assert what was sent. */
  onSave?: (body: Record<string, unknown>) => void;
  /** Every `n` the preview endpoint was asked for, in order. */
  onPreview?: (n: string | null) => void;
  /** Return no occurrences, for the empty-state test. */
  emptyPreview?: boolean;
  /** Hang a client override off the collapsed schedule, so the nested row
   *  renders and the modal can be opened in override-edit mode. */
  withOverride?: boolean;
}

/** The one client whose override the override-mode tests open. Its own
 *  occurrencesAhead (2) is deliberately different from the schedule's (3),
 *  because the whole question in override mode is which number is which. */
const OV_CLIENT = { clientId: 77, clientCode: 'ACME', clientName: 'Acme Ltd' };

async function stubApis(page: Page, opts: StubOptions = {}) {
  await page.route('**/api/schedules/lookups', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        response: {
          regions: [{ id: 1, name: 'Auckland' }],
          speeds: [{ id: 2, name: 'Standard' }],
          postcodeGroups: [],
          dropOffLocations: [],
          linehaulRuns: [],
          zones: [],
        },
      }),
    }));
  await page.route('**/api/schedules/clients*', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ response: [] }) }));
  await page.route('**/api/v2/schedule-bundles', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ response: [] }) }));
  await page.route('**/api/recurring-routes', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ response: [] }) }));

  await page.route('**/api/v2/schedules?**', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        response: {
          rows: [
            opts.withOverride
              ? { ...COLLAPSED, overrides: [{ ...OV_CLIENT, deltaLabels: ['Cut-off'] }] }
              : COLLAPSED,
            OLD_SHAPE,
          ],
          total: 2, page: 0, pageSize: 0,
        },
      }),
    }));

  // Routed before the generic /schedules/{id} match, or the wildcard
  // short-circuits it.
  await page.route('**/api/v2/schedules/*/overrides', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        response: opts.withOverride
          ? [{
              scheduleId: COLLAPSED.scheduleId,
              ...OV_CLIENT,
              // Only occurrencesAhead is set: every other scoped field
              // inherits, which is the ordinary shape of an override and
              // keeps the test about the one field.
              schedule: {
                cutoffDay: null, cutoffTime: null, weekDays: null,
                isActive: null, displayName: null, displayDescription: null,
                occurrencesAhead: 2,
              },
              collection: null,
              delivery: null,
              updatedUtc: '2026-10-13T00:00:00Z',
              updatedBy: null,
            }]
          : [],
      }),
    }));

  await page.route('**/api/v2/schedules/*/occurrences*', (route: Route) => {
    const n = new URL(route.request().url()).searchParams.get('n');
    opts.onPreview?.(n);
    // Dates are fixed rather than computed from today: the point here is
    // that what the server returns reaches the screen, and the real
    // date arithmetic is verified against a real database, not in a stub.
    const all = [
      { date: '2026-10-13', dayOfWeek: 2, startTime: '08:00', cutoffAt: '2026-10-12 10:00' },
      { date: '2026-10-14', dayOfWeek: 3, startTime: '08:00', cutoffAt: '2026-10-13 10:00' },
      { date: '2026-10-15', dayOfWeek: 4, startTime: '08:00', cutoffAt: '2026-10-14 10:00' },
    ];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        response: opts.emptyPreview ? [] : all.slice(0, n ? Number(n) : 3),
      }),
    });
  });

  await page.route('**/api/v2/schedules/*', async (route: Route) => {
    const url = new URL(route.request().url());
    const id = Number(url.pathname.split('/').pop());
    const row = id === OLD_SHAPE.scheduleId ? OLD_SHAPE : COLLAPSED;

    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      opts.onSave?.(body);
      // The save succeeded either way. Whether the schedule ended up
      // collapsed is the backend's answer, and the refusal reason is the
      // only place the operator learns it did not.
      const refusal = opts.refusalOnSave ?? null;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          response: {
            ...detailFor(row),
            isCollapsed: refusal == null,
            occurrencesAhead: refusal == null ? (body.occurrencesAhead ?? row.occurrencesAhead) : null,
            convertRefusalReasons: refusal,
          },
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ response: detailFor(row) }),
    });
  });
}

test.describe('Schedule collapse - what the operator sees', () => {
  test('the list marks a collapsed schedule and leaves an old-shape one alone', async ({ page }) => {
    // The indicator is deliberately quiet. An old-shape schedule is not
    // broken, it has just not been saved since the collapse shipped, so the
    // absence of a chip must not read as a warning.
    await stubApis(page);
    await page.goto('/schedules-new');

    await expect(page.getByText('Collapsed Weekday Run').first()).toBeVisible();
    await expect(page.getByText('Old Shape Varying Run').first()).toBeVisible();

    const chips = page.getByTestId('schedule-collapsed-chip');
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toHaveText('1-row');
    // And it carries the count, so hovering answers "how many dates".
    await expect(chips.first()).toHaveAttribute('title', /3 upcoming runs/);
  });

  test('a collapsed schedule offers the occurrences field, seeded from the detail row', async ({ page }) => {
    await stubApis(page);
    await page.goto('/schedules-new');
    await page.getByText('Collapsed Weekday Run').first().click();

    const input = page.getByTestId('schedule-occurrences-ahead-input');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('3');
    await expect(page.getByTestId('schedule-occurrences-ahead-help'))
      .toContainText('Blank uses one week of runs');
    await expect(page.getByTestId('schedule-occurrences-ahead-unavailable')).toHaveCount(0);
  });

  test('an old-shape schedule explains itself instead of offering an input it cannot save', async ({ page }) => {
    // The value lives on the detail row, which an old-shape schedule does
    // not have. Showing an enabled box would let the operator type a number
    // that silently goes nowhere.
    await stubApis(page);
    await page.goto('/schedules-new');
    await page.getByText('Old Shape Varying Run').first().click();

    await expect(page.getByTestId('schedule-occurrences-ahead-input')).toHaveCount(0);
    await expect(page.getByTestId('schedule-occurrences-ahead-unavailable'))
      .toContainText('Available once this schedule runs on one row');
  });

  test('a value outside 1 to 60 blocks the save and says why', async ({ page }) => {
    // Matches the CHECK on the column, raised from 14 on 2026-10-14.
    // Caught here so the operator is not told by a constraint violation on
    // round trip.
    await stubApis(page);
    await page.goto('/schedules-new');
    await page.getByText('Collapsed Weekday Run').first().click();

    const input = page.getByTestId('schedule-occurrences-ahead-input');
    await input.fill('61');
    await expect(page.getByTestId('schedule-occurrences-ahead-help'))
      .toContainText('Enter a number from 1 to 60');
    await expect(page.getByTestId('schedule-modal-save')).toBeDisabled();

    // Back in range and the save is available again.
    await input.fill('9');
    await expect(page.getByTestId('schedule-modal-save')).toBeEnabled();
  });

  test('saving sends the occurrences value and closes when the schedule collapses', async ({ page }) => {
    const saves: Record<string, unknown>[] = [];
    await stubApis(page, { onSave: (b) => saves.push(b) });
    await page.goto('/schedules-new');
    await page.getByText('Collapsed Weekday Run').first().click();

    await page.getByTestId('schedule-occurrences-ahead-input').fill('9');
    await page.getByTestId('schedule-modal-save').click();

    // Modal closes on a clean collapse: there is nothing to tell the
    // operator, so keeping it open would just be another click.
    await expect(page.getByTestId('schedule-occurrences-ahead-input')).toHaveCount(0);
    expect(saves).toHaveLength(1);
    expect(saves[0].occurrencesAhead).toBe(9);
  });

  test('blank occurrences sends null rather than a number', async ({ page }) => {
    // Blank means "leave it alone", which is different from any number the
    // operator could type: the converter has already written one week's
    // worth, and sending 0 or 1 instead would quietly change the schedule.
    const saves: Record<string, unknown>[] = [];
    await stubApis(page, { onSave: (b) => saves.push(b) });
    await page.goto('/schedules-new');
    await page.getByText('Collapsed Weekday Run').first().click();

    await page.getByTestId('schedule-occurrences-ahead-input').fill('');
    await page.getByTestId('schedule-modal-save').click();

    expect(saves).toHaveLength(1);
    expect(saves[0].occurrencesAhead).toBeNull();
  });

  test('the occurrences field is backed by the dates it will actually offer', async ({ page }) => {
    // A bare number does not tell an operator whether 3 means this week or
    // next, and the mask, the cut-off and the holiday calendar all move the
    // answer. The dates are what makes the field legible.
    await stubApis(page);
    await page.goto('/schedules-new');
    await page.getByText('Collapsed Weekday Run').first().click();

    const preview = page.getByTestId('schedule-occurrences-preview');
    await expect(preview).toContainText('Next runs offered');
    await expect(preview).toContainText('Tue, 13 Oct');
    await expect(preview).toContainText('Wed, 14 Oct');
    // Hovering a date says when ordering closes for it.
    await expect(preview.getByTitle('Order by 2026-10-12 10:00')).toBeVisible();
  });

  test('typing a different N re-asks for that many dates', async ({ page }) => {
    // The preview has to follow the box, not the saved value, or it tells
    // the operator about a schedule they are in the middle of changing.
    const asked: (string | null)[] = [];
    await stubApis(page, { onPreview: (n) => asked.push(n) });
    await page.goto('/schedules-new');
    await page.getByText('Collapsed Weekday Run').first().click();
    await expect(page.getByTestId('schedule-occurrences-preview')).toContainText('Tue, 13 Oct');

    await page.getByTestId('schedule-occurrences-ahead-input').fill('2');

    await expect
      .poll(() => asked[asked.length - 1], { timeout: 5000 })
      .toBe('2');
    // Two asked for, two shown: the third date the default returned is
    // gone, and the first two remain.
    const preview = page.getByTestId('schedule-occurrences-preview');
    await expect(preview).not.toContainText('Thu, 15 Oct');
    await expect(preview).toContainText('Tue, 13 Oct');
    await expect(preview).toContainText('Wed, 14 Oct');
  });

  test('an old-shape schedule gets the dates too, even without the field', async ({ page }) => {
    // Storing a per-schedule N needs the detail row, so the FIELD is
    // collapsed-only. "Which dates does this offer" is a fair question
    // about any schedule, and gating the preview the same way would have
    // hidden it from almost every schedule on the tenant.
    await stubApis(page);
    await page.goto('/schedules-new');
    await page.getByText('Old Shape Varying Run').first().click();

    await expect(page.getByTestId('schedule-occurrences-ahead-input')).toHaveCount(0);
    await expect(page.getByTestId('schedule-occurrences-preview')).toContainText('Tue, 13 Oct');
  });

  test('a schedule with nothing bookable says so rather than showing an empty strip', async ({ page }) => {
    await stubApis(page, { emptyPreview: true });
    await page.goto('/schedules-new');
    await page.getByText('Collapsed Weekday Run').first().click();

    await expect(page.getByTestId('schedule-occurrences-preview'))
      .toContainText('No runs in the next 60 days');
  });

  test('a schedule the database declines to collapse says why and stays open', async ({ page }) => {
    // The save SUCCEEDED. Closing here would show the operator a clean save
    // with no hint that two of their days disagree, or why the occurrences
    // field is still unavailable. The reason is shown verbatim, naming the
    // real obstacle rather than a translated approximation.
    await stubApis(page, { refusalOnSave: 'WindowVariesByDay;' });
    await page.goto('/schedules-new');
    await page.getByText('Collapsed Weekday Run').first().click();

    await page.getByTestId('schedule-occurrences-ahead-input').fill('4');
    await page.getByTestId('schedule-modal-save').click();

    const notice = page.getByTestId('schedule-convert-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Saved.');
    await expect(notice).toContainText('one row per day');
    await expect(notice).toContainText('WindowVariesByDay');

    // Still open, so the operator can read it and act.
    await expect(page.getByTestId('schedule-occurrences-ahead-input')).toBeVisible();
  });

  test('override mode shows the client number editable and the schedule number read-only', async ({ page }) => {
    // Two branches put an "Occurrences ahead" control in this modal in the
    // same release: the schedule's own, and the client's override. Merged,
    // override mode shows both, and the only thing that makes them readable
    // is that each says which it is. Before the merge the schedule-level
    // helper text said a per-client value was not editable, which the other
    // branch had just made false.
    await stubApis(page, { withOverride: true });
    await page.goto('/schedules-new');
    await page.getByText('ACME').first().click();

    // The client's own number, editable, seeded from their override.
    const clientInput = page.getByTestId('override-occurrences-ahead');
    await expect(clientInput).toBeVisible();
    await expect(clientInput).toHaveValue('2');
    await expect(clientInput).toBeEnabled();

    // The schedule's own number, visible for comparison but not editable
    // here: it belongs to the schedule, not to this client.
    const scheduleInput = page.getByTestId('schedule-occurrences-ahead-input');
    await expect(scheduleInput).toHaveValue('3');
    await expect(scheduleInput).toBeDisabled();

    // And it points at the client field instead of denying it exists.
    await expect(page.getByTestId('schedule-occurrences-ahead-help'))
      .toContainText("Set this client's below");

    // The preview is keyed on the schedule, so in override mode it must say
    // so rather than let 3 schedule dates read as this client's 2.
    await expect(page.getByTestId('schedule-occurrences-preview'))
      .toContainText('schedule default');
  });

  test('a per-client value outside 1 to 60 blocks the save', async ({ page }) => {
    await stubApis(page, { withOverride: true });
    await page.goto('/schedules-new');
    await page.getByText('ACME').first().click();

    const clientInput = page.getByTestId('override-occurrences-ahead');
    await clientInput.fill('61');
    await expect(page.getByTestId('override-occurrences-ahead-help'))
      .toContainText('Enter a number from 1 to 60');
    // Override mode renames the save button's testid, so this is
    // override-modal-save and not the schedule one.
    await expect(page.getByTestId('override-modal-save')).toBeDisabled();

    // Blank is not an error: it means this client inherits the schedule.
    await clientInput.fill('');
    await expect(page.getByTestId('override-modal-save')).toBeEnabled();
  });
});
