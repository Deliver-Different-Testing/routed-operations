// Territory maintenance must be reachable from Schedules NEW, under one
// "Zone groups" tab, with a shareable ?tab= link.
//
// WHY this test exists, and why it must not be deleted along with the thing
// it guards: the zone / postcode-group / depot sub-views are the only surface
// in Routed Operations that maintains the territory ROWS themselves
// (BulkZonePostcode, ZoneZip, ZoneName, ZoneGroup, tblBulkRegion). Until
// 2026-10-20 they lived only on the legacy /schedules page, which the pricing
// spec deletes outright. Retiring that page would have silently removed the
// whole surface, because nothing fails when it goes: schedules keep working,
// and the zone ticks on a schedule's Coverage tab keep rendering - against
// data nobody can edit any more.
//
// Shape comes from PRICING-AND-ZONES-INTO-ROUTED-OPS-2026-10-09 sections 3.1
// and 3.2: ONE tab called "Zone groups", with ZoneGroupsTab / ZonesTab /
// DepotsTab re-homed as sub-views, not as sibling tabs. Acceptance item 6
// adds the ?tab= deep link. These assertions are about reachability and that
// shape, not about each sub-view's own behaviour (covered where it lives).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useLocation } from 'react-router-dom';
import { renderWithProviders } from '../test/renderWithProviders';
import { server } from '../test/server';
import SchedulesNew from './SchedulesNew';

/** Surfaces the router's current query string for assertions. */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="search">{location.search}</span>;
}

const BOOTSTRAP_NZ = {
  countryCode: 'NZ',
  depots: [{ id: 8, name: 'Auckland', active: true }],
  postcodeGroups: [],
  nzPostcodes: [
    {
      id: 1, postCode: 1010, zone: 3, depotId: 8, depotName: 'Auckland',
      postcodeGroupId: null, postcodeGroupName: null, fromSiteId: 0,
      name: 'Auckland Central', fromLatLng: null,
    },
  ],
  usZipZones: [
    {
      id: 1, zip: '90001', zoneNumber: 1, zoneNameId: 40, zoneName: 'ABQ Test Zone',
      zoneGroupId: 7, zoneGroupName: 'California', postcodeGroupId: null,
      postcodeGroupName: null, applyCongestion: false,
    },
  ],
  zoneNames: [],
  zoneGroups: [],
};

/** Counts territory payload fetches, so the keep-alive assertion is about
 *  real network calls rather than about React internals. */
let bootstrapCalls = 0;

function installHandlers(countryCode: 'NZ' | 'US' = 'NZ') {
  bootstrapCalls = 0;
  server.use(
    http.get('/api/territory/bootstrap', () => {
      bootstrapCalls += 1;
      return HttpResponse.json({ response: { ...BOOTSTRAP_NZ, countryCode } });
    }),
    http.get('/api/territory/depots', () =>
      HttpResponse.json({ response: BOOTSTRAP_NZ.depots })),
    // The schedule tabs' own queries. Empty payloads: this test is about the
    // territory surface, and an empty schedule list still renders the tab bar.
    http.get('/api/v2/schedules', () =>
      HttpResponse.json({ response: { items: [], total: 0, page: 0, pageSize: 50 } })),
    http.get('/api/v2/schedule-bundles', () => HttpResponse.json({ response: [] })),
    http.get('/api/recurring-routes', () => HttpResponse.json({ response: [] })),
    http.get('/api/schedules/lookups', () =>
      HttpResponse.json({
        response: {
          depots: [], speeds: [], postcodeGroups: [], storageStates: [],
          linehaulRuns: [], zoneNumbers: [], dropOffLocations: [], couriers: [],
        },
      })),
  );
}

