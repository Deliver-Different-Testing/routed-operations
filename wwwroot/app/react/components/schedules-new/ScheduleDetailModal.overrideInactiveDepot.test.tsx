// #3 (Kevin, 12 Nov 2026): a client override is saved on top of the base
// schedule's route, so it gets the same inactive-depot block as the base.
// The override body itself carries no depot (Route is read-only in override
// mode), so the message names the base schedule as the place to fix it.
// The control case proves the block is about the depot, not override mode.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/renderWithProviders';
import { server } from '../../test/server';
import { ScheduleDetailModal } from './ScheduleDetailModal';
import { INACTIVE_DEPOT_OVERRIDE_MESSAGE } from '../../lib/depotOptions';

const SCHEDULE_ID = 1039;
const CLIENT_ID = 41;

function detail(pickupDepotId: number) {
  return {
    scheduleId: SCHEDULE_ID,
    name: 'Kaibox Xmas Chch',
    legacyClientId: null,
    legacyClientCode: null,
    regionId: 20,
    regionName: 'Christchurch',
    pickupDepotId,
    pickupDepotName: pickupDepotId === 13 ? 'Christchurch Old' : 'Christchurch',
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
    clientIds: [CLIENT_ID],
    clientCodes: ['KAIBO'],
    clientNames: ['Kaibox'],
    clientLinkedUtcs: ['2026-10-20T00:00:00Z'],
    postcodeIds: [],
    polygonIds: [],
    displayName: null,
    displayDescription: null,
    isActive: true,
    isCollapsed: false,
    occurrencesAhead: null,
    convertRefusalReasons: null,
    isDefault: false,
  };
}

let overridePut: unknown = null;

function installHandlers(pickupDepotId: number) {
  overridePut = null;
  server.use(
    http.get(`/api/v2/schedules/${SCHEDULE_ID}`, () =>
      HttpResponse.json({ response: detail(pickupDepotId) })),
    http.get(`/api/v2/schedules/${SCHEDULE_ID}/overrides`, () =>
      HttpResponse.json({ response: [] })),
    http.get(`/api/v2/schedules/${SCHEDULE_ID}/occurrences`, () =>
      HttpResponse.json({ response: [] })),
    http.get('/api/schedules/lookups', () =>
      HttpResponse.json({
        response: {
          depots: [
            { id: 13, name: 'Christchurch Old', active: false },
            { id: 20, name: 'Christchurch', active: true },
          ],
          speeds: [{ id: 122, name: 'Morning' }],
          postcodeGroups: [], storageStates: [], deliveryStates: [],
          pickupBoxDiscounts: [], linehaulRuns: [], zoneNumbers: [1, 2, 3],
          dropOffLocations: [], couriers: [], clients: [],
        },
      })),
    http.get('/api/recurring-routes', () => HttpResponse.json({ response: [] })),
    http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [] })),
    http.put(`/api/v2/schedules/${SCHEDULE_ID}/overrides/${CLIENT_ID}`, async ({ request }) => {
      overridePut = await request.json();
      return HttpResponse.json({ response: [] });
    }),
  );
}

function renderOverrideModal() {
  return renderWithProviders(
    <ScheduleDetailModal
      scheduleId={SCHEDULE_ID}
      onClose={() => {}}
      onAttachClients={() => {}}
      onOpenSchedule={() => {}}
      onOpenOverride={() => {}}
      overrideMode={{ clientId: CLIENT_ID, clientCode: 'KAIBO', clientName: 'Kaibox', deltaLabels: [] }}
    />,
  );
}

describe('Schedule detail modal - client override save and inactive depots (#3)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks the override save when the base schedule sits on an inactive depot', async () => {
    installHandlers(13);
    const user = userEvent.setup();
    renderOverrideModal();

    const save = await screen.findByRole('button', { name: /^Save/ });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    expect(await screen.findByText(INACTIVE_DEPOT_OVERRIDE_MESSAGE)).toBeInTheDocument();
    expect(overridePut).toBeNull();
  });

  it('saves the override when the base schedule depots are active', async () => {
    installHandlers(20);
    const user = userEvent.setup();
    renderOverrideModal();

    const save = await screen.findByRole('button', { name: /^Save/ });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() => expect(overridePut).not.toBeNull());
    expect(screen.queryByText(INACTIVE_DEPOT_OVERRIDE_MESSAGE)).toBeNull();
  });
});
