// "Who can book this schedule" has to be a setting the operator can change,
// and the one the header actually holds.
//
// WHY these exist. Until 2026-10-21 the radio pair was disabled and its
// checked state was computed in the component as
// `legacyClientId == null && clientIds.length === 0`. Two consequences, both
// visible to operations:
//
//   * On a schedule every client can book that also had a client configured
//     on it, the pair selected "Specific clients" while the booking
//     functions kept offering it to everybody. Anisah's 20 Oct schedule was
//     that shape. The screen disagreed with the database and there was no way
//     to tell which was right.
//   * Nothing the operator clicked could change the header either way, so a
//     schedule created as a default stayed one for good.
//
// Spec section 6.1, rules 1 to 5 (KEVIN-SCHEDULES-ZONES-FOLLOWUPS-2026-10-16).
// These assert the control edits state and ships it, and that the reading
// comes off `isDefault` rather than off the client count; the server-side
// half of rule 3 is pinned in ScheduleServiceTests.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/renderWithProviders';
import { server } from '../../test/server';
import { ScheduleDetailModal } from './ScheduleDetailModal';

const SCHEDULE_ID = 2908;

/** A schedule EVERY client can book that ALSO has one client configured on
 *  it. The combination is the whole point: the old code could not represent
 *  it, so it rendered as client-specific. */
function detail(overrides: Record<string, unknown> = {}) {
  return {
    scheduleId: SCHEDULE_ID,
    name: 'Waikato Morning Chilled',
    legacyClientId: null,
    legacyClientCode: null,
    regionId: 39,
    regionName: 'Hamilton',
    pickupDepotId: 43,
    pickupDepotName: 'Tauranga',
    speedId: 122,
    speedName: 'Morning',
    parentSpeedId: null,
    parentSpeedName: null,
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
    dayWindows: [
      { id: 9001, dayOfWeek: 1, startTime: '08:00', endTime: '17:00', cutoffDay: 1, cutoffTime: '15:00' },
    ],
    zones: [],
    pickupZones: [],
    linehauls: [],
    clientIds: [41],
    clientCodes: ['AAA'],
    clientNames: ['Client A'],
    clientLinkedUtcs: ['2026-10-20T00:00:00Z'],
    postcodeIds: [],
    polygonIds: [],
    displayName: null,
    displayDescription: null,
    isActive: true,
    isCollapsed: false,
    occurrencesAhead: null,
    convertRefusalReasons: null,
    isDefault: true,
    ...overrides,
  };
}

/** Captures the PUT body so the assertions are about what reaches the API,
 *  not about component state. */
let lastPut: Record<string, unknown> | null = null;

function installHandlers(payload: Record<string, unknown>) {
  lastPut = null;
  server.use(
    http.get(`/api/v2/schedules/${SCHEDULE_ID}`, () =>
      HttpResponse.json({ response: payload })),
    http.get(`/api/v2/schedules/${SCHEDULE_ID}/overrides`, () =>
      HttpResponse.json({ response: [] })),
    http.get(`/api/v2/schedules/${SCHEDULE_ID}/occurrences`, () =>
      HttpResponse.json({ response: [] })),
    http.get('/api/schedules/lookups', () =>
      HttpResponse.json({
        response: {
          depots: [{ id: 39, name: 'Hamilton' }, { id: 43, name: 'Tauranga' }],
          speeds: [{ id: 122, name: 'Morning' }],
          postcodeGroups: [], storageStates: [], deliveryStates: [],
          pickupBoxDiscounts: [], linehaulRuns: [], zoneNumbers: [1, 2, 3],
          dropOffLocations: [], couriers: [], clients: [],
        },
      })),
    http.get('/api/recurring-routes', () => HttpResponse.json({ response: [] })),
    // The Coverage tab fetches these on mount. Stubbed so the run has no
    // unhandled request: an unhandled fetch rejects after the test has
    // finished, which is one of the three ways this suite flakes only on CI.
    http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [] })),
    http.put(`/api/v2/schedules/${SCHEDULE_ID}`, async ({ request }) => {
      lastPut = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ response: { ...payload, convertRefusalReasons: null } });
    }),
  );
}

function renderModal() {
  return renderWithProviders(
    <ScheduleDetailModal
      scheduleId={SCHEDULE_ID}
      onClose={() => {}}
      onAttachClients={() => {}}
      onOpenSchedule={() => {}}
      onOpenOverride={() => {}}
    />,
  );
}

describe('Schedule detail modal - who can book this schedule (spec 6.1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reads the selection off the header flag, not off how many clients are configured', async () => {
    // One client configured, isDefault true. The old derivation selected
    // "Specific clients" here, which contradicted the header.
    installHandlers(detail());
    renderModal();

    const all = await screen.findByTestId('who-can-book-all-clients');
    const specific = screen.getByTestId('who-can-book-specific-clients');
    expect(all).toBeChecked();
    expect(specific).not.toBeChecked();
    // And the client IS shown as configured, so the two facts coexist.
    expect(screen.getByText('AAA')).toBeInTheDocument();
  });

  it('selects Specific clients when the header says so, with the same client count', async () => {
    installHandlers(detail({ isDefault: false }));
    renderModal();

    expect(await screen.findByTestId('who-can-book-specific-clients')).toBeChecked();
    expect(screen.getByTestId('who-can-book-all-clients')).not.toBeChecked();
  });

  it('is editable and ships the operator choice in the save body', async () => {
    installHandlers(detail());
    const user = userEvent.setup();
    renderModal();

    const specific = await screen.findByTestId('who-can-book-specific-clients');
    expect(specific).toBeEnabled();      // it was `disabled` before 6.1
    await user.click(specific);
    expect(specific).toBeChecked();

    // Save is gated on the form being dirty, so the click alone has to be
    // enough to enable it. That is the half that proves the radio reaches the
    // same form state everything else is saved from.
    const save = screen.getByRole('button', { name: /^Save/ });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() => expect(lastPut).not.toBeNull());
    expect(lastPut!.isDefault).toBe(false);
  });

  it('refuses to save Specific clients with nothing configured, and names the fix', async () => {
    // Rule 3's operator-facing half. The server refuses this too; catching it
    // here means the operator reads a sentence about their own screen instead
    // of a server error after a round trip.
    installHandlers(detail({ clientIds: [], clientCodes: [], clientNames: [], clientLinkedUtcs: [] }));
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByTestId('who-can-book-specific-clients'));
    const save = screen.getByRole('button', { name: /^Save/ });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    expect(await screen.findByText(/Configure at least one client/i)).toBeInTheDocument();
    expect(lastPut).toBeNull();          // nothing was sent
  });
});
