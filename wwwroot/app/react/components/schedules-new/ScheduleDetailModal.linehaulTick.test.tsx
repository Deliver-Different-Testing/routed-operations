// UC #1115 M2 item 5 (ZB save check). Marcus's screenshot shows "Apply add-on
// percentage" ticked on ZB Wellington > Akl Returns, yet prod stores 0 on both
// ZB schedules while the 0.5 he typed beside it did land. These tests drive
// his exact edit on an EXISTING leg through the real modal and read the PUT
// body, so a path that drops the tick between the editor and the wire fails.
// The last case covers the other side (D1): a leg with a stored NULL tick on a
// schedule saved after an unrelated edit is not resent at all, so this card
// never turns a NULL into false or true.
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/renderWithProviders';
import { server } from '../../test/server';
import { ScheduleDetailModal } from './ScheduleDetailModal';

const SCHEDULE_ID = 2894;

let legTick: boolean | null = false;
// UC #1115 F2 cases below set these; the defaults keep the ZB cases as they were.
let legRunId: number | null = null;
let legAmount = 30;
let headerOverrides: Record<string, unknown> = {};

function detail() {
  return { ...detailBase(), ...headerOverrides };
}

function detailBase() {
  return {
    scheduleId: SCHEDULE_ID, name: 'ZB Wellington > Akl Returns',
    legacyClientId: null, legacyClientCode: null,
    regionId: 2, regionName: 'Mainfreight Auckland',
    pickupDepotId: 1, pickupDepotName: 'Wellington',
    speedId: 122, speedName: 'Morning', parentSpeedId: null, parentSpeedName: null,
    postcodeGroupId: null, postcodeGroupName: null,
    pickupPostcodeGroupId: null, pickupPostcodeGroupName: null, pickupRatingSpeed: null,
    originType: 'depot', originRegionId: null, originRegionName: null,
    clientsMissingGeocode: [], autoBook: false, bookPickup: false,
    applyPickupCutoff: false, pickupCutoff: null, storageState: null, deliveryState: null,
    pickupBoxDiscount: null, dropOffLocationId: null, dropOffLocationName: null, description: null,
    dayWindows: [{ id: 14646, dayOfWeek: 1, startTime: '08:00', endTime: '17:00', cutoffDay: 1, cutoffTime: '15:00' }],
    zones: [], pickupZones: [],
    // As stored on prod for leg 54472 before Marcus's edit, zone % aside.
    linehauls: [{
      id: 54472, name: 'WLG to Mainfreight AKL', active: true, amount: legAmount, amountPercentage: 0,
      fromDepotId: 1, toDepotId: 2, minutes: 180, linehaulRunId: legRunId,
      insertToBulk: false, applyDiscount: true, applyAddOnPercentage: legTick,
      weekDay: [1, 1, 1, 1, 1, 0, 0], departureAdvanceDays: 1,
      fromClientAddress: false, dropOffLocationId: null, speedId: null, speedName: null,
      legOrder: 1, chargePerConsignment: false,
    }],
    clientIds: [], clientCodes: [], clientNames: [], clientLinkedUtcs: [],
    postcodeIds: [], polygonIds: [], displayName: null, displayDescription: null,
    isActive: true, isCollapsed: false, occurrencesAhead: null,
    convertRefusalReasons: null, isDefault: true,
  };
}

let lastPut: { name?: string; linehauls: Array<Record<string, unknown>> | null } | null = null;

beforeEach(() => {
  lastPut = null;
  legTick = false;
  legRunId = null;
  legAmount = 30;
  headerOverrides = {};
  server.use(
    http.get(`/api/v2/schedules/${SCHEDULE_ID}`, () => HttpResponse.json({ response: detail() })),
    http.get(`/api/v2/schedules/${SCHEDULE_ID}/overrides`, () => HttpResponse.json({ response: [] })),
    http.get(`/api/v2/schedules/${SCHEDULE_ID}/occurrences`, () => HttpResponse.json({ response: [] })),
    http.get('/api/schedules/lookups', () => HttpResponse.json({
      response: {
        depots: [{ id: 1, name: 'Wellington' }, { id: 2, name: 'Mainfreight Auckland' }],
        speeds: [{ id: 122, name: 'Morning' }],
        postcodeGroups: [], storageStates: [], deliveryStates: [], pickupBoxDiscounts: [],
        linehaulRuns: [], zoneNumbers: [1], dropOffLocations: [], couriers: [], clients: [],
      },
    })),
    http.get('/api/recurring-routes', () => HttpResponse.json({ response: [] })),
    http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [] })),
    http.put(`/api/v2/schedules/${SCHEDULE_ID}`, async ({ request }) => {
      lastPut = (await request.json()) as typeof lastPut;
      return HttpResponse.json({ response: { ...detail(), convertRefusalReasons: null } });
    }),
  );
});

