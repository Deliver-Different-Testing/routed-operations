import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';

// Same drilldown stub as .render tests - the editor + roster tests don't
// exercise it.
vi.mock('./recurring-routes/MappedStopsDrilldown', () => ({
  MappedStopsDrilldown: () => <div data-testid="mapped-stops" />,
}));

import ScheduledRoutes from './ScheduledRoutes';

const emptyTargets = { couriers: [], agents: [], nps: [] };

const stubTargets = (t = emptyTargets) =>
  http.get('/api/recurring-routes/assignable-targets', () =>
    HttpResponse.json({ response: t }));

const stubSchedules = (list: unknown[] = []) =>
  http.get('/api/recurring-routes/schedules/lookup', () =>
    HttpResponse.json({ response: list }));

const stubZipcodeSearch = (results: unknown[] = []) =>
  http.get('/api/recurring-routes/zipcodes/search', () =>
    HttpResponse.json({ response: results }));

const stubZipcodeShapes = () =>
  http.post('/api/recurring-routes/zipcodes/shapes', () =>
    HttpResponse.json({ response: [] }));

const stubCentroids = () =>
  http.get('/api/recurring-routes/zipcodes/centroids', () =>
    HttpResponse.json({ response: [] }));

const stubRoutes = (routes: unknown[]) =>
  http.get('/api/recurring-routes', () =>
    HttpResponse.json({ response: routes }));

const stubRoster = (routeId: number, entries: unknown[] = []) =>
  http.get(`/api/recurring-routes/${routeId}/roster`, () =>
    HttpResponse.json({ response: entries }));

const baseline = () => [
  stubTargets(), stubSchedules(), stubZipcodeSearch(), stubZipcodeShapes(),
  stubCentroids(),
];

const route = (over: Partial<Record<string, unknown>> = {}) => ({
  routeId: 1, name: 'RNO200', area: 'Reno North',
  defaultTargetType: 1, defaultTargetId: 5, defaultTargetName: 'Kev',
  scheduleId: null, scheduleName: '', scheduleWindow: '',
  schedules: [], active: true, zipcodes: [], bulkPolygons: [],
  rosterEntryCount: 0, bookingCount: 0, mappedStopsCount: 0,
  createdAt: '2026-08-13T00:00:00Z', updatedAt: null,
  ...over,
});

async function openEditor(name = 'RNO200') {
  const user = userEvent.setup();
  await user.click(await screen.findByText(name));
  await screen.findByRole('heading', { name: new RegExp(`Edit "${name}"`) });
  return user;
}

