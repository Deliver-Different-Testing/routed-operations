import { describe, expect, it } from 'vitest';
import { fixTimeLabel, mapPollInterval, runDriverMarker, type CourierPosition } from './runDriverMarker';

const driver: CourierPosition = {
  courierId: 22, courierCode: '512', vehicleType: 'V', latitude: '40.7128', longitude: -74.006, timestamp: '2026-11-28T10:00:00',
};

describe('runDriverMarker', () => {
  it('shows the run driver when the envelope set does not have them (the Cheetah gap)', () => {
    expect(runDriverMarker(driver, [])).toEqual({ courierId: 22, lat: 40.7128, lng: -74.006, label: '512 V 10:00' });
  });

  it('does not draw a second marker when All couriers already shows the driver', () => {
    expect(runDriverMarker(driver, [{ ...driver }])).toBeNull();
  });

  it('still draws the driver when the envelope row for them has no position', () => {
    expect(runDriverMarker(driver, [{ ...driver, latitude: null }])).not.toBeNull();
  });

  it('draws nothing without a usable fix (0,0 is the GPS no-fix value)', () => {
    expect(runDriverMarker(null, [])).toBeNull();
    expect(runDriverMarker({ ...driver, latitude: 0, longitude: 0 }, [])).toBeNull();
  });

  it('falls back to the courier id when there is no code', () => {
    expect(runDriverMarker({ ...driver, courierCode: null, vehicleType: null, timestamp: null }, null)?.label).toBe('Courier 22');
  });
});

describe('fixTimeLabel', () => {
  it('shows the server clock as written, not converted from UTC', () => {
    // Cheetah stores NZ server time; 23:05 must stay 23:05 in any browser.
    expect(fixTimeLabel('2026-11-28T23:05:41')).toBe('23:05');
    expect(fixTimeLabel('2026-11-28 07:09:00.123')).toBe('07:09');
  });

  it('shows no time when there is none', () => {
    expect(fixTimeLabel(null)).toBeNull();
    expect(fixTimeLabel('')).toBeNull();
  });
});

describe('mapPollInterval', () => {
  it('keeps polling after an error, just slower, so one blip does not stop the map', () => {
    expect(mapPollInterval(true, 'error')).toBe(120_000);
    expect(mapPollInterval(true, 'success')).toBe(30_000);
  });

  it('does not poll when the layer is off', () => {
    expect(mapPollInterval(false, 'success')).toBe(false);
  });
});
