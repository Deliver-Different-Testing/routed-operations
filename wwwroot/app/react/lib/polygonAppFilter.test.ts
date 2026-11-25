import { describe, expect, it } from 'vitest';
import type { BulkPolygon, PolygonAppCode } from '../services/bulkPolygonService';
import { polygonsForApp } from './polygonAppFilter';

const poly = (polygonId: number, apps?: PolygonAppCode[]): BulkPolygon =>
  ({ polygonId, name: `P${polygonId}`, apps } as unknown as BulkPolygon);

describe('polygonsForApp', () => {
  const all = [
    poly(1, ['SCHEDULES']),
    poly(2, ['AUTODISPATCH']),
    poly(3, ['SCHEDULES', 'ROUTES']),
    poly(4, []),
    poly(5, ['ZONE_RATING', 'PERIMETER']),
  ];

  it('keeps only polygons tagged for the app', () => {
    expect(polygonsForApp(all, 'SCHEDULES').map((p) => p.polygonId)).toEqual([1, 3]);
    expect(polygonsForApp(all, 'ROUTES').map((p) => p.polygonId)).toEqual([3]);
    expect(polygonsForApp(all, 'ZONE_RATING').map((p) => p.polygonId)).toEqual([5]);
  });

  it('keeps an attached polygon that is not tagged (Q2), in input order', () => {
    expect(polygonsForApp(all, 'SCHEDULES', [4, 2]).map((p) => p.polygonId)).toEqual([1, 2, 3, 4]);
  });

  it('accepts a Set of attached ids', () => {
    expect(polygonsForApp(all, 'ROUTES', new Set([5])).map((p) => p.polygonId)).toEqual([3, 5]);
  });

  it('ignores attached ids that are not in the list', () => {
    expect(polygonsForApp(all, 'ROUTES', [99]).map((p) => p.polygonId)).toEqual([3]);
  });

  it('keeps a row with no apps field (payload without tags)', () => {
    expect(polygonsForApp([poly(7), poly(8, [])], 'SCHEDULES').map((p) => p.polygonId)).toEqual([7]);
  });
});