describe('ScheduledRoutes - RouteEditor', () => {
  it('renders the editor Modal on row click and prefills the name + area', async () => {
    server.use(...baseline(), stubRoutes([route()]));
    renderWithProviders(<ScheduledRoutes />);
    await openEditor();
    expect(screen.getByPlaceholderText('e.g. RNO200')).toHaveValue('RNO200');
    expect(screen.getByPlaceholderText('e.g. NeoGenomics medical corridor'))
      .toHaveValue('Reno North');
  });

  it('renders the Google-Maps-not-configured placeholder when the key is null', async () => {
    server.use(...baseline(), stubRoutes([route()]));
    renderWithProviders(<ScheduledRoutes />);
    await openEditor();
    expect(screen.getByText(/Google Maps API key is not set/)).toBeInTheDocument();
  });

  it('adds a zip from the search dropdown and shows the removable pill', async () => {
    // Override the zipcodes search handler BEFORE baseline so it matches first.
    server.use(
      http.get('/api/recurring-routes/zipcodes/search', () =>
        HttpResponse.json({ response: [{ zipPolygonId: 501, zip: '89501', latitude: 39.5, longitude: -119.8 }] })),
      ...baseline(),
      stubRoutes([route()]),
    );
    renderWithProviders(<ScheduledRoutes />);
    const user = await openEditor();
    // Type into the zip search input (labeled "Type to search postcodes/zips…")
    const searchInput = screen.getByPlaceholderText(/Type to search /);
    await user.type(searchInput, '895');
    // Wait for the debounced results (250ms debounce; give it a wider window)
    const zipResult = await screen.findByRole(
      'button',
      { name: '89501' },
      { timeout: 3000 },
    );
    await user.click(zipResult);
    // The remove x button appears once the pill is added
    await waitFor(() =>
      expect(screen.getByTitle('Remove 89501 from route')).toBeInTheDocument(),
    );
  });

  it('removes a zip via the × button', async () => {
    server.use(
      ...baseline(),
      stubRoutes([route({
        zipcodes: [{ zipPolygonId: 501, zip: '89501' }],
      })]),
    );
    renderWithProviders(<ScheduledRoutes />);
    const user = await openEditor();
    // Pill visible
    expect(screen.getByTitle('Remove 89501 from route')).toBeInTheDocument();
    await user.click(screen.getByTitle('Remove 89501 from route'));
    await waitFor(() =>
      expect(screen.queryByTitle('Remove 89501 from route')).not.toBeInTheDocument(),
    );
  });

  it('toggles a schedule via the checkbox', async () => {
    server.use(
      stubSchedules([{ id: 10, name: 'AM Run', startTime: '08:00', endTime: '10:00', days: [1, 2] }]),
      stubTargets(), stubZipcodeSearch(), stubZipcodeShapes(), stubCentroids(),
      stubRoutes([route()]),
    );
    renderWithProviders(<ScheduledRoutes />);
    const user = await openEditor();
    // Wait for the schedule to appear in the picker
    const scheduleName = await screen.findByText('AM Run');
    const chkbox = scheduleName.closest('label')!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(chkbox.checked).toBe(false);
    await user.click(chkbox);
    expect(chkbox.checked).toBe(true);
  });

  it('filters schedules by name via the schedule filter input', async () => {
    server.use(
      stubSchedules([
        { id: 10, name: 'AM Run', startTime: '08:00', endTime: '10:00', days: [1] },
        { id: 11, name: 'PM Run', startTime: '15:00', endTime: '17:00', days: [1] },
      ]),
      stubTargets(), stubZipcodeSearch(), stubZipcodeShapes(), stubCentroids(),
      stubRoutes([route()]),
    );
    renderWithProviders(<ScheduledRoutes />);
    const user = await openEditor();
    await screen.findByText('AM Run');
    const filterInput = screen.getByPlaceholderText(/Filter schedules by name/);
    await user.type(filterInput, 'PM');
    await waitFor(() => expect(screen.queryByText('AM Run')).not.toBeInTheDocument());
    expect(screen.getByText('PM Run')).toBeInTheDocument();
  });

  it('shows the No matches state when the filter excludes everything', async () => {
    server.use(
      stubSchedules([{ id: 10, name: 'AM Run', startTime: '08:00', endTime: '10:00', days: [] }]),
      stubTargets(), stubZipcodeSearch(), stubZipcodeShapes(), stubCentroids(),
      stubRoutes([route()]),
    );
    renderWithProviders(<ScheduledRoutes />);
    const user = await openEditor();
    await screen.findByText('AM Run');
    const filterInput = screen.getByPlaceholderText(/Filter schedules by name/);
    await user.type(filterInput, 'zzz');
    expect(await screen.findByText('No matches')).toBeInTheDocument();
  });

  it('switches target type + populates the target dropdown from targets', async () => {
    server.use(
      stubTargets({
        couriers: [{ id: 5, name: 'Kev', hint: 'K' }, { id: 6, name: 'Bob', hint: 'B' }],
        agents: [{ id: 100, name: 'Agency', hint: 'A' }],
        nps: [{ id: 200, name: 'Partner', hint: 'NP' }],
      }),
      stubSchedules(), stubZipcodeSearch(), stubZipcodeShapes(), stubCentroids(),
      stubRoutes([route({ defaultTargetType: null, defaultTargetId: null, defaultTargetName: '' })]),
    );
    renderWithProviders(<ScheduledRoutes />);
    const user = await openEditor();
    // Wait until the targets have loaded (via the effect)
    await waitFor(() => {
      const opts = screen.getAllByRole('option');
      expect(opts.length).toBeGreaterThan(3);
    });
    // Grab the "Default target type" select (the one with '- None -' option)
    const typeSelect = screen.getAllByRole('combobox').find(
      (el) => (el as HTMLSelectElement).options[0].text === '- None -',
    ) as HTMLSelectElement;
    await user.selectOptions(typeSelect, '2');   // Agent
    // The agent should now be selectable in the sibling select
    const targetSelect = screen.getAllByRole('combobox').find(
      (el) => (el as HTMLSelectElement).options[0].text === '- Pick target -',
    ) as HTMLSelectElement;
    expect(targetSelect.disabled).toBe(false);
    expect([...targetSelect.options].map((o) => o.text)).toContain('Agency');
  });

  it('toggles the Active checkbox', async () => {
    server.use(...baseline(), stubRoutes([route({ active: true })]));
    renderWithProviders(<ScheduledRoutes />);
    const user = await openEditor();
    const activeChkbox = screen.getByLabelText('Active') as HTMLInputElement;
    expect(activeChkbox.checked).toBe(true);
    await user.click(activeChkbox);
    expect(activeChkbox.checked).toBe(false);
  });

  it('save with empty name shows validation toast', async () => {
    server.use(...baseline(), stubRoutes([route()]));
    renderWithProviders(<ScheduledRoutes />);
    const user = await openEditor();
    const nameInput = screen.getByPlaceholderText('e.g. RNO200') as HTMLInputElement;
    await user.clear(nameInput);
    // Ignore unsaved-changes guard for now - just click Save
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Route name is required/)).toBeInTheDocument();
  });

  it('saves an existing route via PUT and closes the modal', async () => {
    let putBody: any = null;
    server.use(
      ...baseline(),
      stubRoutes([route({ name: 'RNO200' })]),
      http.put('/api/recurring-routes/1', async ({ request }) => {
        putBody = await request.json();
        return HttpResponse.json({ response: route({ name: 'RNO200b' }) });
      }),
    );
    renderWithProviders(<ScheduledRoutes />);
    const user = await openEditor();
    const nameInput = screen.getByPlaceholderText('e.g. RNO200') as HTMLInputElement;
    await user.clear(nameInput);
    await user.type(nameInput, 'RNO200b');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putBody).not.toBeNull());
    expect(putBody.name).toBe('RNO200b');
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: /Edit "/ })).not.toBeInTheDocument(),
    );
  });

  it('creates a new route via POST', async () => {
    let postedName: string | null = null;
    server.use(
      ...baseline(),
      stubRoutes([]),
      http.post('/api/recurring-routes', async ({ request }) => {
        const body = await request.json();
        postedName = (body as any).name;
        return HttpResponse.json({ response: route({ name: (body as any).name }) });
      }),
    );
    renderWithProviders(<ScheduledRoutes />);
    await screen.findByText(/No routes yet/);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Add Route/ }));
    await user.type(screen.getByPlaceholderText('e.g. RNO200'), 'Fresh');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(postedName).toBe('Fresh'));
  });

  it('unsaved-changes guard fires on cancel when the form is dirty', async () => {
    server.use(...baseline(), stubRoutes([route()]));
    renderWithProviders(<ScheduledRoutes />);
    const user = await openEditor();
    // Make a dirty edit
    const nameInput = screen.getByPlaceholderText('e.g. RNO200') as HTMLInputElement;
    await user.clear(nameInput);
    await user.type(nameInput, 'RNO200-EDITED');
    // Click Cancel
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    // The unsaved-changes modal appears
    expect(await screen.findByRole('heading', { name: 'Unsaved changes' }))
      .toBeInTheDocument();
    // "Keep editing" dismisses
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Unsaved changes' })).not.toBeInTheDocument(),
    );
  });

  it('discard from the unsaved-changes guard closes the editor without saving', async () => {
    server.use(...baseline(), stubRoutes([route()]));
    renderWithProviders(<ScheduledRoutes />);
    const user = await openEditor();
    const nameInput = screen.getByPlaceholderText('e.g. RNO200') as HTMLInputElement;
    await user.clear(nameInput);
    await user.type(nameInput, 'RNO200-EDITED');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await screen.findByRole('heading', { name: 'Unsaved changes' });
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Unsaved changes' })).not.toBeInTheDocument(),
    );
    // The editor is closed too
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: /Edit "RNO200"/ })).not.toBeInTheDocument(),
    );
  });

  it('renders the OR-overlap warning banner when route has zips AND coverage polygons', async () => {
    server.use(
      ...baseline(),
      stubRoutes([route({
        zipcodes: [{ zipPolygonId: 1, zip: '89501' }],
        bulkPolygons: [{ polygonId: 10, name: 'North Zone', centroidLatitude: 0, centroidLongitude: 0 }],
      })]),
      http.get('/api/bulk-polygons/10', () =>
        HttpResponse.json({ response: { polygonId: 10, name: 'North Zone', points: [] } })),
    );
    renderWithProviders(<ScheduledRoutes />);
    await openEditor();
    expect(await screen.findByText(/Route uses both zip codes AND coverage polygons\./))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear zips' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear coverage' })).toBeInTheDocument();
  });

  it('shows the bookings section when opened + reports count', async () => {
    server.use(
      ...baseline(),
      stubRoutes([route({ bookingCount: 3 })]),
      http.get('/api/recurring-routes/1/bookings', () =>
        HttpResponse.json({ response: [
          { id: 1, clientName: 'Acme', pickupWindow: '08:00-09:00', days: 'Mon,Tue', nextDue: '2026-08-15T00:00:00Z' },
        ] })),
    );
    renderWithProviders(<ScheduledRoutes />);
    const user = await openEditor();
    // The Bookings toggle shows the count
    const toggle = screen.getByRole('button', { name: /Bookings on this route \(3\)/ });
    await user.click(toggle);
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Mon,Tue')).toBeInTheDocument();
  });

  it('bookings section shows the empty-state when API returns []', async () => {
    server.use(
      ...baseline(),
      stubRoutes([route({ bookingCount: 0 })]),
      http.get('/api/recurring-routes/1/bookings', () =>
        HttpResponse.json({ response: [] })),
    );
    renderWithProviders(<ScheduledRoutes />);
    const user = await openEditor();
    const toggle = screen.getByRole('button', { name: /Bookings on this route \(0\)/ });
    await user.click(toggle);
    expect(await screen.findByText(/No live recurring bookings on this route\./))
      .toBeInTheDocument();
  });
});

