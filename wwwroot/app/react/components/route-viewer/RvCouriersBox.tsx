import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { routeViewerService } from '../../services/routeViewerService';
import { RvBox } from './RvBox';

// Route Viewer Couriers box (master Section 7.15). Two-step picker
// mirroring the legacy potentialCourierFleets -> potentialCouriers
// drill-down: the default view lists Fleets (grouped from the
// courier feed) and clicking a fleet drills into that fleet's
// couriers. A small back affordance returns to the Fleets list.
//
// Data source: RVW_stpActiveCouriers via /api/runviewer/couriers
// (the same endpoint used previously; the legacy AngularJS UI also
// derived fleets client-side by grouping on the `fleet` field).
// Auto-poll cadence matches the Run List (25 s).

export interface CourierListRow {
  courierId: number;
  code: string;
  name: string;
  fleet?: string;
  activeJobs?: number;
  isAvailable?: boolean;
  vehicleType?: string;
}

interface FleetGroup {
  name: string;
  couriers: CourierListRow[];
}

interface Props {
  runDate: string;
  /** Fires when a courier row is clicked. Passes the full row so the
   *  parent can (a) narrow the Run List by courierId and (b) render
   *  the courier-location map overlay in the JobDetail pane. */
  onPick?: (courier: CourierListRow) => void;
  /** When true, hide couriers whose isAvailable flag is false. Sourced
   *  from the "Available Couriers Only" checkbox on RvFilterBar
   *  (legacy pickDate.tpl `onlyAvailableCouriers`). Filter is
   *  client-side against the loaded courier feed. */
  availableOnly?: boolean;
}

const UNASSIGNED_FLEET_LABEL = 'Unassigned';

export function RvCouriersBox({ runDate, onPick, availableOnly }: Props) {
  const q = useQuery({
    queryKey: ['rv-couriers-box', runDate],
    queryFn: () => routeViewerService.getActiveCouriers(runDate),
    enabled: !!runDate,
    staleTime: 25_000,
  });

  const allRows = (q.data ?? []) as CourierListRow[];
  const rows = availableOnly ? allRows.filter((c) => c.isAvailable === true) : allRows;

  // Group couriers by fleet name (legacy: Object.keys(groups).map).
  // Couriers with no fleet get bucketed under a stable Unassigned
  // label so operators can still find them in the drill-down.
  const fleets = useMemo<FleetGroup[]>(() => {
    const bucket: Record<string, CourierListRow[]> = {};
    for (const c of rows) {
      const key = c.fleet && c.fleet.trim().length > 0 ? c.fleet : UNASSIGNED_FLEET_LABEL;
      (bucket[key] ??= []).push(c);
    }
    return Object.keys(bucket)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, couriers: bucket[name] }));
  }, [rows]);

  const [selectedFleet, setSelectedFleet] = useState<string | null>(null);

  // If the poll refreshes and the previously-selected fleet has no
  // couriers left, drop back to the Fleets list rather than showing
  // a dead subtitle. (Rare, but happens when a fleet's only courier
  // clocks off mid-shift.)
  const activeFleet = selectedFleet && fleets.some((f) => f.name === selectedFleet)
    ? selectedFleet
    : null;

  const fleetCouriers = activeFleet
    ? (fleets.find((f) => f.name === activeFleet)?.couriers ?? [])
    : [];

  const title = activeFleet ? `Couriers for ${activeFleet}` : 'Fleets';

  const backAction = activeFleet ? (
    <button
      type="button"
      className="text-xs text-brand-cyan hover:underline"
      onClick={() => setSelectedFleet(null)}
      title="Back to Fleets"
    >
      {'← Back to Fleets'}
    </button>
  ) : undefined;

  return (
    <RvBox title={title} actions={backAction}>
      {!activeFleet && (
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface-white border-b border-border">
            <tr className="text-left text-text-muted">
              <th className="px-2 py-1">Fleet Name</th>
              <th className="px-2 py-1 text-right pr-3">Couriers</th>
            </tr>
          </thead>
          <tbody>
            {fleets.map((f) => (
              <tr
                key={f.name}
                onClick={() => setSelectedFleet(f.name)}
                className="border-b border-border/50 cursor-pointer hover:bg-surface-cream/60"
                title="Click to view couriers in this fleet"
              >
                <td className="px-2 py-1 truncate">{f.name}</td>
                <td className="px-2 py-1 text-right pr-3">{f.couriers.length}</td>
              </tr>
            ))}
            {fleets.length === 0 && !q.isLoading && (
              <tr>
                <td className="px-3 py-4 text-center text-text-muted" colSpan={2}>
                  No active couriers for this date.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {activeFleet && (
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface-white border-b border-border">
            <tr className="text-left text-text-muted">
              <th className="px-2 py-1 w-4"></th>
              <th className="px-2 py-1">Code</th>
              <th className="px-2 py-1">Name</th>
              <th className="px-2 py-1">Vehicle</th>
              <th className="px-2 py-1">Jobs</th>
            </tr>
          </thead>
          <tbody>
            {fleetCouriers.map((c) => {
              // Highlight low-load couriers per legacy (<=3 active jobs)
              // so operators can pick a spare-capacity driver quickly.
              const lightLoad = (c.activeJobs ?? 0) <= 3;
              return (
                <tr
                  key={c.courierId}
                  draggable
                  onDragStart={(e) => {
                    // Native HTML5 drag payload. RvRunList's drop
                    // handler reads the courierCode + courierId to
                    // hit /runviewer/jobs/preassign-run. Keep the
                    // payload primitive so no serialisation quirks
                    // with objects.
                    e.dataTransfer.setData('application/rv-courier-code', c.code);
                    e.dataTransfer.setData('application/rv-courier-id', String(c.courierId));
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={onPick ? () => onPick(c) : undefined}
                  className={`border-b border-border/50 ${
                    onPick ? 'cursor-pointer hover:bg-surface-cream/60' : ''
                  } ${lightLoad ? 'bg-brand-cyan/5' : ''}`}
                  title="Drag onto a run in the Run List to pre-assign"
                >
                  <td className="px-2 py-1">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${
                        c.isAvailable ? 'bg-emerald-500' : 'bg-slate-300'
                      }`}
                      title={c.isAvailable ? 'Available' : 'Offline'}
                    />
                  </td>
                  <td className="px-2 py-1 font-mono">{c.code}</td>
                  <td className="px-2 py-1 truncate max-w-[10rem]">{c.name}</td>
                  <td className="px-2 py-1 text-text-muted truncate max-w-[8rem]">
                    {c.vehicleType ?? '-'}
                  </td>
                  <td className="px-2 py-1 text-right pr-3">{c.activeJobs ?? 0}</td>
                </tr>
              );
            })}
            {fleetCouriers.length === 0 && !q.isLoading && (
              <tr>
                <td className="px-3 py-4 text-center text-text-muted" colSpan={5}>
                  No couriers in this fleet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </RvBox>
  );
}
