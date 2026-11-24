import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { buildGoogleMapsStub, installBaseHandlers } from './PolygonBuilder.testHelpers';
import { PERIMETER_CONFIRM_TEXT } from '../lib/polygonFilters';

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

// Review C4: a polygon that already IS a City boundary (PERIMETER) moves
// distance-rated prices when its shape changes or it is removed, exactly as
// adding or removing the tag does. Every shape save and the remove must ask
// first, and Cancel must not reach the server. Other polygons keep today's
// behaviour (no extra dialog).

beforeEach(() => {
  (window as any).__APP_USER__ = {
    ...(window as any).__APP_USER__,
    googleMapsKey: 'fake-key',
    isUsTenant: false,
  };
  (window as any).google = buildGoogleMapsStub();
  vi.clearAllMocks();
  installBaseHandlers();
  (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
  (globalThis as any).cancelAnimationFrame = (h: any) => clearTimeout(h);
});

afterEach(() => {
  delete (window as any).google;
});

function makeLatLngEvent(lat: number, lng: number) {
  return { latLng: { lat: () => lat, lng: () => lng } };
}

const ring = [
  { ringIndex: 0, orderIndex: 0, lat: -36.86, lng: 174.75 },
  { ringIndex: 0, orderIndex: 1, lat: -36.86, lng: 174.78 },
  { ringIndex: 0, orderIndex: 2, lat: -36.83, lng: 174.78 },
  { ringIndex: 0, orderIndex: 3, lat: -36.83, lng: 174.75 },
];

const makePoly = (apps: string[]) => ({
  polygonId: 7, name: 'Akl boundary', layer: null, apps,
  centroidLatitude: -36.85, centroidLongitude: 174.76,
  sourceType: 0, sourceCode: null, active: true, points: ring,
  attachedRouteCount: 0, attachedRoutes: [], zoneMemberships: [],
  partiallyIncludedZips: null,
  createdBy: 'kevin', createdUtc: '2026-11-20T00:00:00', updatedBy: null, lastModifiedUtc: null,
});

let shapePuts = 0;
let deletes = 0;

function serve(apps: string[]) {
  const poly = makePoly(apps);
  shapePuts = 0;
  deletes = 0;
  server.use(
    http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [poly] })),
    http.put('/api/bulk-polygons/:id/shape', async ({ request }) => {
      shapePuts++;
      const body: any = await request.json();
      return HttpResponse.json({
        response: { ...poly, points: body.points, lastModifiedUtc: `2026-11-24T00:00:0${shapePuts}` },
      });
    }),
    http.delete('/api/bulk-polygons/:id', () => { deletes++; return HttpResponse.json({ response: 'ok' }); }),
  );
}

async function enterEdit() {
  renderWithProviders(<PolygonBuilder />);
  fireEvent.click(await screen.findByRole('button', { name: /Edit shape/ }));
  await waitFor(() => expect(document.body.textContent).toMatch(/Drag squares to reshape/));
}

/** Drop the first vertex handle: the vertex-edit save path (commitShape). */
async function dragFirstVertex() {
  const g = (window as any).google;
  await waitFor(() => expect((g.__listeners.dragend ?? []).length).toBeGreaterThan(0));
  const handler = g.__listeners.dragend[0].cb;
  await act(async () => { void handler({}); });
}

async function lassoCut(op: RegExp = /^Cut$/) {
  fireEvent.click(screen.getByRole('button', { name: op }));
  const g = (window as any).google;
  act(() => { g.__fireOnMap('mousedown', makeLatLngEvent(-36.86, 174.76)); });
  for (const [lat, lng] of [[-36.86, 174.77], [-36.85, 174.77], [-36.85, 174.76]]) {
    act(() => { g.__fireOnMap('mousemove', makeLatLngEvent(lat, lng)); });
    await new Promise((r) => setTimeout(r, 5));
  }
  act(() => { g.__fireOnMap('mouseup', makeLatLngEvent(-36.86, 174.76)); });
}

const reshapeTitle = () => screen.queryByText('Change a city boundary?');

