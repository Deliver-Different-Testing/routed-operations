import { describe, expect, it, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { RvClientIntelBox } from './RvClientIntelBox';

const stubIntel = (row: any) =>
  http.get('/api/runviewer/jobs/client-intel', () =>
    HttpResponse.json({ response: row }),
  );

const stubImages = (rows: any[]) =>
  http.get('/api/runviewer/jobs/client-intel-images', () =>
    HttpResponse.json({ response: rows }),
  );

function renderBox(mobile: string | null | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <RvClientIntelBox mobile={mobile} />
    </QueryClientProvider>,
  );
}

describe('RvClientIntelBox', () => {
  beforeEach(() => {
    server.use(stubIntel(null), stubImages([]));
  });

  it('renders the idle prompt when mobile is null', () => {
    renderBox(null);
    expect(screen.getByText('Client Intel')).toBeInTheDocument();
    expect(
      screen.getByText(/Select a job with a mobile number/),
    ).toBeInTheDocument();
  });

  it('renders the idle prompt when mobile is empty string', () => {
    renderBox('');
    expect(
      screen.getByText(/Select a job with a mobile number/),
    ).toBeInTheDocument();
  });

  it('renders the idle prompt when mobile is only whitespace', () => {
    renderBox('   ');
    expect(
      screen.getByText(/Select a job with a mobile number/),
    ).toBeInTheDocument();
  });

  it('shows loading state before intel arrives', () => {
    server.use(
      http.get('/api/runviewer/jobs/client-intel', () => new Promise(() => {})),
    );
    renderBox('0210001');
    expect(screen.getByText(/Loading intel/)).toBeInTheDocument();
  });

  it('shows "no intel on file" when SP returns null', async () => {
    server.use(stubIntel(null), stubImages([]));
    renderBox('0210001');
    expect(
      await screen.findByText(/No intel on file for/),
    ).toBeInTheDocument();
    expect(screen.getByText('0210001')).toBeInTheDocument();
  });

  it('renders mobile, notes and dangerous-dog badge when present', async () => {
    server.use(
      stubIntel({
        clientIntelId: 1,
        mobile: '0210001',
        dog: true,
        notes: 'Beware of the goose',
        hasPhoto: false,
      }),
      stubImages([]),
    );
    renderBox('0210001');
    expect(await screen.findByText('Dangerous Dog')).toBeInTheDocument();
    expect(screen.getByText('Beware of the goose')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
    // Mobile appears twice (once as prop, once as intel.mobile row).
    expect(screen.getAllByText('0210001').length).toBeGreaterThan(0);
  });

  it('falls back to prop mobile when intel.mobile is null', async () => {
    server.use(
      stubIntel({
        clientIntelId: 1,
        mobile: null,
        dog: false,
        notes: null,
        hasPhoto: false,
      }),
    );
    renderBox('021FALLBACK');
    expect(await screen.findByText('021FALLBACK')).toBeInTheDocument();
  });

  it('omits dog badge and notes block when both are absent', async () => {
    server.use(
      stubIntel({
        clientIntelId: 1,
        mobile: '021',
        dog: false,
        notes: null,
        hasPhoto: false,
      }),
    );
    renderBox('021');
    // Wait for intel to load
    await screen.findByText('021');
    expect(screen.queryByText('Dangerous Dog')).toBeNull();
    expect(screen.queryByText('Notes')).toBeNull();
  });

  it('renders photos when hasPhoto and images arrive', async () => {
    server.use(
      stubIntel({
        clientIntelId: 1,
        mobile: '021',
        dog: false,
        notes: null,
        hasPhoto: true,
      }),
      stubImages([
        { photo: 'AAAA', description: 'front door', key: 'k1' },
        { photo: 'BBBB', description: null, key: null },
      ]),
    );
    renderBox('021');
    await waitFor(() => expect(screen.getByText('Photos (2)')).toBeInTheDocument());
    expect(screen.getByAltText('front door')).toBeInTheDocument();
    // Fallback alt when description is null
    expect(screen.getByAltText('intel-1')).toBeInTheDocument();
  });

  it('does not render photos block when hasPhoto is false even if images returned', async () => {
    server.use(
      stubIntel({
        clientIntelId: 1,
        mobile: '021',
        dog: false,
        notes: null,
        hasPhoto: false,
      }),
      stubImages([{ photo: 'A', description: 'x', key: 'k' }]),
    );
    renderBox('021');
    await screen.findByText('021');
    expect(screen.queryByText(/Photos/)).toBeNull();
  });

  it('does not render photos block when hasPhoto is true but images list is empty', async () => {
    server.use(
      stubIntel({
        clientIntelId: 1,
        mobile: '021',
        dog: false,
        notes: null,
        hasPhoto: true,
      }),
      stubImages([]),
    );
    renderBox('021');
    await screen.findByText('021');
    expect(screen.queryByText(/Photos/)).toBeNull();
  });
});
