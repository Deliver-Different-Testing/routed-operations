import { describe, expect, it } from 'vitest';
import { copyMondayToOtherDays, tickMonToFri, type CopyableDay } from './copyMondayToDays';

// M12 / R1: the cut-off day is an ABSOLUTE weekday, so copying Monday's
// value verbatim would give every day Monday's cut-off (a Friday run closing
// on the previous Monday's day number). It has to move with the day.

type Day = CopyableDay & { id: number | null };

const off = (id: number | null = null): Day =>
  ({ id, enabled: false, startTime: '08:00', endTime: '17:00', cutoffDay: null, cutoffTime: '06:00' });
const on = (p: Partial<Day>, id: number | null = null): Day => ({ ...off(id), enabled: true, ...p });

describe('copyMondayToOtherDays', () => {
  it('copies the window and cut-off time onto the other ticked days only', () => {
    const days = [
      on({ startTime: '13:00', endTime: '20:00', cutoffDay: 1, cutoffTime: '11:00' }, 11),
      on({ startTime: '09:00' }, 12),
      off(13),
      on({}, 14),
      off(), off(), off(),
    ];

    const out = copyMondayToOtherDays(days);

    expect(out[1]).toMatchObject({ id: 12, enabled: true, startTime: '13:00', endTime: '20:00', cutoffTime: '11:00' });
    expect(out[3]).toMatchObject({ id: 14, startTime: '13:00', endTime: '20:00', cutoffTime: '11:00' });
    expect(out[2]).toBe(days[2]); // unticked Wednesday untouched
    expect(out[0]).toBe(days[0]);
  });

  it('shifts a same-day cut-off so each day stays same-day', () => {
    const days = [on({ cutoffDay: 1 }), on({}), on({}), on({}), on({}), off(), off()];
    expect(copyMondayToOtherDays(days).slice(0, 5).map((d) => d.cutoffDay)).toEqual([1, 2, 3, 4, 5]);
  });

  it('shifts a day-before cut-off and wraps round the week', () => {
    // Monday's run closes on Sunday (7). Tuesday's then closes Monday (1),
    // and Sunday's closes Saturday (6).
    const days = [on({ cutoffDay: 7 }), on({}), off(), off(), off(), off(), on({})];
    const out = copyMondayToOtherDays(days);
    expect(out[1].cutoffDay).toBe(1);
    expect(out[6].cutoffDay).toBe(6);
  });

  it('keeps a missing cut-off day missing rather than inventing one', () => {
    const days = [on({ cutoffDay: null }), on({ cutoffDay: 2 }), off(), off(), off(), off(), off()];
    expect(copyMondayToOtherDays(days)[1].cutoffDay).toBeNull();
  });

  it('does nothing when Monday is not ticked', () => {
    const days = [off(), on({ startTime: '09:00' }), off(), off(), off(), off(), off()];
    expect(copyMondayToOtherDays(days)).toBe(days);
  });
});

// F2 (Marcus, 16 Nov release): "Tick Mon to Fri" beside the copy button, so a
// schedule cut down to fewer days can be set back to the working week in one
// click before copying Monday across. It ticks the five weekdays the same way
// ticking each box by hand does, and touches nothing else.
describe('tickMonToFri', () => {
  it('ticks Monday to Friday and leaves the weekend as it was', () => {
    const sat = on({ startTime: '10:00' });
    const days = [on({ cutoffDay: 7 }), off(), off(), on({}), off(), sat, off()];
    const out = tickMonToFri(days);
    expect(out.map((d) => d.enabled)).toEqual([true, true, true, true, true, true, false]);
    expect(out[5]).toBe(sat);
    expect(out[6]).toBe(days[6]);
  });

  it('seeds a same-day cut-off on a newly ticked day, as ticking the box does', () => {
    const days = [off(), off(), off(), off(), off(), off(), off()];
    expect(tickMonToFri(days).slice(0, 5).map((d) => d.cutoffDay)).toEqual([1, 2, 3, 4, 5]);
  });

  it('leaves an already-ticked day, its window and its cut-off untouched', () => {
    const mon = on({ startTime: '13:00', cutoffDay: 7, cutoffTime: '11:00' }, 11);
    const wedOff = off(13);
    wedOff.cutoffDay = 4;
    const days = [mon, off(), wedOff, off(), off(), off(), off()];
    const out = tickMonToFri(days);
    expect(out[0]).toBe(mon);
    // An unticked day that already had a cut-off day keeps it.
    expect(out[2]).toMatchObject({ id: 13, enabled: true, cutoffDay: 4, startTime: '08:00' });
  });
});
