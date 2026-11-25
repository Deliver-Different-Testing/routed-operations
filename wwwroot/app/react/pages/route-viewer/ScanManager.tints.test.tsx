import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import { FragmentRow, chipTint, legTint, stageTint } from './ScanManager';

// #897: Scan Manager routed chips all rendered grey. RVW_stpScanJobsRouted
// (Legs JSON State) and RVW_stpScanManagerItemProgress (State) emit
// lowercase completed | exception | picked | packed | pending, and the
// Stage column text is one of:
//   'Completed', '<Leg> - completed', '<Leg> - exception',
//   '<Leg> - in transit', 'DEL - out for delivery',
//   '<Leg> - staged at depot', 'Awaiting <Leg> pickup'.
// Colour rule (spec F, #897): completed green, picked / packed amber,
// exception red, pending grey. If the procs ever change their wording
// these tests fail before operators see a wall of grey again.
// Round 2 (ruling 18 Nov): "Awaiting <Leg> pickup" is blue, the same blue
// as the Accepted job status pill (RunViewer.tsx jobStatusClass 'A',
// legacy udispatch.less .status.A). The proc emits that Stage when the
// current leg is pending, so a pending chip on the current leg is blue too.

const GREEN = 'bg-emerald-100';
const AMBER = 'bg-amber-100';
const RED = 'bg-red-100';
const GREY = 'bg-slate-100';
const AWAITING_BLUE = 'bg-blue-200 text-blue-900';

describe('legTint maps the states the procs really emit', () => {
  it.each([
    ['completed', GREEN],
    ['exception', RED],
    ['picked', AMBER],
    ['packed', AMBER],
    ['pending', GREY],
  ])('%s -> %s', (state, tone) => {
    expect(legTint(state)).toContain(tone);
  });

  it('falls back to grey for an empty or unknown state', () => {
    expect(legTint(null)).toContain(GREY);
    expect(legTint('something-new')).toContain(GREY);
  });
});

describe('stageTint maps the Stage texts the proc really emits', () => {
  it.each([
    ['Completed', GREEN],
    ['LH2 - completed', GREEN],
    ['LH1 - exception', RED],
    ['LH1 - in transit', AMBER],
    ['DEL - out for delivery', AMBER],
    ['LH3 - staged at depot', AMBER],
    ['Awaiting LHP pickup', AWAITING_BLUE],
    ['Awaiting DEL pickup', AWAITING_BLUE],
  ])('%s -> %s', (stage, tone) => {
    expect(stageTint(stage)).toContain(tone);
  });

  it('keeps short / missing wording red', () => {
    expect(stageTint('Item -3 short (LH1)')).toContain(RED);
  });
});

describe('chipTint: a pending chip on the current leg is Awaiting blue', () => {
  it('pending + current -> the Accepted job blue', () => {
    expect(chipTint('pending', true)).toBe(AWAITING_BLUE);
  });

  it('pending on a later leg stays grey; other states keep their tone when current', () => {
    expect(chipTint('pending', false)).toContain(GREY);
    expect(chipTint('completed', true)).toContain(GREEN);
    expect(chipTint('picked', true)).toContain(AMBER);
    expect(chipTint('exception', true)).toContain(RED);
  });
});

describe('routed row leg chips', () => {
  it('rings the chip of the CurrentLeg the proc reports, and only that one', () => {
    const row = { jobId: 1, jobNumber: 'P1', currentLeg: 'LH2', stage: 'LH2 - in transit', scannedItems: 0, expectedItems: 1 };
    const legs = [
      { Leg: 'LHP', State: 'completed' },
      { Leg: 'LH1', State: 'completed' },
      { Leg: 'LH2', State: 'picked' },
      { Leg: 'DEL', State: 'pending' },
    ];
    renderWithProviders(
      <table><tbody>
        <FragmentRow
          row={row}
          legs={legs}
          active={false}
          expanded={false}
          onSelect={() => {}}
          onToggle={() => {}}
          onContextMenu={() => {}}
        />
      </tbody></table>,
    );
    // Chips carry a "<Leg>: <state>" title; select on that so the test
    // does not depend on markup added by the fix.
    const chip = (label: string) => screen.getByTitle(new RegExp(`^${label}: `));
    expect(chip('LH2').className).toContain('ring-brand-cyan');
    expect(chip('LH2').className).toContain(AMBER);
    expect(chip('LHP').className).not.toContain('ring-brand-cyan');
    expect(chip('LHP').className).toContain(GREEN);
    expect(chip('DEL').className).not.toContain('ring-brand-cyan');
    expect(chip('DEL').className).toContain(GREY);
  });

  it('an Awaiting row shows the stage pill and the current leg chip in Awaiting blue', () => {
    const row = { jobId: 2, jobNumber: 'P2', currentLeg: 'LHP', stage: 'Awaiting LHP pickup', scannedItems: 0, expectedItems: 1 };
    const legs = [
      { Leg: 'LHP', State: 'pending' },
      { Leg: 'DEL', State: 'pending' },
    ];
    renderWithProviders(
      <table><tbody>
        <FragmentRow
          row={row}
          legs={legs}
          active={false}
          expanded={false}
          onSelect={() => {}}
          onToggle={() => {}}
          onContextMenu={() => {}}
        />
      </tbody></table>,
    );
    expect(screen.getByText('Awaiting LHP pickup').className).toContain(AWAITING_BLUE);
    const chip = (label: string) => screen.getByTitle(new RegExp(`^${label}: `));
    expect(chip('LHP').className).toContain(AWAITING_BLUE);
    expect(chip('DEL').className).toContain(GREY);
    expect(chip('DEL').className).not.toContain('bg-blue-200');
  });
});
