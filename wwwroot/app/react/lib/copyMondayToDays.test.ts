import { describe, expect, it } from 'vitest';
import { copyMondayToOtherDays, type CopyableDay } from './copyMondayToDays';

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
