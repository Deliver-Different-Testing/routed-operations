// Route Viewer Region filter options. Reuses the rule from Location
// pickers, inactive depots (lib/depotOptions.ts), so regions and depots
// behave the same way. A region is a tblBulkRegion row:
//
// - "Active regions only" ticked: inactive regions are hidden, except the
//   one already selected, which stays with an "(inactive)" suffix so a
//   stored selection still shows and can be cleared.
// - Unticked: every region, inactive ones marked "(inactive)".
//
// A region without the `active` flag counts as active.

import type { SingleSelectOption } from '../components/common/SingleSelect';
import type { RegionLookup } from '../services/routeViewerService';
import { depotFilterOptions, depotOptions } from './depotOptions';

export function regionFilterOptions(
  regions: RegionLookup[],
  activeOnly: boolean,
  selectedId: number | null | undefined,
): SingleSelectOption[] {
  const asDepots = regions.map((r) => ({ id: r.id, name: r.label, active: r.active }));
  const options = activeOnly ? depotOptions(asDepots, selectedId) : depotFilterOptions(asDepots);
  return options.map((o) => ({ value: String(o.id), label: o.label }));
}
