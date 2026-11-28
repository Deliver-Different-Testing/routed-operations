import { describe, expect, it, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { RO_FEATURE_KEYS } from '@/lib/accessSwitches';
import { Sidebar } from './Sidebar';
import { navItems } from './navItems';
import { renderWithProviders } from '@/test/renderWithProviders';

const section = (name: string) => screen.getByRole('button', { name });
const noSection = (name: string) => screen.queryByRole('button', { name });
const linksUnder = (name: string) => {
  const panel = document.getElementById(section(name).getAttribute('aria-controls') ?? '');
  if (!panel) throw new Error(`section "${name}" controls no panel`);
  return within(panel).getAllByRole('link').map((a) => a.textContent);
};

describe('Sidebar', () => {
  beforeEach(() => {
    // window persists across tests in a file, so pin the role explicitly or
    // the network-partner cases at the bottom leak into everything after them.
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      isNetworkPartner: false,
      bypassesFeatureSwitches: false,
    };
  });

  it('shows the app name with a line saying what it is for', () => {
    renderWithProviders(<Sidebar />);
    expect(screen.getByText('Routed Operations')).toBeInTheDocument();
    expect(screen.getByText('Runs, routes and schedules')).toBeInTheDocument();
  });

  it('shows Dashboard as a link and the pages in three sections', () => {
    renderWithProviders(<Sidebar />);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
    expect(section('Run the day')).toBeInTheDocument();
    expect(section('Plan')).toBeInTheDocument();
    expect(section('Tools')).toBeInTheDocument();
  });

  it('puts each page in its section, in order', () => {
    renderWithProviders(<Sidebar />);
    expect(linksUnder('Run the day')).toEqual(
      ['Route Viewer', 'Linehaul', 'Scan Manager', 'Print Manager', 'Customer Services']);
    expect(linksUnder('Plan')).toEqual(
      ['Recurring Routes', 'Schedules', 'Client Overrides', 'Driver Rostering', 'Polygon Builder']);
    expect(linksUnder('Tools')).toEqual(
      ['Bulk Import', 'Route Builder', 'Quoting', 'Auto-Assign Log']);
  });

  it('has one Schedules entry, opening the current Schedules page, with no NEW label', () => {
    renderWithProviders(<Sidebar />);
    expect(screen.getAllByRole('link', { name: 'Schedules' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Schedules' })).toHaveAttribute('href', '/schedules-new');
    expect(screen.queryByText('NEW')).not.toBeInTheDocument();
  });

  it('does not link to the old Schedules page or to Historic Archive Upload, even for DFRNT staff', () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, bypassesFeatureSwitches: true, isInternal: true };
    renderWithProviders(<Sidebar />);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).not.toContain('/schedules');
    expect(hrefs).not.toContain('/historic-archive');
    expect(screen.queryByText('Historic Archive Upload')).not.toBeInTheDocument();
  });

  it('gives a menu entry to every page in the menu tree that is not marked hidden, so a new page cannot go missing', () => {
    renderWithProviders(<Sidebar />);
    const leaves = navItems.filter((item) => !item.hidden)
      .flatMap((item) => (item.children ?? [item]).filter((leaf) => !leaf.hidden));
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect([...hrefs].sort()).toEqual(leaves.map((leaf) => leaf.to).sort());
  });

  it('gives Dashboard and every section an icon', () => {
    renderWithProviders(<Sidebar />);
    for (const el of [screen.getByRole('link', { name: 'Dashboard' }), section('Run the day'), section('Plan'), section('Tools')]) {
      expect(el.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('shows no build-stage note under the menu', () => {
    renderWithProviders(<Sidebar />);
    expect(screen.queryByText(/Stage 1/)).not.toBeInTheDocument();
  });

  it('opens the section that holds the current page and leaves the others closed', () => {
    renderWithProviders(<Sidebar />, { initialRoute: '/route-viewer/scans' });
    expect(section('Run the day')).toHaveAttribute('aria-expanded', 'true');
    expect(section('Plan')).toHaveAttribute('aria-expanded', 'false');
    expect(section('Tools')).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens Plan for a planning page', () => {
    renderWithProviders(<Sidebar />, { initialRoute: '/schedules-new' });
    expect(section('Plan')).toHaveAttribute('aria-expanded', 'true');
    expect(section('Run the day')).toHaveAttribute('aria-expanded', 'false');
  });

  it('starts with every section closed on the Dashboard, and opens one on click', () => {
    renderWithProviders(<Sidebar />, { initialRoute: '/dashboard' });
    const plan = section('Plan');
    expect(plan).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(plan);
    expect(plan).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(plan);
    expect(plan).toHaveAttribute('aria-expanded', 'false');
  });

  it('marks the current page, and only that page', () => {
    renderWithProviders(<Sidebar />, { initialRoute: '/route-viewer/scans' });
    expect(screen.getByRole('link', { name: 'Scan Manager' })).toHaveAttribute('aria-current', 'page');
    // /route-viewer is a prefix of /route-viewer/scans but is a different page.
    expect(screen.getByRole('link', { name: 'Route Viewer' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });

  it('marks Dashboard when it is the current page', () => {
    renderWithProviders(<Sidebar />, { initialRoute: '/dashboard' });
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  });

  // -- Network partner ------------------------------------------------
  // The list itself lives in lib/partnerAccess and is covered by
  // partnerAccess.test.ts; these check the Sidebar actually applies it.

  it('hides every page a network partner would be refused', () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, isNetworkPartner: true };
    renderWithProviders(<Sidebar />);
    for (const label of [
      'Route Builder', 'Bulk Import', 'Recurring Routes', 'Client Overrides',
      'Driver Rostering', 'Polygon Builder', 'Quoting', 'Auto-Assign Log',
    ]) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(screen.queryAllByText('Schedules')).toHaveLength(0);
  });

  it('keeps Dashboard and the Route Viewer pages for a network partner', () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, isNetworkPartner: true };
    renderWithProviders(<Sidebar />);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(linksUnder('Run the day')).toContain('Route Viewer');
  });

  it('drops the Plan section for a network partner, who can open none of it', () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, isNetworkPartner: true };
    renderWithProviders(<Sidebar />);
    expect(noSection('Plan')).toBeNull();
  });

  // -- Access Control switches ----------------------------------------
  // Every entry is behind its ro-* switch. The default MSW handler grants
  // all of them; these override it.

  const grant = (keys: readonly string[]) =>
    server.use(http.get('/api/me/visible-features', () => HttpResponse.json([...keys])));

  it('hides an entry whose switch is off', async () => {
    grant(RO_FEATURE_KEYS.filter((k) => k !== 'ro-quoting'));
    renderWithProviders(<Sidebar />);
    await waitFor(() => expect(screen.queryByText('Quoting')).not.toBeInTheDocument());
    expect(screen.getByText('Route Builder')).toBeInTheDocument();
  });

  it('drops Run the day when the Route Viewer switch is off', async () => {
    grant(RO_FEATURE_KEYS.filter((k) => k !== 'ro-route-viewer'));
    renderWithProviders(<Sidebar />, { initialRoute: '/dashboard' });
    await waitFor(() => expect(noSection('Run the day')).toBeNull());
    expect(screen.queryByText('Scan Manager')).not.toBeInTheDocument();
    expect(screen.queryByText('Route Viewer')).not.toBeInTheDocument();
  });

  it('drops a section left with no pages', async () => {
    grant(RO_FEATURE_KEYS.filter((k) => !['ro-route-viewer-runs', 'ro-linehaul', 'ro-scan-manager',
      'ro-print-manager', 'ro-customer-services'].includes(k)));
    renderWithProviders(<Sidebar />);
    await waitFor(() => expect(noSection('Run the day')).toBeNull());
    expect(section('Plan')).toBeInTheDocument();
  });

  it('fails closed when the switches cannot be loaded', async () => {
    server.use(http.get('/api/me/visible-features', () => new HttpResponse(null, { status: 500 })));
    renderWithProviders(<Sidebar />);
    await waitFor(() => expect(screen.queryByText('Dashboard')).not.toBeInTheDocument());
    expect(screen.queryByText('Route Builder')).not.toBeInTheDocument();
    expect(noSection('Tools')).toBeNull();
  });

  it('shows everything to a caller who bypasses the switches, without asking', () => {
    // DF Admin. No handler call is needed: an unhandled request would fail the test.
    server.use(http.get('/api/me/visible-features', () => { throw new Error('should not be fetched'); }));
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, bypassesFeatureSwitches: true };
    renderWithProviders(<Sidebar />);
    expect(screen.getByText('Auto-Assign Log')).toBeInTheDocument();
    expect(screen.getByText('Quoting')).toBeInTheDocument();
  });

  it('never renders Mobile, which has a switch but no menu entry', () => {
    renderWithProviders(<Sidebar />, { initialRoute: '/route-viewer' });
    expect(screen.queryByText('Mobile')).not.toBeInTheDocument();
  });
});
