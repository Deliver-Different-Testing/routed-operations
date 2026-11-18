// Schedules list in the route editor, filtered by the route's coverage
// (final-mile route setup spec 4.3). The server says which schedules share a
// postcode with the route (POST schedules/coverage-match); this module only
// decides what the list shows, in what order, and with what label, so the
// rules can be tested without rendering the editor.

import type { CoverageMatchResponse, ScheduleLookup } from '../services/recurringRouteService';

export interface ScheduleListItem {
  schedule: ScheduleLookup;
  /** Second-line overlap text, e.g. "12 of 40 postcodes" or "Whole depot".
   *  Null when the coverage filter is not applied. */
  overlapLabel: string | null;
  /** Ticked but sharing no postcode with the route: the amber tag. */
  noOverlap: boolean;
}

/** Today's text filter: schedule name or any client code. */
export function matchesText(s: ScheduleLookup, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (!needle) return true;
  return s.name.toLowerCase().includes(needle)
    || s.clientCodes.some((c) => c.toLowerCase().includes(needle));
}

/**
 * Header ids the route has ticked. The editor stores DAY-ROW ids, and a
 * route saved before the lookup collapsed to one row per header can hold a
 * day row other than the one the lookup lists, so the header is taken from
 * the route's own schedules as well as from the lookup.
 */
export function tickedHeaderIds(
  scheduleIds: ReadonlySet<number>,
  lookup: readonly ScheduleLookup[],
  initialSchedules: readonly { scheduleId: number; headerId?: number | null }[],
): Set<number> {
  const out = new Set<number>();
  for (const s of lookup) if (scheduleIds.has(s.id)) out.add(s.headerId);
  for (const s of initialSchedules) {
    if (s.headerId != null && scheduleIds.has(s.scheduleId)) out.add(s.headerId);
  }
  return out;
}

export function overlapLabel(matchedCount: number, depotWide: boolean, routePostcodeCount: number): string {
  if (depotWide) return 'Whole depot';
  return `${matchedCount} of ${routePostcodeCount} postcode${routePostcodeCount === 1 ? '' : 's'}`;
}

/**
 * The list to render.
 *
 * `match` null means the filter is not applied (off, not offered, no
 * coverage, not loaded yet, or the endpoint failed): the list is exactly
 * today's, lookup order, text filter only.
 *
 * Applied: matched schedules sorted by matchedCount desc, then name; plus any
 * ticked schedule with no overlap, kept with the amber tag at the end, never
 * dropped (nothing is unticked automatically). Matching is by HEADER id. The
 * text filter applies on top in both cases.
 */
export function buildScheduleList(
  lookup: readonly ScheduleLookup[],
  text: string,
  match: CoverageMatchResponse | null,
  ticked: ReadonlySet<number>,
): ScheduleListItem[] {
  const shown = lookup.filter((s) => matchesText(s, text));
  if (!match) return shown.map((schedule) => ({ schedule, overlapLabel: null, noOverlap: false }));

  const byHeader = new Map(match.rows.map((r) => [r.headerId, r]));
  const items: (ScheduleListItem & { count: number })[] = [];
  for (const schedule of shown) {
    const row = byHeader.get(schedule.headerId);
    if (row && row.matchedCount > 0) {
      items.push({
        schedule,
        count: row.matchedCount,
        overlapLabel: overlapLabel(row.matchedCount, row.depotWide, match.routePostcodeCount),
        noOverlap: false,
      });
    } else if (ticked.has(schedule.headerId)) {
      // TODO(fmr-Q4): only ticked schedules the lookup still lists are kept
      // here. A ticked schedule whose header is retired is not in the lookup,
      // so it is not shown (today's lookup behaviour). Whether it should be
      // shown is open with Steve; keep today's behaviour until he answers.
      items.push({ schedule, count: 0, overlapLabel: null, noOverlap: true });
    }
  }
  items.sort((a, b) => b.count - a.count || a.schedule.name.localeCompare(b.schedule.name));
  return items.map(({ count: _count, ...item }) => item);
}
