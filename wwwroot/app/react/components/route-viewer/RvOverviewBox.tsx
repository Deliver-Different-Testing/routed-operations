import { useQuery } from '@tanstack/react-query';
import { routeViewerService } from '../../services/routeViewerService';
import { RvBox } from './RvBox';

// Region roll-up box (master Section 7.14). One row per region with
// REGION / TOTAL / SORT SCAN / RUN SCAN / PICKED UP / TODO columns. Row
// click narrows the parent's region filter to just that region so the
// operator can drill into a specific area. Auto-polled with the run
// list at 25s cadence (parent invalidates this query key).

interface OverviewRow {
  regionId: number;
  // SP emits `region` (not `regionName`) + `total` (not `jobs`) +
  // `toDo` (not `incomplete`). Kept the alt names as optional so a
  // future SP rename doesn't silently break the row render.
  region?: string;
  regionName?: string;
  total?: number;
  jobs?: number;
  toDo?: number;
  incomplete?: number;
  sortScan?: number;
  runScan?: number;
  pickedUp?: number;
}

interface Props {
  runDate: string;
  onRegionPick?: (regionId: number) => void;
}

export function RvOverviewBox({ runDate, onRegionPick }: Props) {
  const query = useQuery({
    queryKey: ['rv-overview', runDate],
    queryFn: () => routeViewerService.getRegionOverview(runDate),
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
          {rows.map((r) => (
            <tr
              key={r.regionId}
              className={`border-b border-border/50 ${
                onRegionPick ? 'cursor-pointer hover:bg-surface-cream/60' : ''
              }`}
              onClick={onRegionPick ? () => onRegionPick(r.regionId) : undefined}
            >
              <td className="px-2 py-1 font-medium">{r.region ?? r.regionName ?? '-'}</td>
              <td className="px-2 py-1">{r.total ?? r.jobs ?? 0}</td>
              <td className="px-2 py-1">{r.sortScan ?? 0}</td>
              <td className="px-2 py-1">{r.runScan ?? 0}</td>
              <td className="px-2 py-1">{r.pickedUp ?? 0}</td>
              <td className="px-2 py-1 text-brand-orange font-medium">{r.toDo ?? r.incomplete ?? 0}</td>
            </tr>
          ))}
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
