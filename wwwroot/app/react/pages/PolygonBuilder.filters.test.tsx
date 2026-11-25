import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { buildGoogleMapsStub, installBaseHandlers } from './PolygonBuilder.testHelpers';
import { FILTERS_STORAGE_KEY, LEGACY_VISIBILITY_STORAGE_KEY, PERIMETER_CONFIRM_TEXT } from '../lib/polygonFilters';

vi.mock('@googlemaps/markerclusterer', () => ({
  MarkerClusterer: class {
    constructor(_: any) {}
    setMap() {}
    clearMarkers() {}
    addMarker() {}
    addMarkers() {}
    removeMarker() {}
    removeMarkers() {}
    render() {}
    onAdd() {}
    onRemove() {}
    draw() {}
  },
  SuperClusterAlgorithm: class {
    constructor(_: any) {}
  },
}));

import PolygonBuilder from './PolygonBuilder';

/** The last button with this name: the confirm dialog renders after the page. */
const lastButton = (name: string) => {
  const all = screen.getAllByRole('button', { name });
  return all[all.length - 1];
};

const square = (lat: number, lng: number) => [
  { ringIndex: 0, orderIndex: 0, lat, lng },
  { ringIndex: 0, orderIndex: 1, lat, lng: lng + 0.01 },
  { ringIndex: 0, orderIndex: 2, lat: lat - 0.01, lng: lng + 0.01 },
  { ringIndex: 0, orderIndex: 3, lat: lat - 0.01, lng },
];

const polygon = (polygonId: number, name: string, layer: string | null, apps: string[], extra: Record<string, unknown> = {}) => ({
  polygonId, name, layer, apps,
  colorHex: null,
  centroidLatitude: -36.85, centroidLongitude: 174.76,
  sourceType: 0, sourceCode: null, active: true,
  points: square(-36.85, 174.76),
  attachedRouteCount: 0, attachedRoutes: [], zoneMemberships: [],
  partiallyIncludedZips: null,
  createdUtc: '2026-11-11T02:00:00Z', createdBy: 'steve@urgent.co.nz',
  lastModifiedUtc: null, updatedBy: null,
  zoneNameId: null, postcodeGroupId: null, attachedScheduleNames: [],
  zoneNameName: null, postcodeGroupName: null,
  ...extra,
});

let data: ReturnType<typeof polygon>[] = [];

beforeEach(() => {
  (window as any).__APP_USER__ = {
    ...(window as any).__APP_USER__,
    googleMapsKey: 'fake-key',
    isUsTenant: false,
  };
  (window as any).google = buildGoogleMapsStub();
  vi.clearAllMocks();
  window.localStorage.removeItem(FILTERS_STORAGE_KEY);
  data = [
    polygon(1, 'AD Deep East', 'AD', ['AUTODISPATCH']),
    polygon(2, 'MC8 Otahuhu', 'Routes', ['SCHEDULES', 'ROUTES'], {
      zoneMemberships: [{ id: 9, postcodeGroupId: 4, postcodeGroupName: 'Std Auckland', depotId: 1, depotName: 'Akl', zone: 3 }],
    }),
    polygon(3, 'Auckland metro boundary', 'City boundaries', ['PERIMETER']),
    polygon(4, 'Marcus test 2', null, []),
  ];
  installBaseHandlers();
  server.use(http.get('/api/bulk-polygons', () => HttpResponse.json({ response: data })));
});

afterEach(() => {
  delete (window as any).google;
  window.localStorage.removeItem(FILTERS_STORAGE_KEY);
});

const rowNames = () => screen.queryAllByTestId('pb-polygon-row')
  .map((r) => r.querySelector('button')?.textContent);
const countText = () => screen.getByTestId('pb-filter-count').textContent;
const rowFor = (name: string) => screen.getAllByTestId('pb-polygon-row')
  .find((r) => r.querySelector('button')?.textContent === name)!;

/** Open a polygon's card by clicking its name in the list (review C6). */
async function openCard(name: string) {
  fireEvent.click(within(rowFor(name)).getByRole('button', { name }));
  return screen.findByTestId('pb-polygon-card');
}

