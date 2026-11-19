import { describe, expect, it } from 'vitest';
import {
  TOTE_NEEDS_MASTER_MESSAGE,
  checkToteSave,
  initialToteScanning,
  toteSavePayload,
} from './finalMileTote';

// Final-mile route setup spec 3.2: the master job is optional. These rules are
// what stop a master-less final-mile route being refused or warned about, and
// what stop tote scanning being switched on without the master it needs.

describe('initialToteScanning', () => {
  it('is off for a new route and for a route without a master', () => {
    expect(initialToteScanning(undefined)).toBe(false);
    expect(initialToteScanning(null)).toBe(false);
    expect(initialToteScanning(0)).toBe(false);
  });

  it('is on for a route that already has a master', () => {
    expect(initialToteScanning(5372)).toBe(true);
  });
});

describe('checkToteSave', () => {
  it('saves a route with tote scanning off and no master without any message', () => {
    expect(checkToteSave({
      toteScanning: false, masterBookingId: null,
      initialMasterBookingId: null, initialMasterLabel: null,
    })).toEqual({ kind: 'ok' });
  });

  it('refuses tote scanning on with no master, with the exact message', () => {
    const r = checkToteSave({
      toteScanning: true, masterBookingId: null,
      initialMasterBookingId: null, initialMasterLabel: null,
    });
    expect(r).toEqual({ kind: 'refuse', message: 'Pick a master job, or turn tote scanning off.' });
    expect(TOTE_NEEDS_MASTER_MESSAGE).toBe('Pick a master job, or turn tote scanning off.');
  });

  it('refuses when the master was cleared but the switch was left on', () => {
    expect(checkToteSave({
      toteScanning: true, masterBookingId: null,
      initialMasterBookingId: 77, initialMasterLabel: 'P77 - Lab',
    }).kind).toBe('refuse');
  });

  it('saves an existing route with a master unchanged, no confirm', () => {
    expect(checkToteSave({
      toteScanning: true, masterBookingId: 77,
      initialMasterBookingId: 77, initialMasterLabel: 'P77 - Lab',
    })).toEqual({ kind: 'ok' });
  });

  it('asks before turning tote scanning off on a route that had a master, naming it', () => {
    expect(checkToteSave({
      toteScanning: false, masterBookingId: 77,
      initialMasterBookingId: 77, initialMasterLabel: 'P5372BIO - Burbank to Lab',
    })).toEqual({
      kind: 'confirm',
      message: 'Turning this off unbinds booking P5372BIO - Burbank to Lab from this route.',
    });
  });

  it('falls back to the booking id when the route has no label for its master', () => {
    const r = checkToteSave({
      toteScanning: false, masterBookingId: null,
      initialMasterBookingId: 77, initialMasterLabel: null,
    });
    expect(r).toEqual({ kind: 'confirm', message: 'Turning this off unbinds booking #77 from this route.' });
  });
});

describe('toteSavePayload', () => {
  it('sends the explicit clear (0) and no mode when tote scanning is off', () => {
    expect(toteSavePayload(false, 77, 2)).toEqual({ masterBookingId: 0, finalMileDeliveryMode: null });
    expect(toteSavePayload(false, null, 1)).toEqual({ masterBookingId: 0, finalMileDeliveryMode: null });
  });

  it('sends the master and its mode when tote scanning is on', () => {
    expect(toteSavePayload(true, 77, 2)).toEqual({ masterBookingId: 77, finalMileDeliveryMode: 2 });
  });
});

describe('switch on, master changed', () => {
  it('refuses clearing the master while the switch is still on', () => {
    // Why the picker help no longer says clearing unbinds the booking: with
    // the switch on, Clear + Save is refused, so nothing is unbound.
    const r = checkToteSave({ toteScanning: true, masterBookingId: null, initialMasterBookingId: 5372, initialMasterLabel: 'P5372BIO' });
    expect(r).toEqual({ kind: 'refuse', message: TOTE_NEEDS_MASTER_MESSAGE });
  });

  it('swaps to another master without a confirm (old master demoted silently, as on develop)', () => {
    expect(checkToteSave({ toteScanning: true, masterBookingId: 6000, initialMasterBookingId: 5372, initialMasterLabel: 'P5372BIO' }))
      .toEqual({ kind: 'ok' });
    expect(toteSavePayload(true, 6000, 2)).toEqual({ masterBookingId: 6000, finalMileDeliveryMode: 2 });
  });

  it('a route that never had a master still sends masterBookingId 0 with the switch off: same payload as develop', () => {
    expect(toteSavePayload(false, null, 1)).toEqual({ masterBookingId: 0, finalMileDeliveryMode: null });
  });
});
