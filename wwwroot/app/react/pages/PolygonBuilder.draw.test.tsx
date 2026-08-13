import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, act } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { buildGoogleMapsStub, installBaseHandlers } from './PolygonBuilder.testHelpers';

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

beforeEach(() => {
  (window as any).__APP_USER__ = {
    ...(window as any).__APP_USER__,
    googleMapsKey: 'fake-key',
    isUsTenant: false,
  };
  (window as any).google = buildGoogleMapsStub();
  vi.clearAllMocks();
  installBaseHandlers();
});

afterEach(() => {
  delete (window as any).google;
});

describe('PolygonBuilder - drawing mode entry / exit', () => {
  it('New Drawing menu -> Freehand lasso enters lasso mode', async () => {
    renderWithProviders(<PolygonBuilder />);
    // Open the drawing tools dropdown.
    const menuBtn = await screen.findByRole('button', { name: /New Drawing/ });
    fireEvent.click(menuBtn);
    fireEvent.click(await screen.findByRole('button', { name: /Freehand lasso/ }));
    // Toolbar swaps to lasso instructions.
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Hold mouse and drag around an area/),
    );
    // Cancel returns to view.
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /View Zones/ })).toBeInTheDocument(),
    );
  });

  it('New Drawing menu -> Rectangle enters rectangling mode', async () => {
    renderWithProviders(<PolygonBuilder />);
    fireEvent.click(await screen.findByRole('button', { name: /New Drawing/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Rectangle R/ }));
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Click and drag to draw a rectangle/),
    );
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /View Zones/ })).toBeInTheDocument(),
    );
  });

  it('New Drawing menu -> Circle enters circling mode', async () => {
    renderWithProviders(<PolygonBuilder />);
    fireEvent.click(await screen.findByRole('button', { name: /New Drawing/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Circle C/ }));
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Click the centre and drag out/),
    );
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
  });

  it('keyboard shortcut L in view mode enters lasso mode', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: /View Zones/ });
    fireEvent.keyDown(window, { key: 'l' });
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Hold mouse and drag around an area/),
    );
    // Escape exits.
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /View Zones/ })).toBeInTheDocument(),
    );
  });

  it('keyboard shortcut R in view mode enters rectangling mode', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: /View Zones/ });
    fireEvent.keyDown(window, { key: 'R' });
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Click and drag to draw a rectangle/),
    );
    fireEvent.keyDown(window, { key: 'Escape' });
  });

  it('keyboard shortcut C in view mode enters circling mode', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: /View Zones/ });
    fireEvent.keyDown(window, { key: 'c' });
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Click the centre and drag out/),
    );
    fireEvent.keyDown(window, { key: 'Escape' });
  });

  it('keyboard shortcut / focuses the search input', async () => {
    renderWithProviders(<PolygonBuilder />);
    const input = await screen.findByPlaceholderText(/Type a postcode prefix/);
    // Focus something else first.
    (document.body as any).focus?.();
    fireEvent.keyDown(window, { key: '/' });
    expect(document.activeElement).toBe(input);
  });

  it('keyboard events fired inside INPUT do not trigger tool shortcuts', async () => {
    renderWithProviders(<PolygonBuilder />);
    const input = await screen.findByPlaceholderText(/Type a postcode prefix/);
    input.focus();
    fireEvent.keyDown(input, { key: 'l', target: input });
    // Should NOT flip to lassoing mode.
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.textContent).not.toMatch(/Hold mouse and drag around an area/);
  });

  it('map background right-click opens the mapBackground context menu with drawing options', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: /View Zones/ });
    // Fire the rightclick event through the Google Maps event dispatcher stub.
    const g = (window as any).google;
    act(() => {
      g.__fireOnMap('rightclick', {
        domEvent: { clientX: 100, clientY: 100 } as MouseEvent,
      });
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Freehand lasso \(L\)/ })).toBeInTheDocument(),
    );
    // Escape closes it.
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Freehand lasso \(L\)/ })).not.toBeInTheDocument(),
    );
  });

  it('right-click menu: Freehand lasso item enters lasso mode', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: /View Zones/ });
    const g = (window as any).google;
    act(() => {
      g.__fireOnMap('rightclick', { domEvent: { clientX: 100, clientY: 100 } as MouseEvent });
    });
    fireEvent.click(await screen.findByRole('button', { name: /Freehand lasso \(L\)/ }));
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Hold mouse and drag around an area/),
    );
  });

  it('right-click menu: Draw rectangle item enters rectangling mode', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: /View Zones/ });
    const g = (window as any).google;
    act(() => {
      g.__fireOnMap('rightclick', { domEvent: { clientX: 100, clientY: 100 } as MouseEvent });
    });
    fireEvent.click(await screen.findByRole('button', { name: /Draw rectangle/ }));
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Click and drag to draw a rectangle/),
    );
  });

  it('right-click menu: Draw circle item enters circling mode', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: /View Zones/ });
    const g = (window as any).google;
    act(() => {
      g.__fireOnMap('rightclick', { domEvent: { clientX: 100, clientY: 100 } as MouseEvent });
    });
    fireEvent.click(await screen.findByRole('button', { name: /Draw circle/ }));
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Click the centre and drag out/),
    );
  });

  it('rightclick without domEvent is swallowed (no context menu)', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: /View Zones/ });
    const g = (window as any).google;
    act(() => {
      g.__fireOnMap('rightclick', {}); // No domEvent -> early return branch.
    });
    // No context menu items appear.
    expect(screen.queryByRole('button', { name: /Freehand lasso \(L\)/ })).not.toBeInTheDocument();
  });

  it('New Drawing menu closes on click-outside', async () => {
    renderWithProviders(<PolygonBuilder />);
    fireEvent.click(await screen.findByRole('button', { name: /New Drawing/ }));
    expect(await screen.findByRole('button', { name: /Freehand lasso/ })).toBeInTheDocument();
    // Click outside.
    act(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Freehand lasso/ })).not.toBeInTheDocument(),
    );
  });

  it('New Drawing menu closes on Escape', async () => {
    renderWithProviders(<PolygonBuilder />);
    fireEvent.click(await screen.findByRole('button', { name: /New Drawing/ }));
    expect(await screen.findByRole('button', { name: /Freehand lasso/ })).toBeInTheDocument();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Freehand lasso/ })).not.toBeInTheDocument(),
    );
  });
});
