import { describe, expect, it } from 'vitest';
import { parseWktPolygon } from './wktPolygon';

describe('parseWktPolygon', () => {
  it('parses a simple WKT POLYGON string', () => {
    const wkt = 'POLYGON((174.76 -36.85, 174.77 -36.85, 174.77 -36.86, 174.76 -36.85))';
    const result = parseWktPolygon(wkt);
    expect(result).toEqual([
      { lat: -36.85, lng: 174.76 },
      { lat: -36.85, lng: 174.77 },
      { lat: -36.86, lng: 174.77 },
      { lat: -36.85, lng: 174.76 },
    ]);
  });

  it('swaps WKT lng-lat order to lat-lng', () => {
    const wkt = 'POLYGON((10 20, 30 40, 50 60, 10 20))';
    const result = parseWktPolygon(wkt);
    expect(result?.[0]).toEqual({ lat: 20, lng: 10 });
    expect(result?.[1]).toEqual({ lat: 40, lng: 30 });
  });

  it('is case insensitive for the POLYGON keyword', () => {
    const wkt = 'polygon((1 2, 3 4, 5 6, 1 2))';
    const result = parseWktPolygon(wkt);
    expect(result).toHaveLength(4);
  });

  it('ignores holes and returns first ring only', () => {
    const wkt = 'POLYGON((0 0, 10 0, 10 10, 0 10, 0 0),(2 2, 4 2, 4 4, 2 4, 2 2))';
    const result = parseWktPolygon(wkt);
    expect(result).toEqual([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: 10, lng: 10 },
      { lat: 10, lng: 0 },
      { lat: 0, lng: 0 },
    ]);
  });

  it('returns null for null input', () => {
    expect(parseWktPolygon(null)).toBe(null);
  });

  it('returns null for undefined input', () => {
    expect(parseWktPolygon(undefined)).toBe(null);
  });

  it('returns null for empty string', () => {
    expect(parseWktPolygon('')).toBe(null);
  });

  it('returns null for a malformed WKT missing double parens', () => {
    expect(parseWktPolygon('POLYGON(1 2, 3 4)')).toBe(null);
  });

  it('skips non-finite coordinate pairs', () => {
    const wkt = 'POLYGON((not a pair, 3 4, 5 6, 3 4))';
    const result = parseWktPolygon(wkt);
    expect(result).toEqual([
      { lat: 4, lng: 3 },
      { lat: 6, lng: 5 },
      { lat: 4, lng: 3 },
    ]);
  });
});
