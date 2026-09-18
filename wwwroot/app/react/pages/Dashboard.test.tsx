import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import Dashboard from './Dashboard';

describe('Dashboard page', () => {
  it('renders the You card with default user info', () => {
    renderWithProviders(<Dashboard />);
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText(/Test User/)).toBeInTheDocument();
    expect(screen.getByText(/test@example.com/)).toBeInTheDocument();
  });

  it('renders all module cards with their CTAs', () => {
    renderWithProviders(<Dashboard />);
    expect(screen.getByText('Data Import')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Data Import' }))
      .toHaveAttribute('href', '/bulk-import');
    expect(screen.getByText('Route Builder')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Route Builder' }))
      .toHaveAttribute('href', '/routes');
    expect(screen.getByText('Route Viewer')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Route Viewer' }))
      .toHaveAttribute('href', '/route-viewer');
    expect(screen.getByText('Quoting')).toBeInTheDocument();
    expect(screen.getByText('Recurring Routes')).toBeInTheDocument();
    expect(screen.getByText('Polygon Builder')).toBeInTheDocument();
  });

  it('renders the new tiles added 2026-09-17 (Schedules legacy + Schedules NEW + Driver Rostering)', () => {
    renderWithProviders(<Dashboard />);
    // Legacy schedules card uses the disambiguated title "Schedules
    // (legacy)" to avoid a duplicate <h2> vs the new Schedules card.
    expect(screen.getByText('Schedules (legacy)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Schedules' }))
      .toHaveAttribute('href', '/schedules');
    // New Schedules card title is plain "Schedules" plus a NEW badge.
    // Look up by CTA to disambiguate from the legacy one.
    expect(screen.getByRole('link', { name: 'Open Schedules NEW' }))
      .toHaveAttribute('href', '/schedules-new');
    // NEW badge presence.
    expect(screen.getByText('NEW')).toBeInTheDocument();
    // Driver Rostering card (renamed 2026-09-18 per Steve, still routes to /driver-scheduling).
    expect(screen.getByText('Driver Rostering')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Driver Rostering' }))
      .toHaveAttribute('href', '/driver-scheduling');
  });

  it('uses postcode label in the Recurring Routes card for the NZ tenant default', () => {
    renderWithProviders(<Dashboard />);
    // Default test AppUser has isUsTenant=false, so the copy talks about
    // "postcode" (NZ) rather than "zip" (US). Rely on the Card container
    // (identified by the h2 title text) rather than .closest('div') which
    // now grabs the badge-flex row instead of the whole card.
    const rrCard = screen.getByText('Recurring Routes').closest('.bg-surface-white');
    expect(rrCard?.textContent).toContain('postcode');
  });

  it('renders US-tenant copy when isUsTenant flips true', () => {
    const original = (window as any).__APP_USER__;
    (window as any).__APP_USER__ = { ...original, isUsTenant: true };
    try {
      renderWithProviders(<Dashboard />);
      // US tenant uses zip in the Polygon Builder / Recurring Routes copy.
      const pbCard = screen.getByText('Polygon Builder').closest('.bg-surface-white');
      expect(pbCard?.textContent?.toLowerCase()).toContain('zip');
    } finally {
      (window as any).__APP_USER__ = original;
    }
  });
});
