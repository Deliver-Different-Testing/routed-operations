import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useAutoPoll } from '../../hooks/useAutoPoll';
import { routeViewerService } from '../../services/routeViewerService';
import { tenantTodayYmd } from '../../lib/tenantDate';
import { RvBox } from '../../components/route-viewer/RvBox';
import { RvJobDetail } from '../../components/route-viewer/RvJobDetail';
import { RvScanDetailBox } from '../../components/route-viewer/RvScanDetailBox';

// Linehaul page (master Section 9). Cross-city trunk-move runs with
// pallet counts, scanned/expected item reconciliation, and a load
// percent bar. Column layout: Run | From | To | Jobs | Scans |
// Pallet | Load | Courier | Agent.
//
// Row expansion: chevron opens a per-run sub-panel that lazy-loads
// /api/runviewer/jobs/linehaul (depotId + name + runDate) for the
// picked run.
//
// Toolbar: Export Manifest CSV + Print Labels (Mode 6). Both route
// through the label proxy (env RunViewerLabelProxyUrl); missing =
// clean 501 with the exact env var name.

interface RunRow {
  id: number;
  name: string | null;
  masterJobNumber: string | null;
  fromDepot: string | null;
  toDepot: string | null;
  toDepotId: number | null;
  jobs: number;
  scannedItems: number;
  expectedItems: number;
  pallet: string | null;
  percent: number | null;
  class: string | null;
  courierId: number | null;
  courierName: string | null;
  courierCode: string | null;
  agentId: number | null;
  agentName: string | null;
  isNpAgent: boolean;
}