async function openLeg() {
  const user = userEvent.setup();
  renderWithProviders(
    <ScheduleDetailModal scheduleId={SCHEDULE_ID} onClose={() => {}}
      onAttachClients={() => {}} onOpenSchedule={() => {}} onOpenOverride={() => {}} />,
  );
  await user.click(await screen.findByRole('button', { name: 'Route' }));
  await user.click(await screen.findByText('WLG to Mainfreight AKL'));
  return user;
}

describe('Schedule detail modal: the additional item tick on an EXISTING leg reaches the save body (UC #1115 ZB)', () => {
  it('tick only', async () => {
    const user = await openLeg();
    await user.click(screen.getByRole('checkbox', { name: /Discount additional items/ }));
    await user.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(lastPut).not.toBeNull());
    expect(lastPut!.linehauls).not.toBeNull();
    expect(lastPut!.linehauls![0].applyAddOnPercentage).toBe(true);
  });

  it('tick plus 0.5 in the zone % together (Marcus\'s exact edit)', async () => {
    const user = await openLeg();
    await user.click(screen.getByRole('checkbox', { name: /Discount additional items/ }));
    const pct = screen.getByLabelText(/Plus % of delivery zone rate/);
    await user.clear(pct);
    await user.type(pct, '0.5');
    await user.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(lastPut).not.toBeNull());
    expect(lastPut!.linehauls![0].applyAddOnPercentage).toBe(true);
    expect(lastPut!.linehauls![0].amountPercentage).toBe(0.5);
  });

  it('a NULL tick leg is not sent when only the name changes', async () => {
    legTick = null;
    const user = userEvent.setup();
    renderWithProviders(
      <ScheduleDetailModal scheduleId={SCHEDULE_ID} onClose={() => {}}
        onAttachClients={() => {}} onOpenSchedule={() => {}} onOpenOverride={() => {}} />,
    );
    const nameInput = await screen.findByDisplayValue('ZB Wellington > Akl Returns');
    await user.type(nameInput, ' x');
    await user.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(lastPut).not.toBeNull());
    expect(lastPut!.name).toBe('ZB Wellington > Akl Returns x');
    expect(lastPut!.linehauls).toBeNull();
  });
});

// UC #1115 FIX6 (review F2), MSW made faithful in FIX7 (review G2). Any client can book an
// all-clients (IsDefault) schedule, so the Linehaul tab check must use the generic rows only,
// not the clients attached to it. The handler filters like the real endpoint
// (LinehaulRateService.GetScheduleRatesAsync: ClientId == null || ClientId == clientId), so a
// generic row is visible to every client query and a client row only to its own client.
const ZB_CLIENT = { clientIds: [14821], clientCodes: ['ZB'], clientNames: ['ZB'], clientLinkedUtcs: [null] };
let tabRows: Array<{ clientId: number | null }> = [];

function installLinehaulTab() {
  legRunId = 45;
  server.use(
    http.get('/api/linehaul-rates', () => HttpResponse.json({ response: [
      { runId: 45, anySpeed: { rateId: null }, speedCells: [] },
    ] })),
    http.get('/api/linehaul-rates/runs/:runId/schedules', ({ request }) => {
      const raw = new URL(request.url).searchParams.get('clientId');
      const requested = raw == null ? null : Number(raw);
      return HttpResponse.json({ response: tabRows
        .filter((r) => r.clientId == null || r.clientId === requested)
        .map((r, i) => ({ rateId: i + 1, scheduleId: SCHEDULE_ID, scheduleName: 'ZB', speedId: null, speedName: '',
          clientId: r.clientId, clientCode: r.clientId == null ? null : 'ZB', amount: 45, amountPercentage: null, active: true })) });
    }),
  );
}

