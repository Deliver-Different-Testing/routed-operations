// src/modules/schedules/utils/clientLinks.ts
//
// Routed Operations: one schedule, many clients.
// A schedule is identified by its ScheduleId (`Schedule.id`), clients are attached through link rows
// (`Schedule.clientIds`), and an override points at its base by `baseScheduleId`.
// These helpers are the single place the rules live; components call them and never
// touch `clientIds` directly. See docs/KEVIN-NEW-SCHEDULES-VIEW-MULTI-CLIENT-2026-09-08.md §4/§5.

import type { Schedule, ClientReference } from '../types';
import { getClientIds, getVisibility, isOverrideOf } from '../types';

export type ScheduleSource = 'override' | 'shared' | 'default';

export interface EffectiveSchedule {
  schedule: Schedule;
  source: ScheduleSource;
}

/** Overrides of a base schedule (by ScheduleId, legacy name fallback). */
export function overridesOf(schedules: Schedule[], base: Schedule): Schedule[] {
  return schedules.filter((s) => s.isOverride && isOverrideOf(s, base));
}

/** The base of an override, or null. */
export function baseOf(schedules: Schedule[], override: Schedule): Schedule | null {
  if (!override.isOverride) return null;
  if (override.baseScheduleId != null) {
    return schedules.find((s) => s.id === override.baseScheduleId) ?? null;
  }
  return schedules.find((s) => !s.isOverride && s.name === override.baseScheduleName) ?? null;
}

/** The override of `base` that carries `clientId`, if any. */
export function overrideForClient(schedules: Schedule[], base: Schedule, clientId: number): Schedule | null {
  return overridesOf(schedules, base).find((o) => getClientIds(o).includes(clientId)) ?? null;
}

/**
 * Resolution rule (mirrors the SQL in the brief): a client's schedules are
 *   1. overrides it is linked to,
 *   2. shared schedules it is linked to,
 *   3. defaults — except a default it has an override of.
 */
export function effectiveSchedulesForClient(schedules: Schedule[], clientId: number): EffectiveSchedule[] {
  const own = schedules.filter((s) => getVisibility(s) === 'specific' && getClientIds(s).includes(clientId));
  const overriddenBaseIds = new Set(
    own
      .filter((s) => s.isOverride)
      .map((s) => baseOf(schedules, s)?.id)
      .filter((id): id is number => id != null),
  );
  const out: EffectiveSchedule[] = own
    .filter((s) => !overriddenBaseIds.has(s.id))
    .map((s) => ({ schedule: s, source: s.isOverride ? 'override' : 'shared' }));
  schedules
    .filter((s) => getVisibility(s) === 'all' && !overriddenBaseIds.has(s.id))
    .forEach((s) => out.push({ schedule: s, source: 'default' }));
  return out;
}

/** Why a client cannot be attached to `schedule` right now, or null when it can. */
export function attachBlocker(schedules: Schedule[], schedule: Schedule, clientId: number): string | null {
  if (getClientIds(schedule).includes(clientId)) return 'already attached';
  if (!schedule.isOverride) {
    const ov = overrideForClient(schedules, schedule, clientId);
    if (ov) return `has own override #${ov.id}`;
  } else {
    const base = baseOf(schedules, schedule);
    if (base && getClientIds(base).includes(clientId)) return 'on the base — will move to this override';
  }
  return null;
}

/** Attach clients (link rows). Switches a default to specific. */
export function withClientsAttached(schedule: Schedule, clientIds: number[]): Schedule {
  const next = Array.from(new Set([...getClientIds(schedule), ...clientIds]));
  return { ...schedule, visibility: 'specific', clientIds: next, clientId: next[0] ?? null };
}

/** Remove one link row. */
export function withClientDetached(schedule: Schedule, clientId: number): Schedule {
  const next = getClientIds(schedule).filter((id) => id !== clientId);
  return { ...schedule, clientIds: next, clientId: next[0] ?? null };
}

/** Make a schedule a default (no link rows) or specific. */
export function withVisibility(schedule: Schedule, visibility: 'all' | 'specific'): Schedule {
  if (visibility === 'all') return { ...schedule, visibility, clientIds: [], clientId: null };
  return { ...schedule, visibility, clientIds: getClientIds(schedule) };
}

/**
 * Apply an override save to the list: the override's clients are removed from the base's
 * link rows (a client is never on both), and the override itself is upserted.
 */
export function upsertOverride(schedules: Schedule[], override: Schedule): Schedule[] {
  const base = baseOf(schedules, override);
  const clients = getClientIds(override);
  const next = schedules.map((s) => {
    if (base && s.id === base.id) {
      const remaining = getClientIds(s).filter((id) => !clients.includes(id));
      return { ...s, clientIds: remaining, clientId: remaining[0] ?? null };
    }
    return s.id === override.id ? override : s;
  });
  return next.some((s) => s.id === override.id) ? next : [...next, override];
}

/** Attach clients to every non-default member of a group. Returns the count of link rows written. */
export function attachClientsToGroup(
  schedules: Schedule[],
  memberIds: number[],
  clientIds: number[],
): { schedules: Schedule[]; written: number } {
  let written = 0;
  const next = schedules.map((s) => {
    if (!memberIds.includes(s.id) || getVisibility(s) === 'all' || s.isOverride) return s;
    const before = getClientIds(s).length;
    const updated = withClientsAttached(s, clientIds);
    written += getClientIds(updated).length - before;
    return updated;
  });
  return { schedules: next, written };
}

/** Clients reached through a set of schedules (their links plus their overrides' links). */
export function clientsViaSchedules(
  schedules: Schedule[],
  scheduleIds: number[],
): { all: boolean; clientIds: number[] } {
  let all = false;
  const set = new Set<number>();
  scheduleIds.forEach((id) => {
    const s = schedules.find((x) => x.id === id);
    if (!s) return;
    if (getVisibility(s) === 'all') all = true;
    getClientIds(s).forEach((c) => set.add(c));
    overridesOf(schedules, s).forEach((o) => getClientIds(o).forEach((c) => set.add(c)));
  });
  return { all, clientIds: Array.from(set) };
}

/** Short display for a client id. */
export function clientLabel(clients: ClientReference[], id: number): string {
  const c = clients.find((x) => x.id === id);
  return c?.shortName || c?.name || String(id);
}
