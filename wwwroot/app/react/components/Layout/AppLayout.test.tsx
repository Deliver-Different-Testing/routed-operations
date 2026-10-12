import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { AppLayout } from './AppLayout';
import { renderWithProviders } from '@/test/renderWithProviders';

const layoutAt = (path: string) =>
  renderWithProviders(
    <Routes>
      <Route element={<AppLayout />}>
        <Route path={path} element={<div data-testid="outlet">Outlet body</div>} />
      </Route>
    </Routes>,
    { initialRoute: path },
  );

describe('AppLayout', () => {
  it('renders sidebar chrome, header title strip, and the routed outlet', async () => {
    layoutAt('/dashboard');
    // The outlet sits behind the page's Access Control switch, so it mounts
    // once the caller's switches have loaded (default handler: all on).
    expect(await screen.findByTestId('outlet')).toHaveTextContent('Outlet body');
    // Sidebar brand text is always present regardless of route.
    expect(screen.getByText('Routed Operations')).toBeInTheDocument();
  });

  it('guards the outlet with the switches on the route menu chain', async () => {
    // Mobile has no menu entry but still needs the group switch AND its own.
    server.use(http.get('/api/me/visible-features', () => HttpResponse.json(['ro-mobile'])));
    layoutAt('/route-viewer/mobile');
    expect(await screen.findByText("This page isn't available")).toBeInTheDocument();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
  });
});