async function openUsedBy() {
  fireEvent.click(within(screen.getByTestId('pb-filter-usedby')).getByRole('button', { name: /Used by/ }));
  return screen.findByRole('dialog', { name: 'Used by' });
}

describe('PolygonBuilder - filter bar (spec 4.4.1)', () => {
  it('shows N of M, no eye toggles, and the Postcode lines toggle in place of Hide postcode boundaries', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');
    expect(countText()).toBe('4 of 4');
    expect(screen.queryByRole('button', { name: /^Hide layer/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Hide polygon/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /postcode boundaries/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Postcode lines/ })).toBeInTheDocument();
    expect(screen.getByTestId('pb-map-legend').textContent).toContain('City boundary');
  });

  it('search narrows the list and the count; Clear resets it', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');
    fireEvent.change(screen.getByLabelText('Search polygons'), { target: { value: 'std auckland' } });
    await waitFor(() => expect(rowNames()).toEqual(['MC8 Otahuhu']));
    expect(countText()).toBe('1 of 4');
    // Search is not persisted.
    expect(window.localStorage.getItem(FILTERS_STORAGE_KEY) ?? '').not.toContain('std auckland');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(rowNames()).toHaveLength(4));
  });

  it('Used by filters with counts, including Not used by any app, and persists', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');
    const pop = await openUsedBy();
    const schedules = within(pop).getByRole('checkbox', { name: 'Schedules' });
    expect(schedules.closest('label')!.textContent).toContain('1');
    fireEvent.click(within(pop).getByRole('checkbox', { name: 'Not used by any app' }));
    await waitFor(() => expect(rowNames()).toEqual(['Marcus test 2']));
    fireEvent.click(within(pop).getByRole('checkbox', { name: 'Auto Dispatch' }));
    await waitFor(() => expect(rowNames()).toEqual(['AD Deep East', 'Marcus test 2']));
    expect(within(screen.getByTestId('pb-filter-usedby')).getByRole('button', { name: /Used by: 2 apps/ })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(FILTERS_STORAGE_KEY)!).apps).toEqual(['NONE', 'AUTODISPATCH']);
  });

  it('Quick link City boundaries shows only PERIMETER polygons with a dashed swatch', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');
    fireEvent.click(screen.getByRole('button', { name: 'City boundaries' }));
    await waitFor(() => expect(rowNames()).toEqual(['Auckland metro boundary']));
    const swatch = within(rowFor('Auckland metro boundary')).getByTestId('pb-polygon-swatch');
    expect(swatch.getAttribute('data-perimeter')).toBe('true');
  });

  it('Layer filter ANDs with Used by and shows No polygons match + Clear when nothing passes', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');
    fireEvent.click(screen.getByRole('button', { name: 'Schedule zones' }));
    await waitFor(() => expect(rowNames()).toEqual(['MC8 Otahuhu']));
    fireEvent.click(within(screen.getByTestId('pb-filter-layer')).getByRole('button', { name: /Layer/ }));
    const pop = await screen.findByRole('dialog', { name: 'Layer' });
    fireEvent.click(within(pop).getByRole('checkbox', { name: 'AD' }));
    await waitFor(() => expect(screen.getByTestId('pb-no-match')).toBeInTheDocument());
    expect(countText()).toBe('0 of 4');
    fireEvent.click(within(screen.getByTestId('pb-no-match')).getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(rowNames()).toHaveLength(4));
  });

  it('Others Faded draws non-matching polygons as thin grey, not clickable; Hidden drops them', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');
    const g = (window as any).google;
    // Last options each coverage polygon was given, and whether it was
    // later taken off the map.
    const coverage = () => (g.maps.Polygon.mock.instances as any[])
      .filter((p) => p.setOptions.mock.calls.length > 0)
      .map((p) => ({
        opts: p.setOptions.mock.calls[p.setOptions.mock.calls.length - 1][0],
        removed: p.setMap.mock.calls.some((c: any[]) => c[0] === null),
      }));
    fireEvent.click(screen.getByRole('button', { name: 'AD corridors' }));
    await waitFor(() => expect(rowNames()).toEqual(['AD Deep East']));
    await waitFor(() => {
      const faded = coverage().filter((p) => p.opts.strokeColor === '#9ca3af');
      expect(faded).toHaveLength(3);
      expect(faded.every((p) => p.opts.clickable === false && p.opts.strokeWeight === 1)).toBe(true);
    });
    const live = coverage().filter((p) => p.opts.strokeColor !== '#9ca3af');
    expect(live.some((p) => p.opts.clickable === true)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Hidden' }));
    await waitFor(() => {
      const faded = coverage().filter((p) => p.opts.strokeColor === '#9ca3af');
      expect(faded.every((p) => p.removed)).toBe(true);
    });
    expect(JSON.parse(window.localStorage.getItem(FILTERS_STORAGE_KEY)!).others).toBe('hidden');
  });

  it('starts from defaults when the saved filters are corrupt and drops the old visibility key', async () => {
    window.localStorage.setItem(FILTERS_STORAGE_KEY, '{oops');
    window.localStorage.setItem(LEGACY_VISIBILITY_STORAGE_KEY, '{"hiddenLayers":["AD"]}');
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');
    expect(countText()).toBe('4 of 4');
    expect(window.localStorage.getItem(LEGACY_VISIBILITY_STORAGE_KEY)).toBeNull();
  });
});