describe('ScheduledRoutes - RosterModal', () => {
  it('renders + adds a DOW roster entry via the add form', async () => {
    let posted: any = null;
    server.use(
      stubTargets({
        couriers: [{ id: 5, name: 'Kev', hint: 'K' }],
        agents: [], nps: [],
      }),
      stubSchedules(), stubZipcodeSearch(), stubZipcodeShapes(), stubCentroids(),
      stubRoutes([route({ rosterEntryCount: 0 })]),
      stubRoster(1, []),
      http.post('/api/recurring-routes/1/roster', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ response: { routeRosterId: 900 } });
      }),
    );
    renderWithProviders(<ScheduledRoutes />);
    const user = userEvent.setup();
    // Open roster modal via the Manage-roster button
    await user.click(await screen.findByTitle('Manage roster'));
    await screen.findByRole('heading', { name: /Roster - RNO200/ });
    // Pick target (Kev) via the "Target" select
    await waitFor(() => {
      const opts = screen.getAllByRole('option');
      // At least one option holds the courier name
      expect(opts.some((o) => o.textContent === 'Kev')).toBe(true);
    });
    const selects = screen.getAllByRole('combobox');
    // First select is Target type (defaulted to Courier); second is Target
    await user.selectOptions(selects[1], '5');
    // Third select is the DOW dropdown
    await user.selectOptions(selects[2], '3');   // Wed
    await user.click(screen.getByRole('button', { name: 'Add entry' }));
    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted.targetType).toBe(1);
    expect(posted.targetId).toBe(5);
    expect(posted.dayOfWeek).toBe(3);
    expect(posted.rosterDate).toBeNull();
  });

  it('switching to One-off date mode renders a date input', async () => {
    server.use(
      ...baseline(),
      stubRoutes([route()]),
      stubRoster(1, []),
    );
    renderWithProviders(<ScheduledRoutes />);
    const user = userEvent.setup();
    await user.click(await screen.findByTitle('Manage roster'));
    await screen.findByRole('heading', { name: /Roster - RNO200/ });
    await user.click(screen.getByRole('button', { name: 'One-off date' }));
    expect(document.querySelector('input[type="date"]')).toBeTruthy();
  });

  it('renders existing roster entries and removes on the delete-confirm', async () => {
    let deleted: string | null = null;
    let rosterHits = 0;
    server.use(
      ...baseline(),
      stubRoutes([route({ rosterEntryCount: 1 })]),
      http.get('/api/recurring-routes/1/roster', () => {
        rosterHits++;
        return HttpResponse.json({
          response: rosterHits === 1
            ? [{
                routeRosterId: 700, routeId: 1,
                targetType: 1, targetId: 5, targetName: 'Kev',
                rosterDate: null, dayOfWeek: 2, isActive: true,
                createdAt: '2026-08-13',
              }]
            : [],
        });
      }),
      http.delete('/api/recurring-routes/1/roster/:id', ({ params }) => {
        deleted = String(params.id);
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    renderWithProviders(<ScheduledRoutes />);
    const user = userEvent.setup();
    await user.click(await screen.findByTitle('Manage roster'));
    // Wait for the roster modal to open + roster entries to load
    await screen.findByRole('heading', { name: /Roster - RNO200/ });
    await waitFor(() => expect(screen.getAllByText('Kev').length).toBeGreaterThan(0));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    // Confirm dialog appears
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(deleted).toBe('700'));
  });

  it('shows inactive entries only when the Show inactive box is ticked', async () => {
    server.use(
      ...baseline(),
      stubRoutes([route()]),
      http.get('/api/recurring-routes/1/roster', () =>
        HttpResponse.json({
          response: [
            { routeRosterId: 1, routeId: 1, targetType: 1, targetId: 5,
              targetName: 'ActiveKev', rosterDate: null, dayOfWeek: 1,
              isActive: true, createdAt: '2026-08-13' },
            { routeRosterId: 2, routeId: 1, targetType: 1, targetId: 6,
              targetName: 'InactiveBob', rosterDate: null, dayOfWeek: 1,
              isActive: false, createdAt: '2026-08-13' },
          ],
        })),
    );
    renderWithProviders(<ScheduledRoutes />);
    const user = userEvent.setup();
    await user.click(await screen.findByTitle('Manage roster'));
    expect(await screen.findByText('ActiveKev')).toBeInTheDocument();
    expect(screen.queryByText('InactiveBob')).not.toBeInTheDocument();
    // Toggle Show inactive - the RosterModal has its own checkbox
    const chks = document.querySelectorAll('input[type="checkbox"]');
    // Find the last "Show inactive" (the roster one)
    await user.click(chks[chks.length - 1]);
    await waitFor(() => expect(screen.getByText('InactiveBob')).toBeInTheDocument());
  });

  it('renders the empty-roster message when there are no entries', async () => {
    server.use(
      ...baseline(),
      stubRoutes([route()]),
      stubRoster(1, []),
    );
    renderWithProviders(<ScheduledRoutes />);
    const user = userEvent.setup();
    await user.click(await screen.findByTitle('Manage roster'));
    expect(await screen.findByText('No roster entries.')).toBeInTheDocument();
  });
});
