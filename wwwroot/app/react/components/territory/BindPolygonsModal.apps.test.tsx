import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/renderWithProviders';
import { server } from '../../test/server';
import { BindPolygonsModal } from './BindPolygonsModal';
import type { BulkPolygon, PolygonAppCode } from '../../services/bulkPolygonService';

// Perimeter spec 4.5: the picker lists the target app's polygons, plus the
// ones already bound to the target (Q2).

const poly = (
  polygonId: number,
  apps: PolygonAppCode[],
  extra: Partial<BulkPolygon> = {},
): BulkPolygon => ({
  polygonId, name: `Shape ${polygonId}`, apps,
  zoneNameId: null, zoneMemberships: [], attachedScheduleNames: [], attachedRouteCount: 0,
  ...extra,
} as unknown as BulkPolygon);

const membership = (postcodeGroupId: number, zone: number) =>
  ({ id: 500 + postcodeGroupId, postcodeGroupId, postcodeGroupName: `Group ${postcodeGroupId}`, zone });

function mockList(rows: BulkPolygon[]) {
  server.use(http.get('/api/bulk-polygons', () => HttpResponse.json({ response: rows })));
}

describe('BindPolygonsModal - filtered by app', () => {
  it('ZoneName target lists Zone rating polygons plus the ones already bound to it', async () => {
    mockList([
      poly(1, ['ZONE_RATING']),
      poly(2, ['SCHEDULES']),
      poly(3, [], { zoneNameId: 7 }),
      poly(4, ['AUTODISPATCH'], { zoneNameId: 8 }),
    ]);
    renderWithProviders(
      <BindPolygonsModal open onClose={() => {}} target={{ kind: 'zoneName', id: 7, label: 'Zone A' }} />);

    expect(await screen.findByTestId('bind-polygon-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('bind-polygon-row-3')).toBeInTheDocument();
    expect(screen.queryByTestId('bind-polygon-row-2')).toBeNull();
    expect(screen.queryByTestId('bind-polygon-row-4')).toBeNull();
  });

  it('keeps an untagged shape listed after it is unbound', async () => {
    mockList([poly(1, ['ZONE_RATING']), poly(3, [], { zoneNameId: 7 })]);
    server.use(http.post('/api/territory/polygons/3/bind', () =>
      HttpResponse.json({ response: { polygonId: 3, name: 'Shape 3', zoneNameId: null } })));
    const user = userEvent.setup();
    renderWithProviders(
      <BindPolygonsModal open onClose={() => {}} target={{ kind: 'zoneName', id: 7, label: 'Zone A' }} />);

    const box = await screen.findByLabelText('Bind Shape 3');
    expect(box).toBeChecked();
    await user.click(box);
    await waitFor(() => expect(screen.getByLabelText('Bind Shape 3')).not.toBeChecked());
    expect(screen.getByTestId('bind-polygon-row-3')).toBeInTheDocument();
  });

  it('zone group target lists Schedules polygons plus members of this group', async () => {
    mockList([
      poly(1, ['SCHEDULES']),
      poly(2, ['AUTODISPATCH']),
      poly(3, ['AUTODISPATCH'], { zoneMemberships: [membership(41, 2)] } as Partial<BulkPolygon>),
      poly(4, ['ZONE_RATING'], { zoneMemberships: [membership(99, 1)] } as Partial<BulkPolygon>),
    ]);
    server.use(http.get('/api/territory/postcode-groups/41/detail', () =>
      HttpResponse.json({ response: { zones: [{ zone: 1 }, { zone: 2 }] } })));
    renderWithProviders(
      <BindPolygonsModal open onClose={() => {}} target={{ kind: 'postcodeGroup', id: 41, label: 'Metro' }} />);

    expect(await screen.findByTestId('bind-polygon-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('bind-polygon-row-3')).toBeInTheDocument();
    expect(screen.queryByTestId('bind-polygon-row-2')).toBeNull();
    expect(screen.queryByTestId('bind-polygon-row-4')).toBeNull();
  });
});