describe('PolygonBuilder - City boundary confirm on reshape and remove (review C4)', () => {
  it('vertex edit on a City boundary asks; Cancel saves nothing, Continue saves', async () => {
    serve(['PERIMETER']);
    await enterEdit();
    await dragFirstVertex();
    await screen.findByText('Change a city boundary?');
    expect(screen.getByText(PERIMETER_CONFIRM_TEXT)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(reshapeTitle()).toBeNull());
    expect(shapePuts).toBe(0);
    // Still in edit mode on the saved shape.
    expect(document.body.textContent).toMatch(/Drag squares to reshape/);

    await dragFirstVertex();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(shapePuts).toBe(1));
  });

  it('vertex edit on a polygon that is not a City boundary saves without asking', async () => {
    serve(['SCHEDULES']);
    await enterEdit();
    await dragFirstVertex();
    await waitFor(() => expect(shapePuts).toBe(1));
    expect(reshapeTitle()).toBeNull();
  });

  it('a boolean op (Cut) on a City boundary asks; Cancel saves nothing and adds no undo step', async () => {
    serve(['PERIMETER']);
    await enterEdit();
    await lassoCut();
    await screen.findByText('Change a city boundary?');
    // The lasso toolbar has its own Cancel; the dialog's is rendered last.
    fireEvent.click(lastButton('Cancel'));
    await waitFor(() => expect(reshapeTitle()).toBeNull());
    expect(shapePuts).toBe(0);
    await waitFor(() => expect(screen.getByRole('button', { name: /^Undo$/ })).toBeDisabled());
  });

  it('a boolean op (Cut) on a polygon that is not a City boundary saves without asking', async () => {
    serve([]);
    await enterEdit();
    await lassoCut();
    await waitFor(() => expect(shapePuts).toBe(1));
    expect(reshapeTitle()).toBeNull();
  });

  it('Undo on a City boundary asks; Cancel keeps the shape and the undo step', async () => {
    serve(['PERIMETER']);
    await enterEdit();
    await dragFirstVertex();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(shapePuts).toBe(1));
    await waitFor(() => expect(reshapeTitle()).toBeNull());

    await waitFor(() => expect(screen.getByRole('button', { name: /^Undo$/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /^Undo$/ }));
    await screen.findByText('Change a city boundary?');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(reshapeTitle()).toBeNull());
    expect(shapePuts).toBe(1);
    expect(screen.getByRole('button', { name: /^Undo$/ })).toBeEnabled();
  });

  it('Undo on a polygon that is not a City boundary saves without asking', async () => {
    serve(['ROUTES']);
    await enterEdit();
    await dragFirstVertex();
    await waitFor(() => expect(shapePuts).toBe(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Undo$/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /^Undo$/ }));
    await waitFor(() => expect(shapePuts).toBe(2));
    expect(reshapeTitle()).toBeNull();
  });

  it('removing a City boundary shows one dialog with the price warning; Cancel removes nothing', async () => {
    serve(['PERIMETER']);
    renderWithProviders(<PolygonBuilder />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await screen.findByText('Remove a city boundary?');
    expect(screen.getByText(`Remove "Akl boundary"? ${PERIMETER_CONFIRM_TEXT}`)).toBeInTheDocument();
    expect(screen.queryByText('Remove coverage polygon')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Remove a city boundary?')).toBeNull());
    expect(deletes).toBe(0);
  });

  it('removing any other polygon keeps the plain remove dialog', async () => {
    serve(['SCHEDULES']);
    renderWithProviders(<PolygonBuilder />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await screen.findByText('Remove coverage polygon');
    expect(screen.getByText('Remove "Akl boundary"?')).toBeInTheDocument();
    expect(screen.queryByText(PERIMETER_CONFIRM_TEXT, { exact: false })).toBeNull();
    fireEvent.click(lastButton('Remove'));
    await waitFor(() => expect(deletes).toBe(1));
  });
});

/** Drop the newest vertex handle (the handles of the latest edit render). */
async function dragNewestVertex() {
  const g = (window as any).google;
  await waitFor(() => expect((g.__listeners.dragend ?? []).length).toBeGreaterThan(0));
  const all = g.__listeners.dragend;
  const handler = all[all.length - 1].cb;
  await act(async () => { void handler({}); });
}

/** Counts how many times the reshape confirm has been shown. */
async function continueIfAsked(): Promise<boolean> {
  await new Promise((r) => setTimeout(r, 30));
  if (!reshapeTitle()) return false;
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(reshapeTitle()).toBeNull());
  return true;
}

