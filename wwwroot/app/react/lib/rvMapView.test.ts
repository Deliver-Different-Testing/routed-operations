import { describe, expect, it } from 'vitest';
import { decideRvMapView, RV_ORIGIN_ZOOM } from './rvMapView';

// Cheetah M3: an empty route run must open on its depot, not on the
// tenant-wide default, while runs with pins keep fitting to the pins.
describe('decideRvMapView', () => {
  it('centres on the route origin when the run has no pins', () => {
    expect(decideRvMapView(0, 39.5296, -119.8138)).toEqual({
      kind: 'centre', lat: 39.5296, lng: -119.8138, zoom: RV_ORIGIN_ZOOM,
    });
    expect(RV_ORIGIN_ZOOM).toBe(11);
  });

  it('keeps fitting to the pins when there are any, even with an origin', () => {
    // The origin must never pull the viewport away from real job pins.
    expect(decideRvMapView(3, 39.5, -119.8)).toEqual({ kind: 'fit' });
    expect(decideRvMapView(1, null, null)).toEqual({ kind: 'fit' });
  });

  it('leaves the map alone when there are no pins and no origin (real bulk runs)', () => {
    expect(decideRvMapView(0, null, null)).toEqual({ kind: 'none' });
    expect(decideRvMapView(0, undefined, undefined)).toEqual({ kind: 'none' });
  });

  it('treats a half-set or 0,0 origin as no origin', () => {
    // 0 is the "unset" sentinel the pin builder also rejects; centring
    // on the Gulf of Guinea would be worse than doing nothing.
    expect(decideRvMapView(0, 39.5, null)).toEqual({ kind: 'none' });
    expect(decideRvMapView(0, 0, 0)).toEqual({ kind: 'none' });
    expect(decideRvMapView(0, Number.NaN, -119.8)).toEqual({ kind: 'none' });
  });
});
