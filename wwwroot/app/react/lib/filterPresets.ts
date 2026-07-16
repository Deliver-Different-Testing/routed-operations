import type { JobFilters } from '../types';

/**
 * Saved filter presets - Plan §Phase 3 §7 (`RunBuilderFilterService`).
 *
 * The Plan pins this at the end of Stage 1 with the note that it "improves
 * operator speed but does not create core capability". Server-side per-user
 * storage would add a whole auth-gated table + endpoints. For a small
 * operator base, localStorage covers the primary need (recall my usual
 * region + speed + client combo without re-picking them every morning).
 *
 * Follow-up if requested by ops: promote to a per-user backend table with the
 * same shape. All UI + call sites read/write via this module, so the swap is
 * one-file when the time comes.
 */

const KEY = 'RoutedOps_filterPresets';

export interface FilterPreset {
  name: string;
  filters: JobFilters;
}

export function loadFilterPresets(): FilterPreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FilterPreset[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveFilterPresets(presets: FilterPreset[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(presets));
  } catch { /* quota / private mode - non-fatal */ }
}

export function upsertFilterPreset(existing: FilterPreset[], next: FilterPreset): FilterPreset[] {
  const idx = existing.findIndex((p) => p.name === next.name);
  if (idx < 0) return [...existing, next];
  const copy = existing.slice();
  copy[idx] = next;
  return copy;
}

export function deleteFilterPreset(existing: FilterPreset[], name: string): FilterPreset[] {
  return existing.filter((p) => p.name !== name);
}
