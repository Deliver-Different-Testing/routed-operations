/**
 * Cockpit panel layout persistence. Each layout captures the current sizes
 * of every horizontal + vertical panel group in the cockpit so operators
 * can save and restore custom arrangements (e.g. "Full-screen map" vs
 * "Detail focus" vs "Route Building").
 *
 * Stored in localStorage as JSON. Frontend-only for now - Layout persistence
 * on a server would need per-user storage and an auth call for every
 * save/load; for a small operator base, localStorage is enough.
 */

const KEY = 'RoutedOps_layouts';

export interface CockpitLayout {
  name: string;
  // Sizes as percentages summing to 100 within each panel group. The default
  // layout mirrors CockpitPage's initial defaults.
  horizontal: number[];       // [Left, RunColumn, Fleets, Map]
  leftVertical: number[];     // [GroupedJobs, JobsList, JobDetail]
  runVertical: number[];      // [RunList, RunBuilder]
}

export const DEFAULT_LAYOUT: CockpitLayout = {
  name: 'Default',
  horizontal: [28, 26, 14, 32],
  leftVertical: [25, 45, 30],
  runVertical: [50, 50],
};

export function loadLayouts(): CockpitLayout[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CockpitLayout[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLayouts(layouts: CockpitLayout[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(layouts));
  } catch { /* quota / private mode - non-fatal */ }
}

export function upsertLayout(existing: CockpitLayout[], next: CockpitLayout): CockpitLayout[] {
  const idx = existing.findIndex((l) => l.name === next.name);
  if (idx < 0) return [...existing, next];
  const copy = existing.slice();
  copy[idx] = next;
  return copy;
}

export function deleteLayout(existing: CockpitLayout[], name: string): CockpitLayout[] {
  return existing.filter((l) => l.name !== name);
}
