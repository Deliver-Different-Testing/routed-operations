import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import FeatureRoute from './FeatureRoute';

// The route guard: a switched-off page shows "not available" instead of
// mounting and firing requests the server will refuse.
describe('FeatureRoute', () => {
  beforeEach(() => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, bypassesFeatureSwitches: false };
  });

  const page = (keys: readonly string[]) =>
    renderWithProviders(<FeatureRoute requiredKeys={keys}><p>the page</p></FeatureRoute>);

  it('renders the page when every switch on its chain is on', async () => {
    page(['ro-route-viewer', 'ro-mobile']);
    expect(await screen.findByText('the page')).toBeInTheDocument();
  });

  it('refuses when any switch on the chain is off', async () => {
    server.use(http.get('/api/me/visible-features', () => HttpResponse.json(['ro-mobile'])));
    page(['ro-route-viewer', 'ro-mobile']);
    expect(await screen.findByText("This page isn't available")).toBeInTheDocument();
    expect(screen.queryByText('the page')).not.toBeInTheDocument();
  });

  it('waits while loading rather than mounting the page', () => {
    page(['ro-quoting']);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByText('the page')).not.toBeInTheDocument();
  });

  it('fails closed when the switches cannot be loaded', async () => {
    server.use(http.get('/api/me/visible-features', () => new HttpResponse(null, { status: 500 })));
    page(['ro-quoting']);
    expect(await screen.findByText("This page isn't available")).toBeInTheDocument();
  });

  it('lets a caller who bypasses the switches straight through', () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, bypassesFeatureSwitches: true };
    page(['ro-historic-archive']);
    expect(screen.getByText('the page')).toBeInTheDocument();
  });

  it('does not gate a path no menu entry owns', () => {
    page([]);
    expect(screen.getByText('the page')).toBeInTheDocument();
  });
});
