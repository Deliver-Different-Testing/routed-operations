// UC #1115 M2, the older schedule editor. Same rules as the chain builder:
// a new leg starts with "Discount additional items" on, a loaded NULL stays
// off, unticking saves false, and a zone % above 1 blocks the save.
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/renderWithProviders';
import { server } from '../../test/server';
import { ScheduleEditModal } from './ScheduleEditModal';
import type { ScheduleGroup, ScheduleLookups } from '../../services/scheduleService';
import { ZONE_PERCENT_TOO_HIGH_MESSAGE, BOTH_CHARGED_WARNING, LINEHAUL_LABELS } from '../../lib/linehaulLegRules';

const LOOKUPS = {
  depots: [{ id: 1, name: 'Wellington' }, { id: 2, name: 'Mainfreight Auckland' }],
  speeds: [], dropOffLocations: [], postcodeGroups: [], storageStates: [], deliveryStates: [],
  pickupBoxDiscounts: [], linehaulRuns: [], zoneNumbers: [], couriers: [], clients: [],
} as unknown as ScheduleLookups;

function group(applyAddOnPercentage: boolean | null, amountPercentage = 0): ScheduleGroup {
  return {
    scheduleId: 2894, name: 'ZB Wellington > Akl Returns', description: null,
    regionId: 2, pickupDepotId: 1, speedId: null, parentSpeedId: null,
    autoBook: false, bookPickup: false, applyPickupCutoff: false, pickupCutoff: null,
    postcodeGroupId: null, pickupPostcodeGroupId: null, pickupRatingSpeed: null,
    storageState: null, deliveryState: null, pickupBoxDiscount: null, dropOffLocationId: null,
    dayWindows: [{ id: 1, dayOfWeek: 1, startTime: '08:00', endTime: '17:00', cutoffDay: null, cutoffTime: null }],
    zones: [],
    linehauls: [{
      id: 54472, name: 'WLG to Mainfreight AKL', active: true, amount: 30, amountPercentage,
      fromDepotId: 1, toDepotId: 2, minutes: 180, linehaulRunId: null,
      insertToBulk: false, applyDiscount: true, applyAddOnPercentage,
      weekDay: [1, 1, 1, 1, 1, 0, 0], departureAdvanceDays: 1,
      fromClientAddress: false, dropOffLocationId: null, speedId: null, chargePerConsignment: false,
    }],
    clientIds: [], clientCodes: [], postcodeIds: [], polygonIds: [],
  } as unknown as ScheduleGroup;
}

let lastPut: { linehauls: Array<Record<string, unknown>> } | null = null;

beforeEach(() => {
  lastPut = null;
  server.use(
    http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [] })),
    http.put('/api/schedules', async ({ request }) => {
      lastPut = (await request.json()) as typeof lastPut;
      return HttpResponse.json({ response: group(null) });
    }),
  );
});

function renderModal(g: ScheduleGroup | null) {
  return renderWithProviders(
    <ScheduleEditModal open onClose={() => {}} group={g} lookups={LOOKUPS} onSaved={() => {}} />,
  );
}