describe('Schedules NEW - Zone groups tab', () => {
  beforeEach(() => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, isUsTenant: false, countryCode: 'NZ' };
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers ONE Zone groups tab, not three sibling territory tabs', async () => {
    installHandlers('NZ');
    renderWithProviders(<SchedulesNew />);

    // The schedule tabs are untouched - territory is added, not swapped in.
    expect(await screen.findByRole('button', { name: /^Schedules/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Schedule Bundles/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Recurring Routes/ })).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /^Zone groups$/ })).toBeInTheDocument();

    // Spec 3.2: these are sub-views INSIDE Zone groups. If they reappear as
    // top-level tabs the nesting the spec asked for has been lost.
    expect(screen.queryByRole('button', { name: /^Zones$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Postcode Groups$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Depots$/ })).not.toBeInTheDocument();
  });

  it('shows the three sub-views once Zone groups is open, groups first', async () => {
    installHandlers('NZ');
    const user = userEvent.setup();
    renderWithProviders(<SchedulesNew />);

    await user.click(await screen.findByRole('button', { name: /^Zone groups$/ }));

    expect(await screen.findByRole('button', { name: /^Postcode Groups$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Zones$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Depots$/ })).toBeInTheDocument();
  });

  it('opens the zone maintenance grid from the Zones sub-view', async () => {
    installHandlers('NZ');
    const user = userEvent.setup();
    renderWithProviders(<SchedulesNew />);

    await user.click(await screen.findByRole('button', { name: /^Zone groups$/ }));
    await user.click(await screen.findByRole('button', { name: /^Zones$/ }));

    // The grid's own add-row action proves we reached the maintenance
    // surface, not just a pill that renders a heading.
    expect(await screen.findByRole('button', { name: /^\+ Add Postcode$/ })).toBeInTheDocument();
    expect(screen.getByText('1010')).toBeInTheDocument();
  });

  it('keeps a visited sub-view mounted so switching back does not refetch', async () => {
    installHandlers('NZ');
    const user = userEvent.setup();
    renderWithProviders(<SchedulesNew />);

    await user.click(await screen.findByRole('button', { name: /^Zone groups$/ }));
    await user.click(await screen.findByRole('button', { name: /^Zones$/ }));
    await screen.findByRole('button', { name: /^\+ Add Postcode$/ });
    // One for the groups sub-view (mounted on open), one for zones.
    await waitFor(() => expect(bootstrapCalls).toBe(2));

    await user.click(screen.getByRole('button', { name: /^Depots$/ }));
    await user.click(screen.getByRole('button', { name: /^Zones$/ }));
    await screen.findByRole('button', { name: /^\+ Add Postcode$/ });

    // Still two. The territory payload is the whole BulkZonePostcode table on
    // a real tenant; refetching it on every sub-view switch is the reason the
    // keep-alive exists.
    expect(bootstrapCalls).toBe(2);
  });

  it('puts the tab in ?tab= so the link can be shared', async () => {
    installHandlers('NZ');
    const user = userEvent.setup();
    // MemoryRouter keeps the URL in its own state and never touches
    // window.location, so the probe is how the test reads it.
    renderWithProviders(
      <>
        <SchedulesNew />
        <LocationProbe />
      </>,
    );

    await user.click(await screen.findByRole('button', { name: /^Zone groups$/ }));
    await waitFor(() =>
      expect(screen.getByTestId('search').textContent).toContain('tab=zonegroups'));

    // Back on Schedules the param is removed rather than left as
    // ?tab=schedules, so the default page keeps a clean URL.
    await user.click(screen.getByRole('button', { name: /^Schedules/ }));
    await waitFor(() =>
      expect(screen.getByTestId('search').textContent).not.toContain('tab='));
  });

  it('opens straight onto Zone groups when the URL already carries ?tab=', async () => {
    installHandlers('NZ');
    renderWithProviders(<SchedulesNew />, { initialRoute: '/schedules-new?tab=zonegroups' });

    // Acceptance item 6: a shared link lands on the tab, not on Schedules.
    expect(await screen.findByRole('button', { name: /^Postcode Groups$/ })).toBeInTheDocument();
  });

  it('falls back to Schedules when ?tab= is a value we do not know', async () => {
    installHandlers('NZ');
    renderWithProviders(<SchedulesNew />, { initialRoute: '/schedules-new?tab=nonsense' });

    // Not a blank page: an unknown tab renders the default one.
    expect(await screen.findByRole('button', { name: /^Schedules/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Postcode Groups$/ })).not.toBeInTheDocument();
  });

  it('hides + New Schedule while Zone groups is open', async () => {
    installHandlers('NZ');
    const user = userEvent.setup();
    renderWithProviders(<SchedulesNew />);

    expect(await screen.findByRole('button', { name: /\+ New Schedule/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Zone groups$/ }));

    // The page-level primary action creates a SCHEDULE. Under Zone groups
    // that is the wrong verb for what is on screen.
    expect(screen.queryByRole('button', { name: /\+ New Schedule/ })).not.toBeInTheDocument();
  });

  it('labels the sub-views for a US tenant', async () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, isUsTenant: true, countryCode: 'US' };
    installHandlers('US');
    const user = userEvent.setup();
    renderWithProviders(<SchedulesNew />);

    await user.click(await screen.findByRole('button', { name: /^Zone groups$/ }));

    // Same DB entities, different operator-facing words. A US operator who
    // sees "Postcode Groups" and "Depots" does not recognise their own data.
    expect(screen.getByRole('button', { name: /^Locations$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Postcode Groups$/ })).not.toBeInTheDocument();

    // NOT "Zip Groups". The postcode-group section is hidden on US (see
    // the next test), so a pill named after it would point at the one
    // thing the view no longer shows. What is left there is the US
    // ZoneGroup and ZoneName grids.
    expect(await screen.findByRole('button', { name: /^Zone Groups$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Zip Groups$/ })).not.toBeInTheDocument();
  });

  it('hides the postcode-group section on US but keeps it on NZ', async () => {
    // Steve 23 Oct: a US schedule resolves zip -> ZoneName -> LocationId
    // and never reads BulkZonePostcodeGroup, so the section manages
    // nothing there and its Add button invites a group that does nothing.
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, isUsTenant: true, countryCode: 'US' };
    installHandlers('US');
    const user = userEvent.setup();
    renderWithProviders(<SchedulesNew />);

    await user.click(await screen.findByRole('button', { name: /^Zone groups$/ }));
    await screen.findByRole('button', { name: /^Zone Groups$/ });

    expect(screen.queryByRole('button', { name: /Add Zip Group/i })).not.toBeInTheDocument();
    // The US-only grids it shares the view with are still there.
    expect(await screen.findByRole('button', { name: /Add Zone Group/i })).toBeInTheDocument();
  });

  it('keeps the postcode-group section on an NZ tenant with no groups yet', async () => {
    // The gate is the TENANT, not the row count. BOOTSTRAP_NZ carries an
    // empty postcodeGroups array on purpose: a fresh NZ tenant has to keep
    // the section so it can create its first group. Hiding on emptiness
    // would lock it out permanently.
    installHandlers('NZ');
    const user = userEvent.setup();
    renderWithProviders(<SchedulesNew />);

    await user.click(await screen.findByRole('button', { name: /^Zone groups$/ }));

    expect(await screen.findByRole('button', { name: /Add Postcode Group/i })).toBeInTheDocument();
  });

  it('drops the zip-group column from the US zones grid', async () => {
    // Follows from hiding the section: ZoneZip.ZoneZipGroupId stays null on
    // US, so the column was always "-", and after the hide it named groups
    // the operator can no longer see. "Zone Group" is a DIFFERENT column
    // (ZoneName.ZoneGroupID) and must survive.
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, isUsTenant: true, countryCode: 'US' };
    installHandlers('US');
    const user = userEvent.setup();
    renderWithProviders(<SchedulesNew />);

    await user.click(await screen.findByRole('button', { name: /^Zone groups$/ }));
    await user.click(await screen.findByRole('button', { name: /^Zones$/ }));

    // Congestion is unique to the zips grid, so it proves that grid is the
    // one on screen. Zone Name and Zone Group headers appear on the Zone
    // Names grid too, which stays mounted, so they cannot be asserted
    // singly here; the one that matters is the absence below.
    expect(await screen.findByRole('columnheader', { name: /Congestion/i })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /^Zip Group/i })).not.toBeInTheDocument();
  });

  it('keeps the postcode-group column on the NZ zones grid', async () => {
    installHandlers('NZ');
    const user = userEvent.setup();
    renderWithProviders(<SchedulesNew />);

    await user.click(await screen.findByRole('button', { name: /^Zone groups$/ }));
    await user.click(await screen.findByRole('button', { name: /^Zones$/ }));

    expect(await screen.findByRole('columnheader', { name: /^Postcode Group/i })).toBeInTheDocument();
  });
});