describe('PolygonBuilder - list badges and bulk Used by (spec 4.4.2)', () => {
  it('rows show zone text and app badges, or italic not used', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');
    const mc8 = rowFor('MC8 Otahuhu');
    expect(mc8.textContent).toContain('Std Auckland - Zone 3');
    expect(within(mc8).getByTestId('pb-app-badges').textContent).toBe('SchRt');
    expect(within(rowFor('Auckland metro boundary')).getByTestId('pb-app-badges').textContent).toBe('CB');
    expect(within(rowFor('Marcus test 2')).getByTestId('pb-app-badges').textContent).toBe('not used');
  });

  it('Select all ticks the matching polygons; Used by: Set adds and removes through setAppsBulk', async () => {
    const bodies: any[] = [];
    server.use(http.put('/api/bulk-polygons/apps', async ({ request }) => {
      const body: any = await request.json();
      bodies.push(body);
      data = data.map((p) => (body.polygonIds.includes(p.polygonId)
        ? { ...p, apps: Array.from(new Set([...p.apps, ...body.add])).filter((a) => !body.remove.includes(a)) }
        : p));
      return HttpResponse.json({ response: { updated: body.polygonIds.length, perimeterChanged: false } });
    }));
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');
    fireEvent.click(screen.getByRole('button', { name: 'Schedule zones' }));
    await waitFor(() => expect(rowNames()).toEqual(['MC8 Otahuhu']));
    fireEvent.click(screen.getByRole('button', { name: 'Select all 1' }));
    await screen.findByText('1 selected');
    expect(screen.getByRole('button', { name: /Save coverage as Route \(1\)/ })).toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId('pb-bulk-usedby')).getByRole('button'));
    const pop = await screen.findByRole('dialog', { name: 'Used by' });
    expect((within(pop).getByRole('checkbox', { name: 'Schedules' }) as HTMLInputElement).checked).toBe(true);
    expect((within(pop).getByRole('checkbox', { name: 'Zone rating' }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(within(pop).getByRole('checkbox', { name: 'Zone rating' }));
    await waitFor(() => expect(bodies).toEqual([{ polygonIds: [2], add: ['ZONE_RATING'], remove: [] }]));
    await waitFor(() => expect(within(rowFor('MC8 Otahuhu')).getByTestId('pb-app-badges').textContent).toBe('SchRtZr'));

    fireEvent.click(within(pop).getByRole('checkbox', { name: 'Routes' }));
    await waitFor(() => expect(bodies[1]).toEqual({ polygonIds: [2], add: [], remove: ['ROUTES'] }));

    fireEvent.click(within(screen.getByTestId('pb-bulk-header')).getByRole('button', { name: 'Clear' }));
    await screen.findByRole('button', { name: 'Select all 1' });
  });

  it('bulk City boundary asks first and Cancel sends nothing', async () => {
    let called = false;
    server.use(http.put('/api/bulk-polygons/apps', () => {
      called = true;
      return HttpResponse.json({ response: { updated: 1, perimeterChanged: true } });
    }));
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');
    fireEvent.click(within(rowFor('AD Deep East')).getByRole('checkbox'));
    fireEvent.click(within(await screen.findByTestId('pb-bulk-usedby')).getByRole('button'));
    const pop = await screen.findByRole('dialog', { name: 'Used by' });
    fireEvent.click(within(pop).getByRole('checkbox', { name: 'City boundary' }));
    await screen.findByText(PERIMETER_CONFIRM_TEXT);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText(PERIMETER_CONFIRM_TEXT)).toBeNull());
    expect(called).toBe(false);
  });

  it('bulk Used by: Set acts only on selected rows the filter shows, and says how many are hidden', async () => {
    // Review C3: rows ticked before the filter changed must not be tagged
    // behind the operator's back.
    const bodies: any[] = [];
    server.use(http.put('/api/bulk-polygons/apps', async ({ request }) => {
      const body: any = await request.json();
      bodies.push(body);
      return HttpResponse.json({ response: { updated: body.polygonIds.length, perimeterChanged: false } });
    }));
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');
    fireEvent.click(within(rowFor('AD Deep East')).getByRole('checkbox'));
    fireEvent.click(within(rowFor('MC8 Otahuhu')).getByRole('checkbox'));
    await screen.findByText('2 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Schedule zones' }));
    await waitFor(() => expect(rowNames()).toEqual(['MC8 Otahuhu']));
    expect(await screen.findByText('2 selected (1 hidden by filters)')).toBeInTheDocument();
    // Save coverage as Route still uses every tick.
    expect(screen.getByRole('button', { name: /Save coverage as Route \(2\)/ })).toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId('pb-bulk-usedby')).getByRole('button'));
    const pop = await screen.findByRole('dialog', { name: 'Used by' });
    // Tick state reflects the visible selection only (MC8 has Schedules).
    expect((within(pop).getByRole('checkbox', { name: 'Schedules' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(pop).getByRole('checkbox', { name: 'Zone rating' }));
    await waitFor(() => expect(bodies).toEqual([{ polygonIds: [2], add: ['ZONE_RATING'], remove: [] }]));
  });

  it('a list response that arrives after a newer one does not overwrite it', async () => {
    // Review C10: a bulk reload that is slow to answer must not put back a
    // zone membership that a later reload already shows as removed.
    let gets = 0;
    let releaseSlow: () => void = () => {};
    const slow = new Promise<void>((r) => { releaseSlow = r; });
    server.use(
      http.get('/api/bulk-polygons', async () => {
        gets += 1;
        const snapshot = data;
        if (gets === 2) await slow;
        return HttpResponse.json({ response: snapshot });
      }),
      http.put('/api/bulk-polygons/apps', () =>
        HttpResponse.json({ response: { updated: 1, perimeterChanged: false } })),
      http.delete('/api/bulk-polygons/zones/9', () => {
        data = data.map((p) => (p.polygonId === 2 ? { ...p, zoneMemberships: [] } : p));
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');
    fireEvent.click(within(rowFor('AD Deep East')).getByRole('checkbox'));
    fireEvent.click(within(await screen.findByTestId('pb-bulk-usedby')).getByRole('button'));
    const pop = await screen.findByRole('dialog', { name: 'Used by' });
    fireEvent.click(within(pop).getByRole('checkbox', { name: 'Routes' }));
    await waitFor(() => expect(gets).toBe(2)); // slow reload in flight

    fireEvent.click(within(rowFor('MC8 Otahuhu')).getByTitle('Remove from this zone'));
    await waitFor(() => expect(gets).toBe(3));
    await waitFor(() => expect(within(rowFor('MC8 Otahuhu')).queryByTitle('Remove from this zone')).toBeNull());

    releaseSlow();
    await waitFor(() => expect(screen.queryByText('Saving…')).toBeNull());
    expect(within(rowFor('MC8 Otahuhu')).queryByTitle('Remove from this zone')).toBeNull();
  });
});

describe('PolygonBuilder - card Used by toggles (spec 4.4.3, review C6)', () => {
  it('a toggle saves the new app list through PUT /api/bulk-polygons/{id}', async () => {
    let sent: any = null;
    server.use(http.put('/api/bulk-polygons/1', async ({ request }) => {
      sent = await request.json();
      return HttpResponse.json({ response: { ...data[0], apps: sent.apps } });
    }));
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');
    const card = await openCard('AD Deep East');
    fireEvent.click(within(card).getByRole('button', { name: 'Routes for AD Deep East' }));
    await waitFor(() => expect(sent).toEqual({ name: 'AD Deep East', layer: 'AD', apps: ['AUTODISPATCH', 'ROUTES'] }));
    await waitFor(() => expect(within(rowFor('AD Deep East')).getByTestId('pb-app-badges').textContent).toBe('ADRt'));
  });

  it('City boundary on shows the exact confirm wording; Continue saves', async () => {
    let sent: any = null;
    server.use(http.put('/api/bulk-polygons/4', async ({ request }) => {
      sent = await request.json();
      return HttpResponse.json({ response: { ...data[3], apps: sent.apps } });
    }));
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('Marcus test 2');
    const card = await openCard('Marcus test 2');
    fireEvent.click(within(card).getByRole('button', { name: 'City boundary for Marcus test 2' }));
    await screen.findByText(PERIMETER_CONFIRM_TEXT);
    expect(sent).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(sent?.apps).toEqual(['PERIMETER']));
  });

  it('unticking Schedules while the polygon still has zone memberships shows the Q4 note', async () => {
    server.use(http.put('/api/bulk-polygons/2', async ({ request }) => {
      const body: any = await request.json();
      return HttpResponse.json({ response: { ...data[1], apps: body.apps } });
    }));
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('MC8 Otahuhu');
    const card = await openCard('MC8 Otahuhu');
    expect(screen.queryByTestId('pb-used-by-note')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Schedules for MC8 Otahuhu' }));
    const note = await screen.findByTestId('pb-used-by-note');
    expect(note.textContent).toContain('availability still uses the binding');
    expect(note.textContent).toContain('1 zone membership');
  });
});

describe('PolygonBuilder - polygon card (review C6, Steve mock)', () => {
  /** Click handlers registered on the coverage polygon overlays, in list order. */
  const polygonClicks = () => {
    const g = (window as any).google;
    const instances: any[] = g.maps.Polygon.mock.instances;
    return (g.__listeners.click ?? []).filter((l: any) => instances.includes(l.owner));
  };

  it('list rows carry badges but no Used by toggles', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');
    expect(screen.queryByTestId('pb-polygon-card')).toBeNull();
    for (const row of screen.getAllByTestId('pb-polygon-row')) {
      expect(within(row).queryByTestId('pb-used-by')).toBeNull();
      expect(within(row).getByTestId('pb-app-badges')).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Routes for AD Deep East' })).toBeNull();
  });

  it('clicking a row name opens one card with name, layer, zone, chips, hint and Updated; the row is highlighted', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('MC8 Otahuhu');
    let card = await openCard('MC8 Otahuhu');
    expect(within(card).getByTestId('pb-polygon-card-name').textContent).toBe('MC8 Otahuhu');
    expect(within(card).getByTestId('pb-polygon-card-layer').textContent).toBe('LayerRoutes');
    expect(within(card).getByTestId('pb-polygon-card-zone').textContent).toBe('ZoneStd Auckland - Zone 3');
    expect(within(card).getByRole('button', { name: 'Schedules for MC8 Otahuhu' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(card).getByRole('button', { name: 'Auto Dispatch for MC8 Otahuhu' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(card).getAllByTestId('pb-used-by-chip')).toHaveLength(5);
    expect(within(card).getByText('Each app only lists the polygons ticked for it.')).toBeInTheDocument();
    expect(within(card).getByTestId('pb-polygon-card-updated').textContent).toMatch(/^Created /);
    expect(rowFor('MC8 Otahuhu').getAttribute('data-card-open')).toBe('true');

    // A second polygon replaces the first card: one card at a time.
    card = await openCard('Marcus test 2');
    expect(screen.getAllByTestId('pb-polygon-card')).toHaveLength(1);
    expect(within(card).getByTestId('pb-polygon-card-layer').textContent).toBe('LayerNo layer');
    expect(within(card).getByTestId('pb-polygon-card-zone').textContent).toBe('Zonenot in a zone');
    expect(rowFor('MC8 Otahuhu').getAttribute('data-card-open')).toBe('false');
  });

  it('City boundary card shows a dashed swatch; turning it off asks first and Cancel saves nothing', async () => {
    let calls = 0;
    server.use(http.put('/api/bulk-polygons/3', () => { calls++; return HttpResponse.json({ response: data[2] }); }));
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('Auckland metro boundary');
    const card = await openCard('Auckland metro boundary');
    expect(within(card).getByTestId('pb-polygon-card-swatch').getAttribute('data-perimeter')).toBe('true');
    fireEvent.click(within(card).getByRole('button', { name: 'City boundary for Auckland metro boundary' }));
    await screen.findByText(PERIMETER_CONFIRM_TEXT);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText(PERIMETER_CONFIRM_TEXT)).toBeNull());
    expect(calls).toBe(0);
  });

  it('clicking a shape on the map opens its card; x and Escape close it', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');
    await waitFor(() => expect(polygonClicks().length).toBe(4));
    act(() => polygonClicks()[2].cb({}));
    const card = await screen.findByTestId('pb-polygon-card');
    expect(within(card).getByTestId('pb-polygon-card-name').textContent).toBe('Auckland metro boundary');
    fireEvent.click(within(card).getByRole('button', { name: 'Close polygon card' }));
    await waitFor(() => expect(screen.queryByTestId('pb-polygon-card')).toBeNull());

    await openCard('AD Deep East');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('pb-polygon-card')).toBeNull());
  });

  it('the card closes when its polygon is filtered out, and when it is removed', async () => {
    server.use(http.delete('/api/bulk-polygons/4', () => HttpResponse.json({ response: true })));
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');
    await openCard('AD Deep East');
    fireEvent.change(screen.getByLabelText('Search polygons'), { target: { value: 'otahuhu' } });
    await waitFor(() => expect(screen.queryByTestId('pb-polygon-card')).toBeNull());
    // Clearing the filter does not bring the closed card back.
    fireEvent.click(within(screen.getByTestId('pb-filter-bar')).getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(rowNames()).toHaveLength(4));
    expect(screen.queryByTestId('pb-polygon-card')).toBeNull();

    await openCard('Marcus test 2');
    fireEvent.click(within(rowFor('Marcus test 2')).getByRole('button', { name: 'Remove' }));
    await screen.findByText('Remove coverage polygon');
    fireEvent.click(lastButton('Remove'));
    await waitFor(() => expect(screen.queryByText('Marcus test 2')).toBeNull());
    expect(screen.queryByTestId('pb-polygon-card')).toBeNull();
  });

  it('Edit shape in the card starts edit mode; the card does not open while editing', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');
    const card = await openCard('AD Deep East');
    fireEvent.click(within(card).getByRole('button', { name: 'Edit shape' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Done editing/ }).length).toBeGreaterThan(0));
    expect(screen.queryByTestId('pb-polygon-card')).toBeNull();
    fireEvent.click(within(rowFor('MC8 Otahuhu')).getByRole('button', { name: 'MC8 Otahuhu' }));
    act(() => polygonClicks()[0]?.cb({}));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('pb-polygon-card')).toBeNull();
  });
});

