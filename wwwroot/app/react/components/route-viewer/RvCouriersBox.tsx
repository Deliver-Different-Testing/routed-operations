import { useQuery } from '@tanstack/react-query';
import { routeViewerService } from '../../services/routeViewerService';
import { RvBox } from './RvBox';

// Route Viewer Couriers box (master Section 7.15). Slim list of the
// day's active couriers with an availability dot, active-job count,
// vehicle type, and fleet. Row click filters the parent Run List to
// the picked courier's runs (parent handles via onPick prop; we only
// surface the row event here).
//
// Data source: RVW_stpActiveCouriers via /api/runviewer/couriers.
// Auto-poll cadence matches the Run List (25 s).

interface CourierListRow {
  courierId: number;
  code: string;
  name: string;
  fleet?: string;
  activeJobs?: number;
  isAvailable?: boolean;
  vehicleType?: string;
}

interface Props {
  runDate: string;
  onPick?: (courierId: number) => void;
}

export function RvCouriersBox({ runDate, onPick }: Props) {
  const q = useQuery({
    queryKey: ['rv-couriers-box', runDate],
    queryFn: () => routeViewerService.getActiveCouriers(runDate),
    enabled: !!runDate,
    staleTime: 25_000,
  });

  const rows = (q.data ?? []) as CourierListRow[];

  return (
    <RvBox title="Couriers">
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
          {rows.map((c) => {
            // Highlight low-load couriers per legacy (<=3 active jobs)
            // so operators can pick a spare-capacity driver quickly.
            const lightLoad = (c.activeJobs ?? 0) <= 3;
            return (
              <tr
                key={c.courierId}
                draggable
                onDragStart={(e) => {
                  // Native HTML5 drag payload. RvRunList's drop
                  // handler reads the courierCode + courierId to hit
                  // /runviewer/jobs/preassign-run. Keep the payload
                  // primitive so no serialisation quirks with objects.
                  e.dataTransfer.setData('application/rv-courier-code', c.code);
                  e.dataTransfer.setData('application/rv-courier-id', String(c.courierId));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={onPick ? () => onPick(c.courierId) : undefined}
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
          {rows.length === 0 && !q.isLoading && (
            <tr>
              <td className="px-3 py-4 text-center text-text-muted" colSpan={5}>
                No active couriers for this date.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </RvBox>
  );
}