describe('ScheduleEditModal linehaul pricing fields (UC #1115)', () => {
  it('"+ Add Leg" starts the leg with "Discount additional items" on', async () => {
    renderModal(null);
    await userEvent.click(screen.getByRole('button', { name: '+ Add Leg' }));
    expect(screen.getByRole('checkbox', { name: /Discount additional items/ })).toBeChecked();
  });

  it('a loaded leg with NULL stays unticked', () => {
    renderModal(group(null));
    expect(screen.getByRole('checkbox', { name: /Discount additional items/ })).not.toBeChecked();
  });

  it('unticking a ticked leg saves false', async () => {
    renderModal(group(true));
    await userEvent.click(screen.getByRole('checkbox', { name: /Discount additional items/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(lastPut).not.toBeNull());
    expect(lastPut!.linehauls[0].applyAddOnPercentage).toBe(false);
  });

  it('ticking an existing leg and typing 0.5 saves both (Marcus\'s exact edit)', async () => {
    renderModal(group(false));
    await userEvent.click(screen.getByRole('checkbox', { name: /Discount additional items/ }));
    const pct = screen.getByLabelText(/Plus % of delivery zone rate/);
    await userEvent.clear(pct);
    await userEvent.type(pct, '0.5');
    expect(screen.getByText(BOTH_CHARGED_WARNING)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(lastPut).not.toBeNull());
    expect(lastPut!.linehauls[0].applyAddOnPercentage).toBe(true);
    expect(lastPut!.linehauls[0].amountPercentage).toBe(0.5);
  });

  it('blocks the save when "Plus % of delivery zone rate" is above 1', async () => {
    renderModal(group(true, 50));
    expect(screen.getByText(ZONE_PERCENT_TOO_HIGH_MESSAGE)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(lastPut).toBeNull();
  });

  it('uses the new labels', () => {
    renderModal(group(null));
    expect(screen.getByRole('checkbox', { name: /Apply client discount/ })).toBeInTheDocument();
    expect(screen.queryByText('Apply Add-on %')).toBeNull();
    expect(screen.queryByText('Amount %')).toBeNull();
  });

  // The help line sits beside the checkbox, not inside its label, so a screen
  // reader only hears it if the checkbox points at it.
  it('each charging checkbox is described by its help text', () => {
    renderModal(group(null));
    expect(screen.getByRole('checkbox', { name: /Apply client discount/ }))
      .toHaveAccessibleDescription('Uses the Discount on the client.');
    expect(screen.getByRole('checkbox', { name: /Discount additional items/ })).toHaveAccessibleDescription(
      "Charges each additional item at the client's additional item percentage, else the speed's, else 80%.",
    );
  });
});

// SPEC v2 test 8, older editor. Run 43 has a Linehaul tab row for schedule 2894, run 44 has none.
describe('ScheduleEditModal leg priced from the Linehaul tab (UC #1115 test 8)', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/linehaul-rates', () => HttpResponse.json({ response: [
        { runId: 43, anySpeed: { rateId: null }, speedCells: [] },
        { runId: 44, anySpeed: { rateId: null }, speedCells: [] },
      ] })),
      http.get('/api/linehaul-rates/runs/:runId/schedules', ({ params }) => HttpResponse.json({ response:
        params.runId === '43' ? [{ rateId: 1, scheduleId: 2894, speedId: null, active: true, amount: 45, amountPercentage: null }] : [],
      })),
    );
  });

  function onRun(linehaulRunId: number): ScheduleGroup {
    const g = group(true, 0.1);
    g.linehauls[0] = { ...g.linehauls[0], linehaulRunId };
    return g;
  }

  it('hides "Plus % of delivery zone rate", makes Amount read-only, and saves the stored Amount', async () => {
    renderModal(onRun(43));
    expect(await screen.findByText(LINEHAUL_LABELS.amountFromLinehaulTab)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Plus % of delivery zone rate/)).toBeNull();
    expect(screen.queryByText(BOTH_CHARGED_WARNING)).toBeNull();
    const amount = screen.getByDisplayValue('30');
    expect(amount).toHaveAttribute('readonly');
    await userEvent.type(amount, '9');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(lastPut).not.toBeNull());
    expect(lastPut!.linehauls[0].amount).toBe(30);
  });

  it('a leg with no Linehaul tab row keeps both fields editable', async () => {
    renderModal(onRun(44));
    const amount = screen.getByDisplayValue('30');
    await waitFor(() => expect(screen.getByLabelText(/Plus % of delivery zone rate/)).toBeInTheDocument());
    expect(amount).not.toHaveAttribute('readonly');
    expect(screen.queryByText(LINEHAUL_LABELS.amountFromLinehaulTab)).toBeNull();
  });
});

// UC #1115 FIX6 (review F2), MSW made faithful in FIX7 (review G2). Any client can book an
// all-clients (IsDefault) schedule, so the check must use the generic rows only, not the
// clients that happen to be attached. The handler filters like the real endpoint
// (LinehaulRateService.GetScheduleRatesAsync: ClientId == null || ClientId == clientId), so a
// generic row is visible to every client query and a client row only to its own client.
let tabRows: Array<{ clientId: number | null }> = [];

