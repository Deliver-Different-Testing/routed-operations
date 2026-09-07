import { useQuery } from '@tanstack/react-query';
import { routeViewerService } from '../../services/routeViewerService';
import { RvBox } from './RvBox';

// Region roll-up box (master Section 7.14). One row per region with
// REGION / TOTAL / SORT SCAN / RUN SCAN / PICKED UP / TODO columns. Row
// click narrows the parent's region filter to just that region so the
// operator can drill into a specific area. Auto-polled with the run
// list at 25s cadence (parent invalidates this query key).
//
// Fields sourced from the `RVW_stpRunOverview` SP (see
// RouteViewerRunService.GetRunRegionOverviewAsync). Matches legacy
// `RegionOverview` viewmodel: `class` drives the row's percent-bar
// colour ("green" / "orange" / "red"), Percent drives its width.

interface OverviewRow {
  regionId: number;
  region: string | null;
  total: number;
  sortScan: number;
  runScan: number;
  pickedUp: number;
  toDo: number;
  percent: number;
  class: string | null;
  active: boolean;
}

interface Props {
  runDate: string;
  onRegionPick?: (regionId: number) => void;
  /** Filter panel state. Forwarded to the SP so overview totals scope
   *  to the current Client / Region / Speed selection instead of
   *  showing tenant-wide numbers that disagree with the Run List below. */
  clientIds?: number[];
  regionIds?: number[];
  speedIds?: number[];
}

export function RvOverviewBox({ runDate, onRegionPick, clientIds, regionIds, speedIds }: Props) {
  const query = useQuery({
    // Filter values live in the key so a filter toggle refetches
    // instead of serving cached tenant-wide totals.
    queryKey: [
      'rv-overview', runDate,
      (clientIds ?? []).join(','),
      (regionIds ?? []).join(','),
      (speedIds ?? []).join(','),
    ],
    queryFn: () => routeViewerService.getRegionOverview(runDate, { clientIds, regionIds, speedIds }),
    enabled: !!runDate,
    staleTime: 5_000,
  });

  const rows = (query.data ?? []) as OverviewRow[];

  return (
    <RvBox title="Overview">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-surface-white border-b border-border">
          <tr className="text-left text-text-muted uppercase text-[10px]">
            <th className="px-2 py-1">Region</th>
            <th className="px-2 py-1">Total</th>
            <th className="px-2 py-1">Sort Scan</th>
            <th className="px-2 py-1">Run Scan</th>
            <th className="px-2 py-1">Picked Up</th>
            <th className="px-2 py-1 text-brand-orange">Todo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            // Legacy tints the row background with the .class colour
            // (green / orange / red) at Percent% width, giving each
            // region a mini progress bar. Match that by absolute-
            // positioning a coloured strip behind the cells.
            const barColour = r.class === 'green' ? 'bg-emerald-200'
              : r.class === 'orange' ? 'bg-amber-200'
              : r.class === 'red' ? 'bg-red-200'
              : 'bg-transparent';
            return (
              <tr
                key={r.regionId}
                className={`relative border-b border-border/50 ${
                  onRegionPick ? 'cursor-pointer hover:bg-surface-cream/60' : ''
                }`}
                onClick={onRegionPick ? () => onRegionPick(r.regionId) : undefined}
              >
                <td className="px-2 py-1 font-medium relative">
                  <div
                    className={`absolute inset-y-0 left-0 ${barColour} opacity-60 -z-10 pointer-events-none`}
                    style={{ width: `${Math.max(0, Math.min(100, Number(r.percent) || 0))}%` }}
                  />
                  {r.region ?? '-'}
                </td>
                <td className="px-2 py-1">{r.total}</td>
                <td className="px-2 py-1">{r.sortScan}</td>
                <td className="px-2 py-1">{r.runScan}</td>
                <td className="px-2 py-1">{r.pickedUp}</td>
                <td className="px-2 py-1 text-brand-orange font-medium">{r.toDo}</td>
              </tr>
            );
          })}
          {rows.length === 0 && !query.isLoading && (
            <tr>
              <td className="px-3 py-4 text-center text-text-muted" colSpan={6}>
                No regions with jobs for this date.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </RvBox>
  );
}