describe('PolygonBuilder - City boundary vertex edits ask once per edit session (Kevin addendum 1)', () => {
  it('two vertex saves in one edit session ask once', async () => {
    serve(['PERIMETER']);
    await enterEdit();
    await dragNewestVertex();
    expect(await continueIfAsked()).toBe(true);
    await waitFor(() => expect(shapePuts).toBe(1));
    await dragNewestVertex();
    expect(await continueIfAsked()).toBe(false);
    await waitFor(() => expect(shapePuts).toBe(2));
  });

  it('leaving edit mode and coming back asks again', async () => {
    serve(['PERIMETER']);
    await enterEdit();
    await dragNewestVertex();
    expect(await continueIfAsked()).toBe(true);
    await waitFor(() => expect(shapePuts).toBe(1));
    fireEvent.click(screen.getAllByRole('button', { name: /Done editing/ })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /Edit shape/ }));
    await waitFor(() => expect(document.body.textContent).toMatch(/Drag squares to reshape/));
    await dragNewestVertex();
    expect(await continueIfAsked()).toBe(true);
    await waitFor(() => expect(shapePuts).toBe(2));
  });

  it('Cancel on the first ask means the next vertex save asks again', async () => {
    serve(['PERIMETER']);
    await enterEdit();
    await dragNewestVertex();
    await screen.findByText('Change a city boundary?');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(reshapeTitle()).toBeNull());
    expect(shapePuts).toBe(0);
    await dragNewestVertex();
    expect(await continueIfAsked()).toBe(true);
    await waitFor(() => expect(shapePuts).toBe(1));
  });

  it('a boolean op after an OK-ed vertex save still asks', async () => {
    serve(['PERIMETER']);
    await enterEdit();
    await dragNewestVertex();
    expect(await continueIfAsked()).toBe(true);
    await waitFor(() => expect(shapePuts).toBe(1));
    await lassoCut();
    await screen.findByText('Change a city boundary?');
    fireEvent.click(lastButton('Cancel'));
    await waitFor(() => expect(reshapeTitle()).toBeNull());
    expect(shapePuts).toBe(1);
  });

  it('Clip on a City boundary asks; Cancel saves nothing', async () => {
    serve(['PERIMETER']);
    await enterEdit();
    await lassoCut(/^Clip$/);
    await screen.findByText('Change a city boundary?');
    fireEvent.click(lastButton('Cancel'));
    await waitFor(() => expect(reshapeTitle()).toBeNull());
    expect(shapePuts).toBe(0);
  });
});

describe('PolygonBuilder - a failed shape save never looks saved (Kevin addendum 1)', () => {
  /** Serve a plain polygon whose shape PUT fails with 500 after `okFirst` successes. */
  function serveFailing(okFirst = 0) {
    serve(['SCHEDULES']);
    server.use(http.put('/api/bulk-polygons/:id/shape', async ({ request }) => {
      shapePuts++;
      const body: any = await request.json();
      if (shapePuts > okFirst) return HttpResponse.json({ message: 'boom' }, { status: 500 });
      return HttpResponse.json({
        response: { ...makePoly(['SCHEDULES']), points: body.points, lastModifiedUtc: '2026-11-24T00:00:01' },
      });
    }));
  }
  const editOverlayPaths = () => {
    const g = (window as any).google;
    const instances: any[] = g.maps.Polygon.mock.instances;
    const edit = instances[instances.length - 1];
    const calls = edit.setPaths.mock.calls;
    return calls.length > 0 ? calls[calls.length - 1][0] : g.maps.Polygon.mock.calls[instances.length - 1][0].paths;
  };

  it('vertex save 500: the saved shape goes back on screen, no Shape saved toast, no undo step', async () => {
    serveFailing();
    await enterEdit();
    const g = (window as any).google;
    await waitFor(() => expect((g.__listeners.drag ?? []).length).toBeGreaterThan(0));
    // Move vertex 0 far away, then drop it.
    act(() => { g.__listeners.drag[0].cb(makeLatLngEvent(-36.5, 174.5)); });
    await act(async () => { void g.__listeners.dragend[0].cb({}); });
    await waitFor(() => expect(shapePuts).toBe(1));
    await waitFor(() => expect(editOverlayPaths()[0][0]).toEqual({ lat: -36.86, lng: 174.75 }));
    expect(document.body.textContent).not.toMatch(/Shape saved/);
    expect(screen.getByRole('button', { name: /^Undo$/ })).toBeDisabled();
  });

  it('boolean op 500: the saved shape stays on screen and no undo step is left', async () => {
    serveFailing();
    await enterEdit();
    await lassoCut();
    await waitFor(() => expect(shapePuts).toBe(1));
    await waitFor(() => expect(document.body.textContent).toMatch(/Save failed/));
    expect(document.body.textContent).not.toMatch(/Cut from shape/);
    await waitFor(() => expect(document.body.textContent).toMatch(/Drag squares to reshape/));
    expect(editOverlayPaths()[0][0]).toEqual({ lat: -36.86, lng: 174.75 });
    expect(screen.getByRole('button', { name: /^Undo$/ })).toBeDisabled();
  });

  it('undo 500: the current shape stays on screen and the undo step is kept', async () => {
    serveFailing(1);
    await enterEdit();
    await lassoCut();
    await waitFor(() => expect(shapePuts).toBe(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Undo$/ })).toBeEnabled());
    const before = editOverlayPaths();
    fireEvent.click(screen.getByRole('button', { name: /^Undo$/ }));
    await waitFor(() => expect(shapePuts).toBe(2));
    await waitFor(() => expect(document.body.textContent).toMatch(/Undo failed/));
    expect(document.body.textContent).not.toMatch(/Reverted/);
    expect(editOverlayPaths()).toEqual(before);
    expect(screen.getByRole('button', { name: /^Undo$/ })).toBeEnabled();
  });
});

