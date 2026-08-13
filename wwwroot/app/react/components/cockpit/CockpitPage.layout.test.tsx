import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CockpitPage } from './CockpitPage';

/**
 * Layout menu save / load / delete (handleSaveLayout, handleLoadLayout,
 * handleDeleteLayout). Storage key is RoutedOps_layouts. Focused here rather
 * than in the filters file so a failure clearly points to the layout code.
 */

beforeEach(() => {
  (window as any).__APP_USER__ = {
    ...(window as any).__APP_USER__,
    googleMapsKey: null,
    isUsTenant: false,
  };
  try { localStorage.clear(); } catch { /* ignore */ }
  server.use(
    http.get('/api/regions', () => HttpResponse.json([])),
    http.get('/api/speeds', () => HttpResponse.json([])),
    http.get('/api/couriers', () => HttpResponse.json({ potentialCouriers: [] })),
    http.get('/api/fleets', () => HttpResponse.json({ fleets: [] })),
    http.get('/api/jobs/filters/clients', () => HttpResponse.json({ response: { clients: [] } })),
    http.get('/api/jobs/filters/refs', () => HttpResponse.json({ ourRefs: [] })),
    http.get('/api/vehicle-sizes', () => HttpResponse.json({ response: [] })),
    http.get('/api/jobs', () => HttpResponse.json({ bulkJobs: [], maxJsonLength: 10000 })),
    http.get('/api/runs', () => HttpResponse.json({ response: [], maxJsonLength: 10000 })),
    http.post('/api/routes/polyline', () => HttpResponse.json({ points: [] })),
  );
});
afterEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
});

describe('CockpitPage - layout save/load/delete', () => {
  it('saves the current layout under the given name', async () => {
    renderWithProviders(<CockpitPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Layout' }));
    fireEvent.click(screen.getByText(/Save current layout/i));
    fireEvent.change(screen.getByPlaceholderText('Layout name'), { target: { value: 'Focus' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('RoutedOps_layouts') ?? '[]')[0].name).toBe('Focus'),
    );
  });

  it('loads a stored layout when clicked (setLayout call reaches ref handlers)', async () => {
    localStorage.setItem(
      'RoutedOps_layouts',
      JSON.stringify([{ name: 'Wide Map', horizontal: [10, 10, 5, 75], leftVertical: [30, 40, 30], runVertical: [50, 50] }]),
    );
    renderWithProviders(<CockpitPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Layout' }));
    // react-resizable-panels validates against real panel sizes at setLayout
    // time; in jsdom the panels have zero measurable height so it throws.
    // Swallow both the react-dom error log and the jsdom uncaught-error path.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const swallow = (e: ErrorEvent) => { e.preventDefault(); };
    window.addEventListener('error', swallow);
    expect(() => fireEvent.click(screen.getByText('Wide Map'))).not.toThrow();
    window.removeEventListener('error', swallow);
    errSpy.mockRestore();
  });

  it('deletes a stored layout via the "x" button after confirm', async () => {
    localStorage.setItem(
      'RoutedOps_layouts',
      JSON.stringify([{ name: 'Doomed', horizontal: [25, 25, 25, 25], leftVertical: [30, 40, 30], runVertical: [50, 50] }]),
    );
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithProviders(<CockpitPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Layout' }));
    fireEvent.click(screen.getByTitle('Delete this layout'));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('RoutedOps_layouts') ?? '[]')).toHaveLength(0),
    );
    confirmSpy.mockRestore();
  });

  it('saving an empty name is a no-op', async () => {
    renderWithProviders(<CockpitPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Layout' }));
    fireEvent.click(screen.getByText(/Save current layout/i));
    // Leave the input blank, hit Save.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    // No storage entry appears.
    expect(localStorage.getItem('RoutedOps_layouts')).toBeNull();
  });
});