describe('PolygonBuilder - polygon card, Kevin addendum 1', () => {
  const overlayClicks = () => {
    const g = (window as any).google;
    const instances: any[] = g.maps.Polygon.mock.instances;
    return (g.__listeners.click ?? []).filter((l: any) => instances.includes(l.owner));
  };
  const checkboxFor = (name: string) => within(rowFor(name)).getByRole('checkbox') as HTMLInputElement;

  it('a map click on a shape opens its card and leaves its selection alone (review C1)', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');
    await waitFor(() => expect(overlayClicks().length).toBe(4));
    // Not ticked: stays unticked.
    act(() => overlayClicks()[0].cb({}));
    await screen.findByTestId('pb-polygon-card');
    expect(checkboxFor('AD Deep East').checked).toBe(false);
    // Ticked: stays ticked.
    fireEvent.click(checkboxFor('Marcus test 2'));
    expect(checkboxFor('Marcus test 2').checked).toBe(true);
    act(() => overlayClicks()[3].cb({}));
    await waitFor(() => expect(screen.getByTestId('pb-polygon-card-name').textContent).toBe('Marcus test 2'));
    expect(checkboxFor('Marcus test 2').checked).toBe(true);
  });

  it('the City boundary swatch on the card is dashed in the polygon colour (review C3)', async () => {
    // Its own colour (review N5): give it one so the check is exact.
    (data[2] as any).colorHex = '#123abc';
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('Auckland metro boundary');
    const card = await openCard('Auckland metro boundary');
    const swatch = within(card).getByTestId('pb-polygon-card-swatch');
    expect(swatch.className).toContain('border-dashed');
    expect(swatch.style.borderColor).toBe('rgb(18, 58, 188)');
  });

  it('the card is a named region and takes focus when it opens (review C4)', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');
    const card = await openCard('AD Deep East');
    expect(screen.getByRole('region', { name: 'Polygon AD Deep East' })).toBe(card);
    await waitFor(() => expect(document.activeElement).toBe(card));
    // Escape still closes it with focus on the card.
    fireEvent.keyDown(card, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('pb-polygon-card')).toBeNull());
  });

  it('closing the card with x or Escape gives focus back to its row name (review N4)', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');
    const rowName = () => within(rowFor('AD Deep East')).getByRole('button', { name: 'AD Deep East' });
    let card = await openCard('AD Deep East');
    await waitFor(() => expect(document.activeElement).toBe(card));
    fireEvent.click(within(card).getByRole('button', { name: 'Close polygon card' }));
    await waitFor(() => expect(screen.queryByTestId('pb-polygon-card')).toBeNull());
    expect(document.activeElement).toBe(rowName());

    card = await openCard('AD Deep East');
    await waitFor(() => expect(document.activeElement).toBe(card));
    fireEvent.keyDown(card, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('pb-polygon-card')).toBeNull());
    expect(document.activeElement).toBe(rowName());
  });

  it('the card does not take focus from the search box', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');
    await waitFor(() => expect(overlayClicks().length).toBe(4));
    const search = screen.getByLabelText('Search polygons');
    search.focus();
    act(() => overlayClicks()[0].cb({}));
    await screen.findByTestId('pb-polygon-card');
    await new Promise((r) => setTimeout(r, 20));
    expect(document.activeElement).toBe(search);
  });

  it('the card Zoom button fits the map to that polygon (review C7)', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');
    const card = await openCard('AD Deep East');
    const g = (window as any).google;
    const map = g.maps.Map.mock.instances[0];
    map.fitBounds.mockClear();
    const boundsBefore = g.maps.LatLngBounds.mock.instances.length;
    fireEvent.click(within(card).getByRole('button', { name: 'Zoom' }));
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
    const bounds = g.maps.LatLngBounds.mock.instances[boundsBefore];
    expect(map.fitBounds).toHaveBeenCalledWith(bounds);
    expect(bounds.extend).toHaveBeenCalledWith({ lat: -36.85, lng: 174.76 });
  });
});
