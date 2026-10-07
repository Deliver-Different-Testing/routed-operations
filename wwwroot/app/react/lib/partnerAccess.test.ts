// The single source of truth for which surfaces a network partner may open,
// shared by Sidebar.tsx and App.tsx. Pure function, so this is the cheap kind
// of test the repo's testing policy asks for.
//
// The segment-aware matching is the part worth pinning: a bare startsWith
// would deny '/schedules-new' for being prefixed by '/schedules'.
//
// See NP-PAY-PART4-TODO.md T2 / T3 / D15.
import { describe, expect, it } from 'vitest';
import { PARTNER_DENIED_PATHS, isPartnerDeniedPath } from './partnerAccess';

describe('isPartnerDeniedPath', () => {
  it('denies every surface a partner would be refused anyway', () => {
    expect([...PARTNER_DENIED_PATHS].sort()).toEqual([
      '/auto-assign-log',
      '/bulk-import',
      '/client-overrides',
      '/driver-scheduling',
      '/polygon-builder',
      '/quoting',
      '/recurring-routes',
      '/routes',
      '/schedules',
      '/schedules-new',
    ]);
  });

  it('denies the Route Builder cockpit and Bulk Import', () => {
    expect(isPartnerDeniedPath('/routes')).toBe(true);
    expect(isPartnerDeniedPath('/bulk-import')).toBe(true);
  });

  it('denies paths underneath a denied surface', () => {
    expect(isPartnerDeniedPath('/routes/123')).toBe(true);
    expect(isPartnerDeniedPath('/bulk-import/review')).toBe(true);
  });

  it('keeps the partner lane open', () => {
    expect(isPartnerDeniedPath('/dashboard')).toBe(false);
    expect(isPartnerDeniedPath('/route-viewer')).toBe(false);
    expect(isPartnerDeniedPath('/route-viewer/linehaul')).toBe(false);
    expect(isPartnerDeniedPath('/route-viewer/mobile')).toBe(false);
  });

  it('denies quoting and the auto-assign log', () => {
    // Flipped 2026-10-07. These two loaded and worked for a partner under
    // D1 = B - quoting included, MarginPct and all - and the previous version
    // of this test pinned that, saying it should fail and force this list to
    // follow if the policy ever gained the NP check. Steve ruled on
    // 2026-10-06 that a partner is denied both, CanUsePlaceholderModule now
    // refuses them, so the list follows.
    // See NP-PAY-PART4-TODO.md D17.
    expect(isPartnerDeniedPath('/quoting')).toBe(true);
    expect(isPartnerDeniedPath('/auto-assign-log')).toBe(true);
  });

  it('denies the six that 403 under RouteBuilder.Read / .Admin', () => {
    for (const p of [
      '/schedules', '/schedules-new', '/recurring-routes',
      '/client-overrides', '/driver-scheduling', '/polygon-builder',
    ]) {
      expect(isPartnerDeniedPath(p)).toBe(true);
    }
  });

  it('does not deny a sibling path by prefix', () => {
    // '/routes' must not swallow a future '/routes-archive'.
    expect(isPartnerDeniedPath('/routes-archive')).toBe(false);
  });
});
