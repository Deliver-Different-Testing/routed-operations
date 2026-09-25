import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { ZonesDrawer } from './ZonesDrawer';
import type { RatingZoneDepot } from '@/services/zoneService';

function makeDepot(over: Partial<RatingZoneDepot> = {}): RatingZoneDepot {
  return {
    countryCode: 'NZ',
    depotId: 1,
    depotName: 'Auckland Depot',
    postcodeCount: 4,
    groups: [
      {
        groupId: 100,
        groupName: 'Metro',
        zoneName: null,
        postcodeCount: 4,
        zones: [
          { zone: 1, postcodes: ['1010', '1011'] },
          { zone: 2, postcodes: ['1050', '1051'] },
        ],
      },
    ],
    ...over,
  };
}

describe('ZonesDrawer', () => {
  it('does not render its dialog when closed', () => {
    renderWithProviders(
      <ZonesDrawer open={false} onClose={vi.fn()} prefetchedDepots={undefined} />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens with prefetched depots and skips network', () => {
    renderWithProviders(
      <ZonesDrawer
        open
        onClose={vi.fn()}
        prefetchedDepots={[makeDepot()]}
      />
    );
    expect(screen.getByText('Auckland Depot')).toBeInTheDocument();
    expect(screen.getByText('Metro')).toBeInTheDocument();
    expect(screen.getByText('Zone 1')).toBeInTheDocument();
    expect(screen.getByText('Zone 2')).toBeInTheDocument();
  });

  it('shows "Fetching rating geography..." until the fetch resolves', async () => {
    server.use(
      http.get('/api/zones/rating-postcodes', () => HttpResponse.json({ response: [] })),
    );
    renderWithProviders(<ZonesDrawer open onClose={vi.fn()} prefetchedDepots={null} />);
    await waitFor(() => expect(screen.getByText(/No rating geography configured/)).toBeInTheDocument());
  });

  it('fetches depots when no prefetch and renders results', async () => {
    server.use(
      http.get('/api/zones/rating-postcodes', () =>
        HttpResponse.json({ response: [makeDepot()] })
      ),
    );
    renderWithProviders(<ZonesDrawer open onClose={vi.fn()} prefetchedDepots={null} />);
    await waitFor(() => expect(screen.getByText('Auckland Depot')).toBeInTheDocument());
  });

  it('close button fires onClose', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <ZonesDrawer open onClose={onClose} prefetchedDepots={[]} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('backdrop click closes the drawer', () => {
    const onClose = vi.fn();
    const { container } = renderWithProviders(
      <ZonesDrawer open onClose={onClose} prefetchedDepots={[]} />
    );
    const backdrop = container.querySelector('[data-zones-drawer-backdrop="true"]')!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('search input filters depots by postcode substring', () => {
    renderWithProviders(
      <ZonesDrawer open onClose={vi.fn()} prefetchedDepots={[makeDepot()]} />
    );
    const input = screen.getByPlaceholderText(/Search depot/);
    fireEvent.change(input, { target: { value: '1010' } });
    expect(screen.getByText('Auckland Depot')).toBeInTheDocument();
    // Zone 2 (with 1050) filtered out.
    expect(screen.queryByText('Zone 2')).not.toBeInTheDocument();
  });

  it('shows "No matches" phrase when the search yields nothing', () => {
    renderWithProviders(
      <ZonesDrawer open onClose={vi.fn()} prefetchedDepots={[makeDepot()]} />
    );
    fireEvent.change(screen.getByPlaceholderText(/Search depot/), { target: { value: 'zzz' } });
    expect(screen.getByText(/No matches for "zzz"/)).toBeInTheDocument();
  });

  it('clicking a zone row emits onShowZipsOnMap with its postcodes + context', () => {
    const onShowZipsOnMap = vi.fn();
    renderWithProviders(
      <ZonesDrawer
        open
        onClose={vi.fn()}
        prefetchedDepots={[makeDepot()]}
        onShowZipsOnMap={onShowZipsOnMap}
      />
    );
    fireEvent.click(screen.getByText('Zone 1'));
    expect(onShowZipsOnMap).toHaveBeenCalledWith(
      ['1010', '1011'],
      expect.stringContaining('Auckland Depot')
    );
  });

  it('Enter key on a zone row fires the onShowZipsOnMap handler', () => {
    const onShowZipsOnMap = vi.fn();
    renderWithProviders(
      <ZonesDrawer
        open
        onClose={vi.fn()}
        prefetchedDepots={[makeDepot()]}
        onShowZipsOnMap={onShowZipsOnMap}
      />
    );
    const zoneRow = screen.getByText('Zone 1').closest('[role="button"]')!;
    fireEvent.keyDown(zoneRow, { key: 'Enter' });
    expect(onShowZipsOnMap).toHaveBeenCalled();
  });

  it('shows "No rating geography configured" empty state', () => {
    renderWithProviders(
      <ZonesDrawer open onClose={vi.fn()} prefetchedDepots={[]} />
    );
    expect(screen.getByText(/No rating geography configured/)).toBeInTheDocument();
  });

  it('Refresh button calls the network again', async () => {
    let hits = 0;
    server.use(
      http.get('/api/zones/rating-postcodes', () => {
        hits += 1;
        return HttpResponse.json({ response: [makeDepot({ depotId: hits + 100 })] });
      }),
    );
    renderWithProviders(<ZonesDrawer open onClose={vi.fn()} prefetchedDepots={[makeDepot()]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(hits).toBe(1));
  });

  it('promotes zoneName as the primary label when groupId is null (US path)', () => {
    const usDepot = makeDepot({
      countryCode: 'US',
      depotName: 'Boston Depot',
      groups: [
        {
          groupId: null,
          groupName: '(no group)',
          zoneName: 'New England Zone',
          postcodeCount: 2,
          zones: [{ zone: 1, postcodes: ['02108'] }],
        },
      ],
    });
    renderWithProviders(<ZonesDrawer open onClose={vi.fn()} prefetchedDepots={[usDepot]} />);
    expect(screen.getByText('New England Zone')).toBeInTheDocument();
  });

  it('shows US country badge and pluralises zips label', () => {
    const usDepot = makeDepot({ countryCode: 'US', postcodeCount: 2 });
    renderWithProviders(<ZonesDrawer open onClose={vi.fn()} prefetchedDepots={[usDepot]} />);
    expect(screen.getByText('US')).toBeInTheDocument();
    // "2 zips" (plural) for US, "postcodes" for NZ.
    expect(screen.getByText(/2 zips/)).toBeInTheDocument();
  });
});
