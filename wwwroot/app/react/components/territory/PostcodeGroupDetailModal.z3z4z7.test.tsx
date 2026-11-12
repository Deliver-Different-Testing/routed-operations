import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/renderWithProviders';
import { server } from '../../test/server';
import { PostcodeGroupDetailModal } from './PostcodeGroupDetailModal';
import type { PostcodeGroupDetail } from '../../services/territoryService';

const downloadCsv = vi.fn();
vi.mock('../../lib/csvExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/csvExport')>()),
  downloadCsv: (...args: unknown[]) => downloadCsv(...args),
}));

const detail: PostcodeGroupDetail = {
  group: {
    id: 41, name: 'Hamilton Metro', depotId: 3, depotName: 'Hamilton', clientId: null, clientCode: null,
    postcodeCount: 3, zoneCount: 2, polygonCount: 0, deliveryScheduleCount: 1, pickupScheduleCount: 0,
  } as PostcodeGroupDetail['group'],
  zones: [
    { zone: 2, label: 'Outer', memberCount: 1, members: [{ id: 903, code: '3210', value: 3210, suburb: 'Fairfield' }] },
    { zone: 1, label: 'Inner', memberCount: 2, members: [
      { id: 902, code: '3216', value: 3216, suburb: 'Hillcrest' },
      { id: 901, code: '3204', value: 3204, suburb: 'Frankton' },
    ] },
  ],
  schedules: [{ scheduleId: 2908, name: 'Waikato Morning', usedForDelivery: true, usedForPickup: false, dayCount: 5 }],
  polygons: [],
};

function mockGroup() {
  server.use(
    http.get('/api/territory/postcode-groups/41/detail', () => HttpResponse.json({ response: detail })),
    http.get('/api/territory/postcode-groups/41/map', () =>
      HttpResponse.json({ response: { shapes: [], codesWithNoShape: [], depotLatitude: null, depotLongitude: null } })),
  );
}

const render = (extra: { onOpenSchedule?: (id: number) => void; onClose?: () => void } = {}) =>
  renderWithProviders(
    <PostcodeGroupDetailModal
      groupId={41}
      onClose={extra.onClose ?? (() => {})}
      onEdit={() => {}}
      onBindPolygons={() => {}}
      onOpenSchedule={extra.onOpenSchedule}
    />,
  );

describe('PostcodeGroupDetailModal - Z7 schedule rows open the schedule', () => {
  it('closes the group and opens the clicked schedule', async () => {
    mockGroup();
    const onOpenSchedule = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render({ onOpenSchedule, onClose });

    await user.click(await screen.findByTestId('pg-schedule-2908'));

    expect(onClose).toHaveBeenCalled();
    expect(onOpenSchedule).toHaveBeenCalledWith(2908);
  });
});

describe('PostcodeGroupDetailModal - Z3 export', () => {
  it('downloads the group as Zone,Postcode,Suburb sorted by zone then postcode', async () => {
    mockGroup();
    downloadCsv.mockClear();
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByTestId('pg-export-csv'));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [rows, name] = downloadCsv.mock.calls[0] as [string[][], string];
    expect(rows).toEqual([
      ['Zone', 'Postcode', 'Suburb'],
      ['1', '3204', 'Frankton'],
      ['1', '3216', 'Hillcrest'],
      ['2', '3210', 'Fairfield'],
    ]);
    expect(name).toMatch(/^Hamilton Metro-postcodes-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

describe('PostcodeGroupDetailModal - Z4 change a postcode zone', () => {
  it('confirms, then PUTs the full current row with only Zone changed', async () => {
    mockGroup();
    const puts: Record<string, unknown>[] = [];
    server.use(
      http.get('/api/territory/nz/postcodes', () => HttpResponse.json({ response: [{
        id: 901, postCode: 3204, zone: 1, depotId: 3, depotName: 'Hamilton', postcodeGroupId: 41,
        postcodeGroupName: 'Hamilton Metro', fromSiteId: 7, name: 'Frankton', fromLatLng: '-37.79,175.26',
      }] })),
      http.put('/api/territory/nz/postcodes/901', async ({ request }) => {
        puts.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ response: {} });
      }),
    );
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByTestId('pg-zone-toggle-1'));
    await user.selectOptions(screen.getByTestId('pg-move-901'), '2');
    const dialog = await screen.findByRole('dialog', { name: /Move postcode 3204/ });
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      postCode: 3204, zone: 2, depotId: 3, postcodeGroupId: 41,
      fromSiteId: 7, name: 'Frankton', fromLatLng: '-37.79,175.26',
    });
  });

  it('sends nothing when the move is cancelled', async () => {
    mockGroup();
    const puts: unknown[] = [];
    server.use(http.put('/api/territory/nz/postcodes/901', () => { puts.push(1); return HttpResponse.json({}); }));
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByTestId('pg-zone-toggle-1'));
    await user.selectOptions(screen.getByTestId('pg-move-901'), '2');
    const dialog = await screen.findByRole('dialog', { name: /Move postcode 3204/ });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(puts).toHaveLength(0);
  });
});
