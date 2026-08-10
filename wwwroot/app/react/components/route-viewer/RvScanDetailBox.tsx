import { useQuery } from '@tanstack/react-query';
import { routeViewerService } from '../../services/routeViewerService';
import { tenantTime } from '../../lib/tenantDate';
import { useAuth } from '../../context/AuthContext';
import { RvBox } from './RvBox';

// Scan detail box (master Section 7.13.1). Renders Time / Scan Type /
// Courier columns for the currently selected job. Loads via
// GET /api/runviewer/scans/detail?jobId= on selectJob. NP badge chip
// shown next to the courier name when the scan came from an NP driver.

interface Props {
  selectedJobId: number | null;
}

export function RvScanDetailBox({ selectedJobId }: Props) {
  const user = useAuth();
  const query = useQuery({
    queryKey: ['rv-scan-detail', selectedJobId],
    queryFn: () => routeViewerService.getScanDetail(selectedJobId!),
    enabled: selectedJobId != null,
    staleTime: 5_000,
  });

  const rows = query.data ?? [];
  const tzOpts = { isUsTenant: user.isUsTenant, timeZone: user.timeZone };

  return (
    <RvBox title="Scan Detail">
      {selectedJobId == null && (
        <div className="p-3 text-xs text-text-muted">
          Select a job to see its scan history.
        </div>
      )}
      {selectedJobId != null && (
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface-white border-b border-border">
            <tr className="text-left text-text-muted uppercase text-[10px]">
              <th className="px-2 py-1">Time</th>
              <th className="px-2 py-1">Scan Type</th>
              <th className="px-2 py-1">Courier</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s: any, i: number) => (
              <tr key={s.scanId ?? i} className="border-b border-border/50">
                <td className="px-2 py-1 font-mono">
                  {s.scanDateTime ? tenantTime(s.scanDateTime, tzOpts) : (s.time ?? '-')}
                </td>
                <td className="px-2 py-1">{s.scanDetail ?? s.scanType ?? '-'}</td>
                <td className="px-2 py-1">
                  {s.courier ?? s.courierName ?? '-'}
                  {s.isNpAgent && (
                    <span className="ml-1 inline-block bg-brand-orange text-white text-[10px] px-1 rounded">
                      NP
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !query.isLoading && (
              <tr>
                <td className="px-3 py-4 text-center text-text-muted" colSpan={3}>
                  No scans for this job yet.
                </td>
              </tr>
            )}
            {query.isLoading && (
              <tr>
                <td className="px-3 py-4 text-center text-text-muted" colSpan={3}>
                  Loading...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </RvBox>
  );
}