async function expectLocked() {
  expect(await screen.findByText('Set on the Linehaul tab')).toBeInTheDocument();
  expect(screen.queryByLabelText(/Plus % of delivery zone rate/)).toBeNull();
}

async function expectEditable() {
  await waitFor(() => expect(screen.getByLabelText(/Plus % of delivery zone rate/)).toBeInTheDocument());
  expect(screen.queryByText('Set on the Linehaul tab')).toBeNull();
}

describe('Schedule detail modal: Linehaul tab check, generic row only (UC #1115 F2)', () => {
  beforeEach(() => { tabRows = [{ clientId: null }]; installLinehaulTab(); });

  it('IsDefault on: the generic row locks the Amount even though a client is attached', async () => {
    headerOverrides = { isDefault: true, ...ZB_CLIENT };
    await openLeg();
    await expectLocked();
  });

  it('IsDefault off: the generic row is visible to the attached client too, so it is locked', async () => {
    headerOverrides = { isDefault: false, ...ZB_CLIENT };
    await openLeg();
    await expectLocked();
  });
});

// The case F2 exists for: a client-only row (client 14821) and no generic row. On an
// all-clients schedule every other client prices from the leg, so the leg must stay
// editable; on a specific-clients schedule only 14821 books it, so the tab row prices it.
describe('Schedule detail modal: Linehaul tab check, client-only row (UC #1115 F2, FIX7 G2)', () => {
  beforeEach(() => { tabRows = [{ clientId: 14821 }]; installLinehaulTab(); });

  it('IsDefault on: the client-only row does not price other clients, so the leg stays editable', async () => {
    headerOverrides = { isDefault: true, ...ZB_CLIENT };
    await openLeg();
    await expectEditable();
  });

  it('IsDefault off: the only client that can book has a tab row, so the Amount is locked', async () => {
    headerOverrides = { isDefault: false, ...ZB_CLIENT };
    await openLeg();
    await expectLocked();
  });

  // FIX7 G6: the lock follows the live radio, not the IsDefault loaded with the schedule.
  it('flipping "Who can book" while the modal is open changes the lock', async () => {
    headerOverrides = { isDefault: true, ...ZB_CLIENT };
    const user = await openLeg();
    await expectEditable();
    await user.click(screen.getByRole('button', { name: 'Clients' }));
    await user.click(await screen.findByTestId('who-can-book-specific-clients'));
    await user.click(screen.getByRole('button', { name: 'Route' }));
    await user.click(await screen.findByText('WLG to Mainfreight AKL'));
    await expectLocked();
    await user.click(screen.getByRole('button', { name: 'Clients' }));
    await user.click(await screen.findByTestId('who-can-book-all-clients'));
    await user.click(screen.getByRole('button', { name: 'Route' }));
    await user.click(await screen.findByText('WLG to Mainfreight AKL'));
    await expectEditable();
  });
});

// UC #1115 spec 2.4 item 4b (#332): a save turned leg Amount 2.8365 into 2.84. The column is
// money (4 decimals); the chain editor must send the stored value untouched and a typed value
// as typed, and the leg summary must show the stored value rather than a rounded one.
describe('Schedule detail modal: leg Amount keeps 4 decimals (UC #1115 #332)', () => {
  it('a stored 2.8365 is shown and saved unchanged when Amount is not edited', async () => {
    legAmount = 2.8365;
    const user = await openLeg();
    expect(screen.getByDisplayValue('2.8365')).toBeInTheDocument();
    expect(screen.getAllByText(/\$2\.8365/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('checkbox', { name: /Discount additional items/ }));
    await user.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(lastPut).not.toBeNull());
    expect(lastPut!.linehauls![0].amount).toBe(2.8365);
  });

  it('a typed 11.5094 is sent as typed', async () => {
    const user = await openLeg();
    const amount = screen.getByLabelText(/Amount \(\$\)/);
    await user.clear(amount);
    await user.type(amount, '11.5094');
    await user.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(lastPut).not.toBeNull());
    expect(lastPut!.linehauls![0].amount).toBe(11.5094);
  });
});
