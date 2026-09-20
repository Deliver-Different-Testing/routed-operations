// Rules for id-keyed client links: attach, detach, overrides, groups, and the resolution rule.
import { describe, it, expect } from 'vitest';
import { createEmptySchedule, getClientIds, getVisibility, isOverrideOf, type Schedule } from '../types';
import {
  attachBlocker,
  attachClientsToGroup,
  baseOf,
  clientsViaSchedules,
  effectiveSchedulesForClient,
  overridesOf,
  overrideForClient,
  upsertOverride,
  withClientDetached,
  withClientsAttached,
  withVisibility,
} from './clientLinks';

function make(id: number, over: Partial<Schedule> = {}): Schedule {
  return { ...createEmptySchedule(), id, rowIds: [], name: `S${id}`, ...over } as Schedule;
}

const DEFAULT = make(1, { name: 'Evening Home', visibility: 'all', clientIds: [] });
const SHARED = make(10, { name: 'CHCH pre 8am', visibility: 'specific', clientIds: [100, 101, 102] });
const OVERRIDE = make(11, {
  name: 'CHCH pre 8am', visibility: 'specific', clientIds: [103], isOverride: true, baseScheduleId: 10,
});
const DEFAULT_WITH_OVERRIDE = make(20, { name: 'Hamilton > BOP', visibility: 'all', clientIds: [] });
const OVERRIDE_OF_DEFAULT = make(21, {
  name: 'Hamilton > BOP', visibility: 'specific', clientIds: [100], isOverride: true, baseScheduleId: 20,
});
const ALL = [DEFAULT, SHARED, OVERRIDE, DEFAULT_WITH_OVERRIDE, OVERRIDE_OF_DEFAULT];

describe('overrides link by ScheduleId, not name', () => {
  it('nests an override under its base by baseScheduleId', () => {
    expect(isOverrideOf(OVERRIDE, SHARED)).toBe(true);
    expect(overridesOf(ALL, SHARED).map((s) => s.id)).toEqual([11]);
    expect(baseOf(ALL, OVERRIDE)?.id).toBe(10);
  });

  it('does not attach an override to a same-named schedule with a different id', () => {
    const impostor = make(99, { name: 'CHCH pre 8am' });
    expect(isOverrideOf(OVERRIDE, impostor)).toBe(false);
  });

  it('falls back to name matching only for legacy overrides without baseScheduleId', () => {
    const legacy = make(12, { name: 'X', isOverride: true, baseScheduleName: 'CHCH pre 8am', clientIds: [104] });
    expect(isOverrideOf(legacy, SHARED)).toBe(true);
  });
});

describe('resolution rule: own override › shared › default', () => {
  it('a client with nothing of its own sees only defaults', () => {
    const eff = effectiveSchedulesForClient(ALL, 999);
    expect(eff.map((e) => [e.schedule.id, e.source])).toEqual([[1, 'default'], [20, 'default']]);
  });

  it('a client linked to a shared schedule sees it plus defaults', () => {
    const eff = effectiveSchedulesForClient(ALL, 101);
    expect(eff.map((e) => e.schedule.id).sort()).toEqual([1, 10, 20]);
    expect(eff.find((e) => e.schedule.id === 10)?.source).toBe('shared');
  });

  it('a client on an override sees the override and not the base it overrides', () => {
    const eff = effectiveSchedulesForClient(ALL, 103);
    expect(eff.map((e) => e.schedule.id).sort()).toEqual([1, 11, 20]);
    expect(eff.find((e) => e.schedule.id === 11)?.source).toBe('override');
  });

  it('an override of a default replaces that default for its client only', () => {
    const c100 = effectiveSchedulesForClient(ALL, 100).map((e) => e.schedule.id).sort();
    expect(c100).toEqual([1, 10, 21]); // 20 is hidden behind 21 for client 100
    const c101 = effectiveSchedulesForClient(ALL, 101).map((e) => e.schedule.id).sort();
    expect(c101).toContain(20); // other clients still get the default
  });
});

describe('attach / detach / visibility', () => {
  it('attaching writes link rows and switches a default to specific', () => {
    const s = withClientsAttached(DEFAULT, [5, 6]);
    expect(getVisibility(s)).toBe('specific');
    expect(getClientIds(s)).toEqual([5, 6]);
    expect(s.clientId).toBe(5); // legacy column kept in step for the old view
  });

  it('attaching is idempotent per client', () => {
    expect(getClientIds(withClientsAttached(SHARED, [101, 200]))).toEqual([100, 101, 102, 200]);
  });

  it('detaching removes exactly one link row', () => {
    expect(getClientIds(withClientDetached(SHARED, 101))).toEqual([100, 102]);
  });

  it('making a schedule a default clears its link rows', () => {
    const s = withVisibility(SHARED, 'all');
    expect(getVisibility(s)).toBe('all');
    expect(getClientIds(s)).toEqual([]);
    expect(s.clientId).toBeNull();
  });

  it('blocks attaching a client that is already attached or has its own override', () => {
    expect(attachBlocker(ALL, SHARED, 100)).toBe('already attached');
    expect(attachBlocker(ALL, SHARED, 103)).toBe('has own override #11');
    expect(attachBlocker(ALL, SHARED, 500)).toBeNull();
  });
});

describe('a client is never on both a base and its override', () => {
  it('saving an override moves the client off the base', () => {
    const newOverride = make(12, { name: 'CHCH pre 8am', visibility: 'specific', clientIds: [101], isOverride: true, baseScheduleId: 10 });
    const next = upsertOverride(ALL, newOverride);
    const base = next.find((s) => s.id === 10)!;
    expect(getClientIds(base)).toEqual([100, 102]);
    expect(next.some((s) => s.id === 12)).toBe(true);
    expect(overrideForClient(next, base, 101)?.id).toBe(12);
  });
});

describe('groups', () => {
  it('attaches to every non-default member and skips defaults and overrides', () => {
    const { schedules, written } = attachClientsToGroup(ALL, [1, 10, 11], [300, 100]);
    expect(written).toBe(1); // only 300 on #10 is new; #1 is a default, #11 an override
    expect(getClientIds(schedules.find((s) => s.id === 10)!)).toEqual([100, 101, 102, 300]);
    expect(getClientIds(schedules.find((s) => s.id === 1)!)).toEqual([]);
    expect(getClientIds(schedules.find((s) => s.id === 11)!)).toEqual([103]);
  });

  it('clients reached through schedules include their overrides', () => {
    const via = clientsViaSchedules(ALL, [10]);
    expect(via.all).toBe(false);
    expect(via.clientIds.sort()).toEqual([100, 101, 102, 103]);
    expect(clientsViaSchedules(ALL, [1]).all).toBe(true);
  });
});
