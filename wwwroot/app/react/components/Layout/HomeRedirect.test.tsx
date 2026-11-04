import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { HomeRedirect } from './HomeRedirect';

// The landing for "/" (M3). A caller is sent to the first page they can
// open; with nothing open they get one plain explanation instead of a
// "not available" page and an empty menu.
describe('HomeRedirect', () => {
  beforeEach(() => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, bypassesFeatureSwitches: false, isNetworkPartner: false };
  });

  const land = () =>
    renderWithProviders(
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/bulk-import" element={<p>bulk import page</p>} />
        <Route path="/dashboard" element={<p>dashboard page</p>} />
      </Routes>,
      { initialRoute: '/' },
    );

  it('sends a Bulk Import only caller to /bulk-import', async () => {
    server.use(http.get('/api/me/visible-features', () => HttpResponse.json(['ro-bulk-import'])));
    land();
    expect(await screen.findByText('bulk import page')).toBeInTheDocument();
  });

  it('shows the empty state when nothing is switched on', async () => {
    server.use(http.get('/api/me/visible-features', () => HttpResponse.json([])));
    land();
    expect(await screen.findByText('Nothing is switched on for your account yet')).toBeInTheDocument();
    expect(screen.queryByText('dashboard page')).not.toBeInTheDocument();
  });

  it('fails closed to the empty state when the switches cannot be loaded', async () => {
    server.use(http.get('/api/me/visible-features', () => new HttpResponse(null, { status: 500 })));
    land();
    expect(await screen.findByText('Nothing is switched on for your account yet')).toBeInTheDocument();
  });

  it('DF Admin keeps /dashboard', async () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, bypassesFeatureSwitches: true };
    land();
    expect(await screen.findByText('dashboard page')).toBeInTheDocument();
  });
});
