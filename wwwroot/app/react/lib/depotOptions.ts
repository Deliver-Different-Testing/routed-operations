// Depot select rules, shared by every edit form that offers a depot.
//
// The depot lists come back with inactive depots included (so a record that
// already sits on one can still name it). An edit select hides them, except
// the one that is the current value, which shows with an "(inactive)" suffix
// so the operator can see why it is there. Saving while any depot field still
// holds an inactive depot is blocked in the UI. Filters are different: they
// show every depot, inactive ones marked, because old data still lives on them.

export interface DepotLike {
  id: number;
  name: string | null;
  /** Missing reads as active, so a list without the flag behaves as before. */
  active?: boolean;
}

export interface DepotOption {
  id: number;
  label: string;
  inactive: boolean;
}

export const INACTIVE_DEPOT_MESSAGE = 'This depot is inactive and cannot be saved. Pick an active depot.';

/** Client override save: the depot lives on the base schedule, so name that as the fix. */
export const INACTIVE_DEPOT_OVERRIDE_MESSAGE =
  'The base schedule uses an inactive depot, so this override cannot be saved. Change the depot on the base schedule first.';

const isInactive = (d: DepotLike) => d.active === false;

const label = (d: DepotLike) => {
  const name = d.name ?? `#${d.id}`;
  return isInactive(d) ? `${name} (inactive)` : name;
};

/** Options for an edit select: active depots, plus the current value when it is inactive. */
export function depotOptions(depots: DepotLike[], currentId: number | null | undefined): DepotOption[] {
  return depots
    .filter((d) => !isInactive(d) || d.id === currentId)
    .map((d) => ({ id: d.id, label: label(d), inactive: isInactive(d) }));
}

/** Options for a filter: every depot, inactive ones marked. */
export function depotFilterOptions(depots: DepotLike[]): DepotOption[] {
  return depots.map((d) => ({ id: d.id, label: label(d), inactive: isInactive(d) }));
}

/** True when any of the given depot ids is an inactive depot. Use to block save. */
export function hasInactiveDepot(depots: DepotLike[], ids: Array<number | null | undefined>): boolean {
  const inactive = new Set(depots.filter(isInactive).map((d) => d.id));
  return ids.some((id) => id != null && inactive.has(id));
}