function installLinehaulTab() {
  server.use(
    http.get('/api/linehaul-rates', () => HttpResponse.json({ response: [
      { runId: 45, anySpeed: { rateId: null }, speedCells: [] },
    ] })),
    http.get('/api/linehaul-rates/runs/:runId/schedules', ({ request }) => {
      const raw = new URL(request.url).searchParams.get('clientId');
      const requested = raw == null ? null : Number(raw);
      return HttpResponse.json({ response: tabRows
        .filter((r) => r.clientId == null || r.clientId === requested)
        .map((r, i) => ({ rateId: i + 1, scheduleId: 2894, scheduleName: 'ZB', speedId: null, speedName: '',
          clientId: r.clientId, clientCode: r.clientId == null ? null : 'ZB', amount: 45, amountPercentage: null, active: true })) });
    }),
  );
}

function withClient(isDefault: boolean): ScheduleGroup {
  const g = group(true, 0.1);
  g.linehauls[0] = { ...g.linehauls[0], linehaulRunId: 45 };
  return { ...g, clientIds: [14821], clientCodes: ['ZB'], isDefault };
}

async function expectLocked() {
  expect(await screen.findByText(LINEHAUL_LABELS.amountFromLinehaulTab)).toBeInTheDocument();
  expect(screen.getByDisplayValue('30')).toHaveAttribute('readonly');
}

async function expectEditable() {
  await waitFor(() => expect(screen.getByLabelText(/Plus % of delivery zone rate/)).toBeInTheDocument());
  expect(screen.getByDisplayValue('30')).not.toHaveAttribute('readonly');
  expect(screen.queryByText(LINEHAUL_LABELS.amountFromLinehaulTab)).toBeNull();
}

describe('ScheduleEditModal Linehaul tab check, generic row only (UC #1115 F2)', () => {
  beforeEach(() => { tabRows = [{ clientId: null }]; installLinehaulTab(); });

  it('IsDefault on: the generic row locks the Amount even though a client is attached', async () => {
    renderModal(withClient(true));
    await expectLocked();
  });

  it('IsDefault off: the generic row is visible to the attached client too, so it is locked', async () => {
    renderModal(withClient(false));
    await expectLocked();
  });
});

// The case F2 exists for: a client-only row (client 14821) and no generic row. On an
// all-clients schedule every other client prices from the leg, so the leg must stay
// editable; on a specific-clients schedule only 14821 books it, so the tab row prices it.
describe('ScheduleEditModal Linehaul tab check, client-only row (UC #1115 F2, FIX7 G2)', () => {
  beforeEach(() => { tabRows = [{ clientId: 14821 }]; installLinehaulTab(); });

  it('IsDefault on: the client-only row does not price other clients, so the leg stays editable', async () => {
    renderModal(withClient(true));
    await expectEditable();
  });

  it('IsDefault off: the only client that can book has a tab row, so the Amount is locked', async () => {
    renderModal(withClient(false));
    await expectLocked();
  });
});

// UC #1115 spec 2.4 item 4b (#332): a save turned leg Amount 2.8365 into 2.84. The column is
// money (4 decimals); the editor must send the stored value untouched and a typed value as typed.
describe('ScheduleEditModal leg Amount keeps 4 decimals (UC #1115 #332)', () => {
  function withAmount(amount: number): ScheduleGroup {
    const g = group(true);
    g.linehauls[0] = { ...g.linehauls[0], amount };
    return g;
  }

  it('a stored 2.8365 is shown and saved unchanged when Amount is not edited', async () => {
    renderModal(withAmount(2.8365));
    expect(screen.getByDisplayValue('2.8365')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /Discount additional items/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(lastPut).not.toBeNull());
    expect(lastPut!.linehauls[0].amount).toBe(2.8365);
  });

  it('a typed 11.5094 is sent as typed', async () => {
    renderModal(withAmount(30));
    const amount = screen.getByDisplayValue('30');
    await userEvent.clear(amount);
    await userEvent.type(amount, '11.5094');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(lastPut).not.toBeNull());
    expect(lastPut!.linehauls[0].amount).toBe(11.5094);
  });
});
