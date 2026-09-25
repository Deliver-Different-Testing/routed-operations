import { useQuery } from '@tanstack/react-query';
import { routeViewerService } from '../../services/routeViewerService';
import { tenantTime } from '../../lib/tenantDate';
import { useAuth } from '../../context/AuthContext';
import { RvBox } from './RvBox';

// Scan detail box (master Section 7.13.1). Renders Time / Scan / Location /
// Courier columns for the currently selected job. Loads via
// GET /api/runviewer/scans/detail?jobId= on selectJob.
//
// Extended context per legacy scanList.tpl (2026-07-02 Steve mockup):
//  - Leg badge chip next to Scan Type (e.g. LH1, DEL).
//  - Item chips strip (parsed from ItemLabels JSON string).
//  - Tote/Run subline under the Scan cell.
//  - Location column (4th column).
//  - Courier role subtitle (e.g. Driver, Handler) under courier name.
//  - NP chip stays right of the courier name when the scan came from an
//    NP driver.

interface Props {
  selectedJobId: number | null;
}

// Parse ItemLabels (JSON string array of barcodes). Returns [] on any
// parse error so bad server data cannot crash the panel.
function parseItemLabels(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
    }
    return [];
  } catch {
    return [];
  }
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
              <th className="px-2 py-1">Scan</th>
              <th className="px-2 py-1">Location</th>
              <th className="px-2 py-1">Courier</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s: any, i: number) => {
              const items = parseItemLabels(s.itemLabels);
              const leg = s.leg ?? null;
              const tote = s.tote ?? null;
              const run = s.run ?? null;
              const location = s.location ?? null;
              const role = s.role ?? null;
              const courier = s.courier ?? s.courierName ?? '-';
              const scanText = s.scanDetail ?? s.scanType ?? '-';
              return (
                <tr key={s.scanId ?? i} className="border-b border-border/50 align-top">
                  <td className="px-2 py-1 font-mono whitespace-nowrap">
                    {s.scanDateTime ? tenantTime(s.scanDateTime, tzOpts) : (s.time ?? '-')}
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span>{scanText}</span>
                      {leg && (
                        <span
                          data-testid="rv-scan-leg-badge"
                          className="inline-block bg-brand-cyan text-white text-[10px] px-1 rounded uppercase"
                        >
                          {leg}
                        </span>
                      )}
                      {items.map((label, idx) => (
                        <span
                          key={`${label}-${idx}`}
                          data-testid="rv-scan-item-chip"
                          className="inline-block bg-surface-light text-text-primary text-[10px] px-1 rounded border border-border"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                    {(tote || run) && (
                      <div
                        data-testid="rv-scan-toterun"
                        className="mt-0.5 text-[10px] text-text-muted"
                      >
                        {tote && <span>Tote {tote}</span>}
                        {tote && run && <span> &middot; </span>}
                        {run && <span>Run {run}</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1 max-w-[180px] truncate" title={location ?? undefined}>
                    {location ?? '-'}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    <div>
                      {courier}
                      {s.isNpAgent && (
                        <span className="ml-1 inline-block bg-brand-orange text-white text-[10px] px-1 rounded">
                          NP
                        </span>
                      )}
                    </div>
                    {role && (
                      <div
                        data-testid="rv-scan-role"
                        className="text-[10px] text-text-muted"
                      >
                        {role}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && !query.isLoading && (
              <tr>
                <td className="px-3 py-4 text-center text-text-muted" colSpan={4}>
                  No scans for this job yet.
                </td>
              </tr>
            )}
            {query.isLoading && (
              <tr>
                <td className="px-3 py-4 text-center text-text-muted" colSpan={4}>
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
