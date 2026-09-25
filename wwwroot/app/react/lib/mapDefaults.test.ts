import { describe, expect, it } from 'vitest';
import { NZ_CENTRE, US_CENTRE, tenantMapCentre } from './mapDefaults';

describe('US_CENTRE', () => {
  it('is San Francisco coordinates', () => {
    expect(US_CENTRE).toEqual({ lat: 37.7749, lng: -122.4194 });
  });
});

describe('NZ_CENTRE', () => {
  it('is Auckland coordinates', () => {
    expect(NZ_CENTRE).toEqual({ lat: -36.848, lng: 174.763 });
  });
});

describe('tenantMapCentre', () => {
  it('returns US centre when isUsTenant is true', () => {
    expect(tenantMapCentre(true)).toEqual(US_CENTRE);
  });

  it('returns NZ centre when isUsTenant is false', () => {
    expect(tenantMapCentre(false)).toEqual(NZ_CENTRE);
  });
});
