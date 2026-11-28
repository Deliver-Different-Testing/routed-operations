import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { RO_FEATURE_KEYS } from '@/lib/accessSwitches';
import { renderWithProviders } from '@/test/renderWithProviders';
import Dashboard from './Dashboard';

const BASE_USER = { ...(window as any).__APP_USER__ };

function asUser(overrides: Record<string, unknown>) {
  (window as any).__APP_USER__ = { ...BASE_USER, ...overrides };
}

function onlyTheseSwitches(keys: readonly string[]) {
  server.use(http.get('/api/me/visible-features', () => HttpResponse.json([...keys])));
}

const card = (name: RegExp) => screen.getByRole('link', { name });
const noCard = (name: RegExp) => screen.queryByRole('link', { name });

describe('Routed Operations home page', () => {
  beforeEach(() => {
    // window persists across tests in a file, so reset the caller each time.
    asUser({ isNetworkPartner: false, bypassesFeatureSwitches: false, isInternal: false, isUsTenant: false });
  });

  it('greets the person by first name and shows no email or tenant number', () => {
    renderWithProviders(<Dashboard />);
    expect(screen.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening), Test$/ })).toBeInTheDocument();
    expect(screen.queryByText('You')).not.toBeInTheDocument();
    expect(screen.queryByText(/test@example\.com/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Tenant:/)).not.toBeInTheDocument();
  });

  it('groups the pages under Run the day, Plan and Tools', () => {
    renderWithProviders(<Dashboard />);
    expect(screen.getByRole('heading', { level: 2, name: /Run the day/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Plan/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Tools/ })).toBeInTheDocument();
  });

  it('links every card to its page', () => {
    renderWithProviders(<Dashboard />);
    expect(card(/^Route Viewer/)).toHaveAttribute('href', '/route-viewer');
    expect(card(/^Linehaul/)).toHaveAttribute('href', '/route-viewer/linehaul');
    expect(card(/^Scan Manager/)).toHaveAttribute('href', '/route-viewer/scans');
    expect(card(/^Print Manager/)).toHaveAttribute('href', '/route-viewer/print');
    expect(card(/^Customer Services/)).toHaveAttribute('href', '/route-viewer/cs');
    expect(card(/^Recurring Routes/)).toHaveAttribute('href', '/recurring-routes');
    expect(card(/^Schedules/)).toHaveAttribute('href', '/schedules-new');
    expect(card(/^Client Overrides/)).toHaveAttribute('href', '/client-overrides');
    expect(card(/^Driver Rostering/)).toHaveAttribute('href', '/driver-scheduling');
    expect(card(/^Polygon Builder/)).toHaveAttribute('href', '/polygon-builder');
    expect(card(/^Bulk Import/)).toHaveAttribute('href', '/bulk-import');
    expect(card(/^Route Builder/)).toHaveAttribute('href', '/routes');
    expect(card(/^Quoting/)).toHaveAttribute('href', '/quoting');
    expect(card(/^Auto-Assign Log/)).toHaveAttribute('href', '/auto-assign-log');
  });

  it('gives every card an icon', () => {
    renderWithProviders(<Dashboard />);
    for (const link of screen.getAllByRole('link')) {
      expect(link.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('describes each page in plain words, with no developer notes', () => {
    const { container } = renderWithProviders(<Dashboard />);
    expect(card(/^Scan Manager/)).toHaveTextContent('See every scan, and what has not been scanned yet.');
    const text = container.textContent ?? '';
    for (const banned of ['BulkImportHyper', '/api/', 'tucJobArchive', 'ScheduleId', 'legacy', 'Legacy', 'cockpit', 'P3+']) {
      expect(text).not.toContain(banned);
    }
  });

  it('shows one Schedules card, marked New, and not the old Schedules page', () => {
    renderWithProviders(<Dashboard />);
    expect(screen.getAllByRole('link', { name: /^Schedules/ })).toHaveLength(1);
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.queryByText('Schedules (legacy)')).not.toBeInTheDocument();
  });

  it('keeps Historic Archive Upload for DFRNT staff only', () => {
    renderWithProviders(<Dashboard />);
    expect(noCard(/^Historic Archive Upload/)).toBeNull();
  });

  it('shows Historic Archive Upload, tagged DFRNT only, to DFRNT staff', () => {
    asUser({ isInternal: true });
    renderWithProviders(<Dashboard />);
    expect(card(/^Historic Archive Upload/)).toHaveAttribute('href', '/historic-archive');
    expect(screen.getByText('DFRNT only')).toBeInTheDocument();
  });

  it('hides a card whose page is switched off for the person', async () => {
    onlyTheseSwitches(RO_FEATURE_KEYS.filter((k) => k !== 'ro-linehaul'));
    renderWithProviders(<Dashboard />);
    await waitFor(() => expect(noCard(/^Linehaul/)).toBeNull());
    expect(card(/^Scan Manager/)).toBeInTheDocument();
  });

  it('hides every Route Viewer card when the Route Viewer switch is off', async () => {
    onlyTheseSwitches(RO_FEATURE_KEYS.filter((k) => k !== 'ro-route-viewer'));
    renderWithProviders(<Dashboard />);
    await waitFor(() => expect(noCard(/^Route Viewer/)).toBeNull());
    expect(noCard(/^Linehaul/)).toBeNull();
    expect(noCard(/^Scan Manager/)).toBeNull();
    expect(card(/^Recurring Routes/)).toBeInTheDocument();
  });

  it('drops a whole group when none of its pages is switched on', async () => {
    onlyTheseSwitches(['ro-dashboard', 'ro-bulk-import']);
    renderWithProviders(<Dashboard />);
    await waitFor(() => expect(screen.queryByRole('heading', { level: 2, name: /Plan/ })).toBeNull());
    expect(screen.queryByRole('heading', { level: 2, name: /Run the day/ })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: /Tools/ })).toBeInTheDocument();
    expect(card(/^Bulk Import/)).toBeInTheDocument();
  });

  it('shows every card to a DFRNT admin without asking for the switches', () => {
    asUser({ bypassesFeatureSwitches: true, isInternal: true });
    server.use(http.get('/api/me/visible-features', () => { throw new Error('should not be fetched'); }));
    renderWithProviders(<Dashboard />);
    expect(card(/^Linehaul/)).toBeInTheDocument();
    expect(card(/^Quoting/)).toBeInTheDocument();
  });

  it('shows nothing rather than everything when the switches fail to load', async () => {
    server.use(http.get('/api/me/visible-features', () => new HttpResponse(null, { status: 500 })));
    renderWithProviders(<Dashboard />);
    await waitFor(() => expect(noCard(/^Route Viewer/)).toBeNull());
    expect(screen.getByText(/None of the Routed Operations pages are switched on for you yet\./)).toBeInTheDocument();
  });

  it('does not show a network partner the pages they are refused', () => {
    asUser({ isNetworkPartner: true });
    renderWithProviders(<Dashboard />);
    expect(card(/^Route Viewer/)).toBeInTheDocument();
    expect(noCard(/^Recurring Routes/)).toBeNull();
    expect(noCard(/^Bulk Import/)).toBeNull();
    expect(noCard(/^Quoting/)).toBeNull();
  });

  it('says postcodes for a tenant outside the US', () => {
    renderWithProviders(<Dashboard />);
    expect(card(/^Recurring Routes/)).toHaveTextContent('postcodes');
    expect(card(/^Polygon Builder/)).toHaveTextContent('postcodes');
  });

  it('says ZIPs for a US tenant', () => {
    asUser({ isUsTenant: true });
    renderWithProviders(<Dashboard />);
    expect(card(/^Recurring Routes/)).toHaveTextContent('ZIPs');
    expect(card(/^Polygon Builder/)).toHaveTextContent('ZIPs');
  });
});
