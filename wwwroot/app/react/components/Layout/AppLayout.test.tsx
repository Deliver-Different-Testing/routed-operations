import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('AppLayout', () => {
  it('renders sidebar chrome, header title strip, and the routed outlet', () => {
    renderWithProviders(
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<div data-testid="outlet">Outlet body</div>} />
        </Route>
      </Routes>,
      { initialRoute: '/dashboard' }
    );
    expect(screen.getByTestId('outlet')).toHaveTextContent('Outlet body');
    // Sidebar brand text is always present regardless of route.
    expect(screen.getByText('Routed Operations')).toBeInTheDocument();
  });
});