describe('PolygonBuilder - later saves in one edit session use the shape the server holds (Kevin addendum 2)', () => {
  let lastPutBody: any = null;
  /** Serve a polygon whose shape PUT returns 500 on the listed call numbers. */
  function serveSeq(apps: string[], failOn: number[]) {
    serve(apps);
    lastPutBody = null;
    server.use(http.put('/api/bulk-polygons/:id/shape', async ({ request }) => {
      shapePuts++;
      const body: any = await request.json();
      if (failOn.includes(shapePuts)) return HttpResponse.json({ message: 'boom' }, { status: 500 });
      lastPutBody = body;
      return HttpResponse.json({
        response: { ...makePoly(apps), points: body.points, lastModifiedUtc: `2026-11-24T00:00:0${shapePuts}` },
      });
    }));
  }
  /** Move the newest handle (as the operator would see it) and drop it. */
  async function moveNewestVertex(lat: number, lng: number) {
    const g = (window as any).google;
    await waitFor(() => expect((g.__listeners.dragend ?? []).length).toBeGreaterThan(0));
    const drags = g.__listeners.drag;
    const ends = g.__listeners.dragend;
    act(() => { drags[drags.length - 1].cb(makeLatLngEvent(lat, lng)); });
    await act(async () => { void ends[ends.length - 1].cb({}); });
  }
  const editOverlayPaths = () => {
    const g = (window as any).google;
    const instances: any[] = g.maps.Polygon.mock.instances;
    const edit = instances[instances.length - 1];
    const calls = edit.setPaths.mock.calls;
    return calls.length > 0 ? calls[calls.length - 1][0] : g.maps.Polygon.mock.calls[instances.length - 1][0].paths;
  };

  it('good save then 500: the screen shows the first save\'s shape', async () => {
    serveSeq(['PERIMETER'], [2]);
    await enterEdit();
    await moveNewestVertex(-36.84, 174.74);
    expect(await continueIfAsked()).toBe(true);
    await waitFor(() => expect(shapePuts).toBe(1));
    await moveNewestVertex(-36.5, 174.5);
    await waitFor(() => expect(shapePuts).toBe(2));
    await waitFor(() => expect(document.body.textContent).toMatch(/boom/));
    await waitFor(() => expect(editOverlayPaths()[0][3]).toEqual({ lat: -36.84, lng: 174.74 }));
  });

  it('two good saves then Undo: back to the shape after the first save', async () => {
    serveSeq(['PERIMETER'], []);
    await enterEdit();
    await moveNewestVertex(-36.84, 174.74);
    expect(await continueIfAsked()).toBe(true);
    await waitFor(() => expect(shapePuts).toBe(1));
    await moveNewestVertex(-36.82, 174.73);
    await waitFor(() => expect(shapePuts).toBe(2));
    fireEvent.click(await screen.findByRole('button', { name: /^Undo/ }));
    expect(await continueIfAsked()).toBe(true);
    await waitFor(() => expect(shapePuts).toBe(3));
    const v3 = lastPutBody.points.find((p: any) => p.ringIndex === 0 && p.orderIndex === 3);
    expect({ lat: v3.lat, lng: v3.lng }).toEqual({ lat: -36.84, lng: 174.74 });
  });

  it('an OK-ed City boundary save that fails does not count: the retry asks again', async () => {
    serveSeq(['PERIMETER'], [1]);
    await enterEdit();
    await moveNewestVertex(-36.84, 174.74);
    expect(await continueIfAsked()).toBe(true);
    await waitFor(() => expect(shapePuts).toBe(1));
    await new Promise((r) => setTimeout(r, 30));
    await moveNewestVertex(-36.84, 174.74);
    expect(await continueIfAsked()).toBe(true);
    await waitFor(() => expect(shapePuts).toBe(2));
  });
});