export default function Linehaul() {
  const user = useAuth();
  const initialDate = tenantTodayYmd({ isUsTenant: user.isUsTenant, timeZone: user.timeZone });
  const [runDate, setRunDate] = useState(initialDate);
  const [expandedIds, setExpandedIds] = useState<number[]>([]);
  const toggleExpanded = (id: number) => setExpandedIds((prev) =>
    prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
  );
  // Focused job for the right-side JobDetail + ScanList panes. Legacy
  // `linehaul/tpls/jobDetail.tpl` + `scanList.tpl` show these when the
  // operator clicks a job in the expanded sub-panel of a run.
  const [focusedJobId, setFocusedJobId] = useState<number | null>(null);

  const runsQ = useQuery({
    queryKey: ['lh-runs', runDate],
    queryFn: () => routeViewerService.getLinehaulRuns(runDate),
    enabled: !!runDate,
    staleTime: 5_000,
  });

  // Region roll-up (admin-only per legacy). Adds a Pallet column
  // absent from the Home overview - drives operator overview of load
  // balance across origin regions.
  const overviewQ = useQuery({
    queryKey: ['lh-overview', runDate],
    queryFn: () => routeViewerService.getLinehaulOverview(runDate),
    enabled: !user.isNetworkPartner && !!runDate,
    staleTime: 15_000,
  });

  useAutoPoll(() => runsQ.refetch(), 25, true);

  const rows = (runsQ.data ?? []) as RunRow[];

  const totals = useMemo(() => {
    let jobs = 0;
    let scanned = 0;
    let expected = 0;
    for (const r of rows) {
      jobs += r.jobs;
      scanned += r.scannedItems;
      expected += r.expectedItems;
    }
    return { jobs, scanned, expected };
  }, [rows]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-border bg-surface-white">
        <label className="flex items-center gap-1 text-xs text-text-secondary">
          <span>Date</span>
          <input
            type="date"
            value={runDate}
            onChange={(e) => setRunDate(e.target.value)}
            className="border border-border rounded px-2 py-0.5 text-xs bg-surface-white"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            // Manifest CSV covers the whole day. Wraps
            // /api/runviewer/labels/linehaul-manifest (proxies to legacy
            // /Home/Labels/LineHaulManifest which owns the report).
            const params = new URLSearchParams({ bookDate: runDate });
            window.open(`/api/runviewer/labels/linehaul-manifest?${params}`, '_blank');
          }}
          className="text-xs px-3 py-1 rounded bg-surface-cream border border-border hover:bg-brand-cyan/10"
        >
          Export manifest CSV
        </button>
        <button
          type="button"
          onClick={async () => {
            // Mode 6 linehaul labels PDF for the whole day. Backend
            // routes through the label proxy (env RunViewerLabelProxyUrl).
            const res = await fetch('/api/runviewer/labels/linehaul-jobs', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
              credentials: 'same-origin',
              body: JSON.stringify({ bookDate: runDate }),
            });
            if (!res.ok) return alert(`Print labels failed: ${res.status}`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
          }}
          className="text-xs px-3 py-1 rounded bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/30 hover:bg-brand-cyan/20"
        >
          Print labels (Mode 6)
        </button>
        <div className="ml-auto text-xs text-text-muted">
          {runsQ.isLoading
            ? 'Loading...'
            : `${rows.length} runs, ${totals.jobs} jobs, ${totals.scanned}/${totals.expected} scanned`}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
      <div className="flex-[3] min-w-0 flex flex-col overflow-hidden border-r border-border">
        {!user.isNetworkPartner && (
          <div className="h-40 flex-shrink-0 border-b border-border overflow-hidden">
          <RvBox title="Linehaul Region Overview">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-white border-b border-border">
                <tr className="text-left text-text-muted uppercase text-[10px]">
                  <th className="px-2 py-1">Region</th>
                  <th className="px-2 py-1">Total</th>
                  <th className="px-2 py-1">Sort Scan</th>
                  <th className="px-2 py-1">Run Scan</th>
                  <th className="px-2 py-1">Picked Up</th>
                  <th className="px-2 py-1">Pallet</th>
                  <th className="px-2 py-1 text-brand-orange">Todo</th>
                </tr>
              </thead>
              <tbody>
                {(overviewQ.data ?? []).map((r) => {
                  const bar = r.class === 'green' ? 'bg-emerald-200'
                    : r.class === 'orange' ? 'bg-amber-200'
                    : r.class === 'red' ? 'bg-red-200'
                    : 'bg-transparent';
                  const pct = Math.max(0, Math.min(100, Number(r.percent) || 0));
                  return (
                    <tr key={r.regionId} className="relative border-b border-border/50">
                      <td className="px-2 py-1 font-medium relative">
                        <div
                          className={`absolute inset-y-0 left-0 ${bar} opacity-60 -z-10 pointer-events-none`}
                          style={{ width: `${pct}%` }}
                        />
                        {r.region ?? '-'}
                      </td>
                      <td className="px-2 py-1">{r.total}</td>
                      <td className="px-2 py-1">{r.sortScan}</td>
                      <td className="px-2 py-1">{r.runScan}</td>
                      <td className="px-2 py-1">{r.pickedUp}</td>
                      <td className="px-2 py-1">{r.pallet ?? '-'}</td>
                      <td className="px-2 py-1 text-brand-orange font-medium">{r.toDo}</td>
                    </tr>
                  );
                })}
                {(overviewQ.data ?? []).length === 0 && !overviewQ.isLoading && (
                  <tr>
                    <td className="px-3 py-3 text-center text-text-muted" colSpan={7}>
                      No linehaul regions with jobs for this date.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </RvBox>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-auto">
        <RvBox title="Linehaul Runs">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface-white border-b border-border">
              <tr className="text-left text-text-muted">
                <th className="px-2 py-1 w-6"></th>
                <th className="px-2 py-1">Run</th>
                <th className="px-2 py-1">From</th>
                <th className="px-2 py-1">To</th>
                <th className="px-2 py-1 text-center">Jobs</th>
                <th className="px-2 py-1 text-center">Scans</th>
                <th className="px-2 py-1">Pallet</th>
                <th className="px-2 py-1 w-24">Load</th>
                <th className="px-2 py-1">Courier</th>
                <th className="px-2 py-1">Agent</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <LinehaulRow
                  key={r.id}
                  row={r}
                  expanded={expandedIds.includes(r.id)}
                  runDate={runDate}
                  onToggle={() => toggleExpanded(r.id)}
                  onSelectJob={setFocusedJobId}
                  focusedJobId={focusedJobId}
                />
              ))}
              {rows.length === 0 && !runsQ.isLoading && (
                <tr>
                  <td className="px-3 py-6 text-center text-text-muted" colSpan={10}>
                    No linehaul runs for this date.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </RvBox>
        </div>
      </div>

        {/* Right column - JobDetail + ScanList when a linehaul job is
            focused. Matches legacy `linehaul/tpls/jobDetail.tpl` +
            `scanList.tpl` right-pane layout. Focused job comes from the
            expanded run row's sub-panel below. */}
        <div className="flex-[2] min-w-0 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-auto border-b border-border">
            <RvJobDetail
              bulkJobId={focusedJobId}
              initialJob={null}
              onPickSibling={() => { /* Linehaul doesn't cross-navigate */ }}
            />
          </div>
          <div className="h-64 overflow-auto">
            <RvScanDetailBox selectedJobId={focusedJobId} />
          </div>
        </div>
      </div>
    </div>
  );
}

function LinehaulRow({ row, expanded, runDate, onToggle, onSelectJob, focusedJobId }: {
  row: RunRow;
  expanded: boolean;
  runDate: string;
  onToggle: () => void;
  onSelectJob: (id: number) => void;
  focusedJobId: number | null;
}) {
  const bar = row.class === 'green' ? 'bg-emerald-400'
    : row.class === 'orange' ? 'bg-amber-400'
    : row.class === 'red' ? 'bg-red-400'
    : 'bg-slate-300';
  const pct = Math.max(0, Math.min(100, Number(row.percent) || 0));

  // Depot-based lookup; SP requires both depotId AND name so if either
  // is missing we skip the fetch and show "no lookup keys" to the
  // operator (rare but real - master-only synthetic rows).
  const canLoad = row.toDepotId != null && !!row.name;
  const jobsQ = useQuery({
    queryKey: ['lh-jobs', row.toDepotId, row.name, runDate],
    queryFn: () => routeViewerService.getLinehaulJobs(row.toDepotId!, row.name!, runDate),
    enabled: expanded && canLoad,
    staleTime: 15_000,
  });
  const jobs = jobsQ.data ?? [];

  return (
    <>
      <tr className="border-b border-border/50 hover:bg-surface-cream/60">
        <td className="px-2 py-1 text-center">
          <button
            type="button"
            onClick={onToggle}
            className="w-4 h-4 flex items-center justify-center text-text-muted hover:text-text-primary"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
                 className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}>
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </button>
        </td>
        <td className="px-2 py-1 font-medium">
          {row.name ?? '-'}
          {row.masterJobNumber && (
            <div className="text-[10px] text-text-muted">Master: {row.masterJobNumber}</div>
          )}
        </td>
        <td className="px-2 py-1">{row.fromDepot ?? '-'}</td>
        <td className="px-2 py-1">{row.toDepot ?? '-'}</td>
        <td className="px-2 py-1 text-center">{row.jobs}</td>
        <td className="px-2 py-1 text-center">{row.scannedItems}/{row.expectedItems}</td>
        <td className="px-2 py-1">{row.pallet ?? '-'}</td>
        <td className="px-2 py-1">
          <div className="relative h-3 rounded bg-slate-100 overflow-hidden">
            <div className={`absolute inset-y-0 left-0 ${bar}`} style={{ width: `${pct}%` }} />
            <div className="absolute inset-0 flex items-center justify-center text-[9px] text-slate-700 font-medium">
              {pct.toFixed(0)}%
            </div>
          </div>
        </td>
        <td className="px-2 py-1">
          {row.courierName ?? '-'}
          {row.courierCode && <span className="text-text-muted">:{row.courierCode}</span>}
        </td>
        <td className="px-2 py-1">
          {row.agentName ?? '-'}
          {row.isNpAgent && (
            <span className="ml-1 inline-block bg-brand-orange text-white text-[10px] px-1 rounded">NP</span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={10} className="px-3 py-2 bg-slate-50/60 border-b border-border">
            {!canLoad && (
              <div className="text-text-muted text-[11px]">No depot lookup keys for this run.</div>
            )}
            {canLoad && jobsQ.isLoading && (
              <div className="text-text-muted text-[11px]">Loading run jobs...</div>
            )}
            {canLoad && !jobsQ.isLoading && jobs.length === 0 && (
              <div className="text-text-muted text-[11px]">No jobs on this run yet.</div>
            )}
            {jobs.length > 0 && (
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-text-muted">
                    <th className="px-1 py-0.5">Client</th>
                    <th className="px-1 py-0.5">Job #</th>
                    <th className="px-1 py-0.5">To</th>
                    <th className="px-1 py-0.5">Pallet</th>
                    <th className="px-1 py-0.5 text-center">Items</th>
                    <th className="px-1 py-0.5">Picked</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr
                      key={j.bulkJobId}
                      onClick={() => onSelectJob(j.bulkJobId)}
                      className={`cursor-pointer border-t border-border/40 ${
                        focusedJobId === j.bulkJobId ? 'bg-brand-cyan/20' : 'hover:bg-surface-cream/60'
                      }`}
                    >
                      <td className="px-1 py-0.5">{j.clientCode ?? '-'}</td>
                      <td className="px-1 py-0.5 font-mono">{j.jobNumber ?? '-'}</td>
                      <td className="px-1 py-0.5 truncate max-w-[16rem]" title={j.toAddress ?? undefined}>
                        {j.toAddress ?? '-'}
                      </td>
                      <td className="px-1 py-0.5">{j.pallet ?? '-'}</td>
                      <td className="px-1 py-0.5 text-center">{j.items}</td>
                      <td className="px-1 py-0.5">{j.pickedUp ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
