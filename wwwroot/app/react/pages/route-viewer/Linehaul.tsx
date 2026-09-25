import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useAutoPoll } from '../../hooks/useAutoPoll';
import { useRouteViewerLookups } from '../../hooks/queries/useRouteViewerLookups';
import { routeViewerService } from '../../services/routeViewerService';
import { tenantTodayYmd } from '../../lib/tenantDate';
import { RvBox } from '../../components/route-viewer/RvBox';
import { RvJobDetail } from '../../components/route-viewer/RvJobDetail';
import { RvScanDetailBox } from '../../components/route-viewer/RvScanDetailBox';
import { AssignRouteDialog } from '../../components/route-viewer/AssignRouteDialog';
import { MultiSelect } from '../../components/common/MultiSelect';
import { RowContextMenu, type ContextMenuItem } from '../../components/cockpit/RowContextMenu';
import { nextSortDirection, sortIndicator } from '../../lib/sortLists';
import type { ListSort } from '../../components/cockpit/CockpitState';
import type { SiblingJob } from '../../services/routeViewerService';

// Linehaul page (master Section 9). Cross-city trunk-move runs with
// pallet counts, scanned/expected item reconciliation, and a load
// percent bar. Column layout: Run | From | To | Jobs | Scans |
// Pallet | Load | Courier | Agent | Actions.
//
// Row expansion: chevron opens a per-run sub-panel that lazy-loads
// /api/runviewer/jobs/linehaul (depotId + name + runDate) for the
// picked run.
//
// Toolbar: Export Manifest CSV + Print Labels (Mode 6, full day) +
// Download Linehaul Report (full-day CSV). PDF label routes go through
// the label proxy (env RunViewerLabelProxyUrl); missing = clean 501
// with the exact env var name. Linehaul Report hits
// GET /api/runviewer/reports/linehaul (admin-only) and downloads a
// LinehaulReport_yymmdd_HHmmss.csv file.
//
// Per-run action (2026-08-14): each run row carries a "Labels" action
// that fires the Mode 6 label endpoint scoped to that run's toDepotId
// + run name + currently-selected client / speed filters. Mirrors
// legacy linehaulControl.js `getLabels()` behaviour so operators do
// not have to switch to a legacy screen to print a single run.
//
// Filters + sort + search (2026-08-14): Client / Region / Courier /
// Speed multi-select dropdowns + click-to-sort headers on both the
// run list and the expanded per-run jobs table + a debounced Search
// Jobs input that narrows both surfaces by any-column substring
// match. Region / Client / Speed option lists come from
// `useRouteViewerLookups`; Courier list is derived from the loaded
// rows so the dropdown only shows couriers actually on today's
// linehaul (matches legacy behaviour). All filtering is client-side
// against the loaded arrays - no backend round-trip on filter change.

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

interface JobRow {
  bulkJobId: number;
  jobNumber: string | null;
  clientCode: string | null;
  toAddress: string | null;
  pallet: string | null;
  items: number;
  pickedUp: string | null;
  /** JSON string emitted by RVW_stpLinehaulJobs (2026-07-01). Parsed
   *  once per row by `parseScanHistory` and rendered as chips in the
   *  Scanned column. Empty JSON array (`[]`) when no scans exist. */
  scanHistory: string | null;
}

/** One entry in the scanHistory JSON array. Emitted by the SP's
 *  OUTER APPLY (see 20260701120300_RVWRoutedShipmentDetailAndMasterJob.sql).
 *  `ScanType` is the pre-mapped label ("Sort" / "Run" / "InvalidRun" etc);
 *  raw ScanType ints from tblBulkScan are already resolved server-side. */
interface ScanHistoryEntry {
  ScanDateTime: string;
  ScanType: string;
  Courier: string;
}

// SP-emitted ScanType labels split by outcome. Any label containing
// "Invalid" or "Exception" / "Override" is treated as short (red);
// the rest are completed (green). "Transit" chips render neutral
// (grey) because a transit scan is a mid-flight event rather than a
// terminal state - matches how the legacy scanned cell distinguished
// in-flight from finished work.
const SCAN_SHORT_MARKERS = ['Invalid', 'Exception', 'Override'];
const SCAN_PENDING_MARKERS = ['Transit'];

export function scanChipTone(scanType: string | null | undefined): 'green' | 'grey' | 'red' {
  if (!scanType) return 'grey';
  for (const m of SCAN_SHORT_MARKERS) if (scanType.includes(m)) return 'red';
  for (const m of SCAN_PENDING_MARKERS) if (scanType.includes(m)) return 'grey';
  return 'green';
}

// Parse the SP-emitted JSON blob into a typed array. Returns `[]` for
// null / empty / malformed values so the render path never sees a
// thrown parse error. Exported for the test file so the chip renderer
// can be exercised without an SP round-trip.
export function parseScanHistory(raw: string | null | undefined): ScanHistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ScanHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

// Small any-value comparer used by the local generic sorter. Mirrors
// `compareValues` in lib/sortLists.ts but is inlined here so the
// Linehaul row shape (which is neither BulkJob nor Run) can be sorted
// without stuffing its fields into the shared getter switch.
function cmp(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function sortBy<T>(rows: T[], sort: ListSort | null, getter: (row: T, field: string) => unknown): T[] {
  if (!sort) return rows;
  const mult = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => cmp(getter(a, sort.field), getter(b, sort.field)) * mult);
}

// 200ms free-text debounce. Matches the Route Builder cockpit search
// cadence so the two operator surfaces feel identical.
function useDebounced<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function runFieldGetter(row: RunRow, field: string): unknown {
  switch (field) {
    case 'name': return row.name ?? '';
    case 'fromDepot': return row.fromDepot ?? '';
    case 'toDepot': return row.toDepot ?? '';
    case 'jobs': return row.jobs;
    case 'scans': return row.scannedItems;
    case 'pallet': return row.pallet ?? '';
    case 'percent': return row.percent ?? 0;
    case 'courier': return row.courierName ?? row.courierCode ?? '';
    case 'agent': return row.agentName ?? '';
    default: return '';
  }
}

function jobFieldGetter(row: JobRow, field: string): unknown {
  switch (field) {
    case 'clientCode': return row.clientCode ?? '';
    case 'jobNumber': return row.jobNumber ?? '';
    case 'toAddress': return row.toAddress ?? '';
    case 'pallet': return row.pallet ?? '';
    case 'items': return row.items;
    case 'pickedUp': return row.pickedUp ?? '';
    default: return '';
  }
}

// Any-column substring match. Case-insensitive. Used by the Search
// Jobs input for both runs and expanded jobs.
function rowMatches(needle: string, values: Array<string | number | null | undefined>): boolean {
  if (!needle) return true;
  const n = needle.toLowerCase();
  for (const v of values) {
    if (v == null) continue;
    if (String(v).toLowerCase().includes(n)) return true;
  }
  return false;
}

// yymmdd_HHmmss stamp used by the Linehaul Report CSV filename.
// Matches legacy linehaulControl.js downloadLinehaulReport which
// composes the same shape via moment("YYMMDD_HHmmss"). Local time
// is fine here: the report is downloaded by the operator on their
// local machine and the stamp is just a uniqueness suffix.
export function linehaulReportStamp(now: Date = new Date()): string {
  const yy = String(now.getFullYear() % 100).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yy}${mm}${dd}_${hh}${mi}${ss}`;
}

// Mode 6 linehaul label POST. Shared by the toolbar full-day button
// and the per-run action. Passes bookDate + optional depotId / runName
// / clientIds / speedIds; the backend forwards the payload verbatim to
// the legacy /Home/Labels/LineHaulJobs endpoint via the label proxy.
// On success opens the returned PDF in a new tab (window.open on an
// object URL matches the legacy behaviour + the existing full-day
// button). On failure surfaces the status code via alert() so operators
// can see the specific 4xx/5xx.
async function printLinehaulLabels(payload: {
  bookDate: string;
  depotId?: number | null;
  runName?: string | null;
  clientIds?: string;
  speedIds?: string;
}): Promise<void> {
  const body: Record<string, unknown> = { bookDate: payload.bookDate };
  if (payload.depotId != null) body.depotId = payload.depotId;
  if (payload.runName) body.runName = payload.runName;
  if (payload.clientIds) body.clientIds = payload.clientIds;
  if (payload.speedIds) body.speedIds = payload.speedIds;
  const res = await fetch('/api/runviewer/labels/linehaul-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    alert(`Print labels failed: ${res.status}`);
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

// Discriminated ctx menu target. A run right-click carries the run id
// only; a job right-click carries the parent run id (so the dialog can
// scope the assign to the correct run) + the bulkJobId as anchor. The
// AssignRouteDialog uses `anchorJobId` for its NP scope guard on the
// agent search endpoint.
type LinehaulCtxTarget =
  | { kind: 'run'; runId: number; runName: string | null }
  | { kind: 'job'; runId: number; bulkJobId: number; jobNumber: string | null };

interface LinehaulCtxState {
  x: number;
  y: number;
  target: LinehaulCtxTarget;
}

// Ctx menu title + items for both run rows and job rows. NP users see
// "Assign Courier" only (matches legacy linehaulControl.js runListMenu +
// jobListMenu). Admins see both "Assign Route" (opens the dialog with
// default bucket = courier + admin can flip to agent/np tabs) and a
// dedicated "Assign Courier" shortcut. Both open the same dialog since
// AssignRouteDialog is the unified 3-way picker; the second entry is
// kept for label parity with the legacy right-click menu wording.
// Exported for the test file so the items can be exercised without a
// full render cycle.
export function linehaulCtxMenuItems(
  target: LinehaulCtxTarget,
  isNetworkPartner: boolean,
  openAssign: (target: LinehaulCtxTarget) => void,
): { title: string; items: ContextMenuItem[] } {
  const title = target.kind === 'run'
    ? `Run ${target.runName ?? `#${target.runId}`}`
    : `Job ${target.jobNumber ?? `#${target.bulkJobId}`}`;
  const items: ContextMenuItem[] = isNetworkPartner
    ? [
        { label: 'Assign Courier', onClick: () => openAssign(target) },
      ]
    : [
        { label: 'Assign Route', onClick: () => openAssign(target) },
        { label: 'Assign Courier', onClick: () => openAssign(target) },
      ];
  return { title, items };
}

export default function Linehaul() {
  const user = useAuth();
  const toast = useToast();
  const initialDate = tenantTodayYmd({ isUsTenant: user.isUsTenant, timeZone: user.timeZone });
  const [runDate, setRunDate] = useState(initialDate);
  const [expandedIds, setExpandedIds] = useState<number[]>([]);
  const toggleExpanded = (id: number) => setExpandedIds((prev) =>
    prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
  );

  // Right-click ctx menu state. Lifted to the top-level page (rather
  // than local to LinehaulRow) so the resulting AssignRouteDialog sits
  // above the tables and is not clipped by the expanded-row cell.
  // Mirrors CustomerServices.tsx event menu wiring pattern.
  const [ctx, setCtx] = useState<LinehaulCtxState | null>(null);
  const [assignTarget, setAssignTarget] = useState<LinehaulCtxTarget | null>(null);
  const openContextMenu = (target: LinehaulCtxTarget, x: number, y: number) =>
    setCtx({ x, y, target });
  // Focused job for the right-side JobDetail + ScanList panes. Legacy
  // `linehaul/tpls/jobDetail.tpl` + `scanList.tpl` show these when the
  // operator clicks a job in the expanded sub-panel of a run.
  const [focusedJobId, setFocusedJobId] = useState<number | null>(null);
  // Sibling-tab override for LH legs (LHP / LH1..LHn / DEL). Mirrors the
  // Home cockpit RunViewer pattern: intermediate LH legs have no
  // tblBulkJob row (bulkJobId=0) so they can only render via the
  // sibling payload snapshot. When the operator clicks a sibling tab
  // in RvJobDetail we route through this override rather than through
  // focusedJobId, because focusedJobId is a bulkJobId (unique per
  // tblBulkJob) and can't disambiguate three LH legs that all share
  // bulkJobId=0. Cleared whenever the operator picks a fresh job from
  // the expanded run panel.
  //
  // Cross-run limitation: the linehaul jobs SP is scoped per (depot,
  // run name, date), so sibling jobs belonging to a different run are
  // NOT already in cache. That's fine here because RvJobDetail either
  // renders the sibling.job snapshot directly (LH legs) or falls back
  // to fetching by bulkJobId. Either way we do NOT try to switch the
  // expanded run row when picking a sibling on a different run - the
  // Linehaul page's left-hand run list stays as-is; only the right
  // detail pane swaps to the sibling's data.
  const [siblingOverride, setSiblingOverride] = useState<SiblingJob | null>(null);
  const onSelectJob = (id: number) => {
    setFocusedJobId(id);
    setSiblingOverride(null);
  };

  // Filter state. All four are multi-select and applied client-side
  // against loaded rows. Values are string ids to match MultiSelect's
  // contract; Client / Region / Speed ids convert to number for the
  // set-based row match.
  const [clientIds, setClientIds] = useState<string[]>([]);
  const [regionIds, setRegionIds] = useState<string[]>([]);
  const [courierIds, setCourierIds] = useState<string[]>([]);
  const [speedIds, setSpeedIds] = useState<string[]>([]);
  const [searchText, setSearchText] = useState('');
  const debouncedSearch = useDebounced(searchText, 200);

  // Sort state. Run list + expanded per-run jobs table each carry
  // their own sort so the two surfaces are independent (matches the
  // legacy `sort.runList` / `sort.jobList` split).
  const [runSort, setRunSort] = useState<ListSort | null>(null);
  const [jobSort, setJobSort] = useState<ListSort | null>(null);

  const { clients, regions, speeds } = useRouteViewerLookups(runDate);

  // Region + Speed narrow at the SP layer: getLinehaulRuns forwards
  // regionIds + speedIds to RVW_stpLineHaulRuns via LinehaulRunListRequest,
  // so a filter change triggers a refetch with the tightened WHERE clause.
  // Client-side courier + search narrowing still layers on top of the
  // server response.
  const runsQ = useQuery({
    queryKey: ['lh-runs', runDate, regionIds, speedIds],
    queryFn: () => routeViewerService.getLinehaulRuns(
      runDate,
      undefined,
      undefined,
      regionIds.length ? regionIds.map(Number) : undefined,
      speedIds.length ? speedIds.map(Number) : undefined,
    ),
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

  // Courier option list derived from loaded rows. Legacy behaviour:
  // dropdown only shows couriers actually assigned to today's linehaul,
  // not the full active-courier list. De-dupe by courierId.
  const courierOptions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const r of rows) {
      if (r.courierId == null) continue;
      const label = r.courierName ?? r.courierCode ?? String(r.courierId);
      if (!seen.has(r.courierId)) seen.set(r.courierId, label);
    }
    return Array.from(seen.entries())
      .map(([id, label]) => ({ value: String(id), label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  // Client-side courier + search narrowing on the already-region+speed
  // filtered server response. Region+Speed are handled at the SP layer via
  // the runsQ queryKey above so a fresh selection triggers a refetch with
  // the tightened WHERE clause. Courier stays client-side because the
  // courier dropdown is derived from the currently loaded rows (not a
  // server-side lookup) so filtering at that layer keeps the options list
  // in sync with the visible rows.
  const filteredRuns = useMemo(() => {
    const courierSet = new Set(courierIds.map(Number));
    return rows.filter((r) => {
      if (courierSet.size && (r.courierId == null || !courierSet.has(r.courierId))) return false;
      if (!rowMatches(debouncedSearch, [
        r.name, r.masterJobNumber, r.fromDepot, r.toDepot,
        r.pallet, r.courierName, r.courierCode, r.agentName,
      ])) return false;
      return true;
    });
  }, [rows, courierIds, debouncedSearch]);

  const sortedRuns = useMemo(
    () => sortBy(filteredRuns, runSort, runFieldGetter),
    [filteredRuns, runSort],
  );

  const totals = useMemo(() => {
    let jobs = 0;
    let scanned = 0;
    let expected = 0;
    for (const r of filteredRuns) {
      jobs += r.jobs;
      scanned += r.scannedItems;
      expected += r.expectedItems;
    }
    return { jobs, scanned, expected };
  }, [filteredRuns]);

  const onRunHeader = (field: string) => () => setRunSort((prev) => nextSortDirection(prev, field));
  const onJobHeader = (field: string) => () => setJobSort((prev) => nextSortDirection(prev, field));

  // Client-side filter set for the expanded job rows. Client ids match
  // via clientCode (the loaded lookup labels are the client codes for
  // this SP - matches legacy behaviour). Speed lookup exists but
  // linehaul jobs DTO has no speed field, so speedIds narrows nothing
  // on the jobs table today.
  const selectedClientLabels = useMemo(() => {
    const set = new Set(
      clientIds
        .map((id) => clients.find((c) => String(c.id) === id)?.label)
        .filter((l): l is string => !!l)
        .map((l) => l.toLowerCase()),
    );
    return set;
  }, [clientIds, clients]);

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

        {!user.isNetworkPartner && (
          <MultiSelect
            label="Clients"
            options={clients.map((c) => ({ value: String(c.id), label: c.label ?? '(unnamed)' }))}
            selected={clientIds}
            onChange={setClientIds}
          />
        )}
        <MultiSelect
          label="Regions"
          options={regions.map((r) => ({ value: String(r.id), label: r.label }))}
          selected={regionIds}
          onChange={setRegionIds}
        />
        <MultiSelect
          label="Couriers"
          options={courierOptions}
          selected={courierIds}
          onChange={setCourierIds}
        />
        <MultiSelect
          label="Speeds"
          options={speeds.map((s) => ({ value: String(s.id), label: s.label }))}
          selected={speedIds}
          onChange={setSpeedIds}
        />

        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search jobs..."
          aria-label="Search jobs"
          className="border border-border rounded px-2 py-0.5 text-xs bg-surface-white w-40"
        />

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
            // Full-day Linehaul Report CSV. Hits
            // /api/runviewer/reports/linehaul (admin-only) with the
            // current date. Blob-downloads as
            // LinehaulReport_yymmdd_HHmmss.csv per legacy convention.
            const params = new URLSearchParams({ runDate });
            const res = await fetch(`/api/runviewer/reports/linehaul?${params}`, {
              method: 'GET',
              credentials: 'same-origin',
            });
            if (!res.ok) {
              alert(`Linehaul report failed: ${res.status}`);
              return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `LinehaulReport_${linehaulReportStamp()}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }}
          className="text-xs px-3 py-1 rounded bg-surface-cream border border-border hover:bg-brand-cyan/10"
        >
          Download Linehaul Report
        </button>
        <button
          type="button"
          onClick={() => {
            // Mode 6 linehaul labels PDF for the whole day. Backend
            // routes through the label proxy (env RunViewerLabelProxyUrl).
            void printLinehaulLabels({
              bookDate: runDate,
              clientIds: clientIds.join(',') || undefined,
              speedIds: speedIds.join(',') || undefined,
            });
          }}
          className="text-xs px-3 py-1 rounded bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/30 hover:bg-brand-cyan/20"
        >
          Print labels (Mode 6)
        </button>
        <div className="ml-auto text-xs text-text-muted">
          {runsQ.isLoading
            ? 'Loading...'
            : `${sortedRuns.length} runs, ${totals.jobs} jobs, ${totals.scanned}/${totals.expected} scanned`}
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
              <tr className="text-left text-text-muted select-none">
                <th className="px-2 py-1 w-6"></th>
                <SortableTh label="Run" field="name" sort={runSort} onClick={onRunHeader('name')} />
                <SortableTh label="From" field="fromDepot" sort={runSort} onClick={onRunHeader('fromDepot')} />
                <SortableTh label="To" field="toDepot" sort={runSort} onClick={onRunHeader('toDepot')} />
                <SortableTh label="Jobs" field="jobs" sort={runSort} onClick={onRunHeader('jobs')} align="center" />
                <SortableTh label="Scans" field="scans" sort={runSort} onClick={onRunHeader('scans')} align="center" />
                <SortableTh label="Pallet" field="pallet" sort={runSort} onClick={onRunHeader('pallet')} />
                <SortableTh label="Load" field="percent" sort={runSort} onClick={onRunHeader('percent')} width="w-24" />
                <SortableTh label="Courier" field="courier" sort={runSort} onClick={onRunHeader('courier')} />
                <SortableTh label="Agent" field="agent" sort={runSort} onClick={onRunHeader('agent')} />
                <th className="px-2 py-1 text-text-muted select-none">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedRuns.map((r) => (
                <LinehaulRow
                  key={r.id}
                  row={r}
                  expanded={expandedIds.includes(r.id)}
                  runDate={runDate}
                  jobSort={jobSort}
                  onJobHeader={onJobHeader}
                  searchNeedle={debouncedSearch}
                  clientLabelSet={selectedClientLabels}
                  onToggle={() => toggleExpanded(r.id)}
                  onSelectJob={onSelectJob}
                  focusedJobId={focusedJobId}
                  clientIds={clientIds}
                  speedIds={speedIds}
                  onOpenContextMenu={openContextMenu}
                />
              ))}
              {sortedRuns.length === 0 && !runsQ.isLoading && (
                <tr>
                  <td className="px-3 py-6 text-center text-text-muted" colSpan={11}>
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
            expanded run row's sub-panel below.
            Sibling override: when the operator clicks a sibling tab
            (LHP / LH1..LHn / DEL) inside the JobDetail strip, we route
            the pane through siblingOverride so LH legs (which have no
            tblBulkJob row and share bulkJobId=0) can still render via
            the sibling.job snapshot. Real-tblBulkJob siblings fall
            back to the focusedJobId path so future refetches work. */}
        <div className="flex-[2] min-w-0 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-auto border-b border-border">
            <RvJobDetail
              bulkJobId={siblingOverride?.bulkJobId ?? focusedJobId}
              initialJob={siblingOverride?.job ?? null}
              onPickSibling={(sib) => {
                // Real tblBulkJob row + snapshot: keep focusedJobId in
                // sync so ScanList (which is keyed on bulkJobId) also
                // switches, and clear the override. LH legs
                // (bulkJobId=0) can only render via the snapshot
                // override.
                if (sib.bulkJobId > 0 && sib.job) {
                  setFocusedJobId(sib.bulkJobId);
                  setSiblingOverride(null);
                } else {
                  setSiblingOverride(sib);
                }
              }}
            />
          </div>
          <div className="h-64 overflow-auto">
            <RvScanDetailBox selectedJobId={siblingOverride?.bulkJobId ?? focusedJobId} />
          </div>
        </div>
      </div>

      {/* Right-click ctx menu shared by run rows + expanded job rows.
          Opens AssignRouteDialog scoped to the picked run (and job when
          the operator right-clicked a job row). Mirrors the legacy
          linehaulControl.js runListMenu + jobListMenu wiring - both
          collapse to "Assign Courier" only for NP users. */}
      <RowContextMenu
        clientX={ctx?.x ?? null}
        clientY={ctx?.y ?? null}
        title={ctx ? linehaulCtxMenuItems(ctx.target, user.isNetworkPartner, () => undefined).title : undefined}
        items={ctx ? linehaulCtxMenuItems(
          ctx.target,
          user.isNetworkPartner,
          (t) => setAssignTarget(t),
        ).items : []}
        onClose={() => setCtx(null)}
      />

      {assignTarget && (
        <LinehaulAssignBridge
          target={assignTarget}
          runDate={runDate}
          onClose={() => setAssignTarget(null)}
          onSuccess={(summary) => {
            setAssignTarget(null);
            toast.show(summary, 'success');
            // Force the run list + expanded jobs table to pick up the
            // new assignment on the next tick. React Query auto-poll
            // (25s) will refresh eventually, but a manual refetch here
            // makes the operator's assignment visible immediately.
            void runsQ.refetch();
          }}
        />
      )}
    </div>
  );
}

// Linehaul does not have an Inbound/Outbound viewMode toggle, so the
// Assign flow only needs to fetch the run's jobs and drop unmaterialised
// rows (jobId == 0) before handing the tucJob ids to the dialog. This
// bridge component owns the fetch so the dialog itself stays dumb
// (legacy Run Viewer pattern - caller supplies jobIds). Errors surface
// via toast + auto-close, matching how the RvRunContextMenu handles the
// same failure mode.
function LinehaulAssignBridge({
  target,
  runDate,
  onClose,
  onSuccess,
}: {
  target: LinehaulCtxTarget;
  runDate: string;
  onClose: () => void;
  onSuccess: (summary: string) => void;
}) {
  const toast = useToast();
  const [jobIds, setJobIds] = useState<number[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const jobs = await routeViewerService.getRunJobs(target.runId, runDate);
        if (cancelled) return;
        const ids = jobs.map((j) => j.jobId).filter((id) => id > 0);
        if (ids.length === 0) {
          toast.show('No assignable jobs on this run.', 'error');
          onClose();
          return;
        }
        setJobIds(ids);
      } catch (e) {
        if (cancelled) return;
        toast.show(`Failed to load run jobs: ${(e as Error).message}`, 'error');
        onClose();
      }
    })();
    return () => { cancelled = true; };
  }, [target.runId, runDate, toast, onClose]);

  if (!jobIds) return null;
  const runLabel = target.kind === 'run'
    ? `Run ${target.runName ?? `#${target.runId}`}`
    : `Job ${target.jobNumber ?? `#${target.bulkJobId}`}`;
  return (
    <AssignRouteDialog
      jobIds={jobIds}
      runLabel={runLabel}
      anchorJobId={target.kind === 'job' ? target.bulkJobId : undefined}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
}

// Small header helper. Renders a clickable <th> with the sort arrow
// pulled from `sortIndicator`. Keeps the JSX in the main table
// readable and consistent across the run + jobs tables.
function SortableTh({
  label, field, sort, onClick, align, width,
}: {
  label: string;
  field: string;
  sort: ListSort | null;
  onClick: () => void;
  align?: 'left' | 'center';
  width?: string;
}) {
  const alignClass = align === 'center' ? 'text-center' : '';
  return (
    <th
      className={`px-2 py-1 cursor-pointer hover:text-text-primary ${alignClass} ${width ?? ''}`.trim()}
      onClick={onClick}
      role="columnheader"
      aria-sort={
        sort?.field === field
          ? (sort.direction === 'asc' ? 'ascending' : 'descending')
          : 'none'
      }
    >
      {label}{sortIndicator(sort, field)}
    </th>
  );
}

function LinehaulRow({
  row, expanded, runDate, jobSort, onJobHeader, searchNeedle, clientLabelSet,
  onToggle, onSelectJob, focusedJobId, clientIds, speedIds, onOpenContextMenu,
}: {
  row: RunRow;
  expanded: boolean;
  runDate: string;
  jobSort: ListSort | null;
  onJobHeader: (field: string) => () => void;
  searchNeedle: string;
  clientLabelSet: Set<string>;
  onToggle: () => void;
  onSelectJob: (id: number) => void;
  focusedJobId: number | null;
  clientIds: string[];
  speedIds: string[];
  onOpenContextMenu: (target: LinehaulCtxTarget, x: number, y: number) => void;
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
  const jobs = (jobsQ.data ?? []) as JobRow[];

  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      if (clientLabelSet.size) {
        const code = (j.clientCode ?? '').toLowerCase();
        // Label match. The lookup labels for clients are client codes
        // in this SP, so a plain equality set membership suffices.
        if (!clientLabelSet.has(code)) return false;
      }
      if (!rowMatches(searchNeedle, [
        j.jobNumber, j.clientCode, j.toAddress, j.pallet, j.pickedUp,
      ])) return false;
      return true;
    });
  }, [jobs, clientLabelSet, searchNeedle]);

  const sortedJobs = useMemo(
    () => sortBy(filteredJobs, jobSort, jobFieldGetter),
    [filteredJobs, jobSort],
  );

  return (
    <>
      <tr
        className="border-b border-border/50 hover:bg-surface-cream/60"
        onContextMenu={(e) => {
          // stopPropagation prevents ancestor / body-level listeners
          // from swallowing the event before React's synthetic dispatch.
          // Mirrors the JobsList right-click pattern.
          e.preventDefault();
          e.stopPropagation();
          onOpenContextMenu(
            { kind: 'run', runId: row.id, runName: row.name },
            e.clientX,
            e.clientY,
          );
        }}
      >
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
        <td className="px-2 py-1">
          <button
            type="button"
            disabled={row.toDepotId == null || !row.name}
            title={row.toDepotId == null || !row.name
              ? 'Missing depot / run name for this row'
              : 'Print labels for this run'}
            onClick={(e) => {
              e.stopPropagation();
              void printLinehaulLabels({
                bookDate: runDate,
                depotId: row.toDepotId,
                runName: row.name,
                clientIds: clientIds.join(',') || undefined,
                speedIds: speedIds.join(',') || undefined,
              });
            }}
            className="text-[11px] px-2 py-0.5 rounded bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/30 hover:bg-brand-cyan/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Labels
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={11} className="px-3 py-2 bg-slate-50/60 border-b border-border">
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
                  <tr className="text-left text-text-muted select-none">
                    <SortableTh label="Client" field="clientCode" sort={jobSort} onClick={onJobHeader('clientCode')} />
                    <SortableTh label="Job #" field="jobNumber" sort={jobSort} onClick={onJobHeader('jobNumber')} />
                    <SortableTh label="To" field="toAddress" sort={jobSort} onClick={onJobHeader('toAddress')} />
                    <SortableTh label="Pallet" field="pallet" sort={jobSort} onClick={onJobHeader('pallet')} />
                    <SortableTh label="Items" field="items" sort={jobSort} onClick={onJobHeader('items')} align="center" />
                    <SortableTh label="Picked" field="pickedUp" sort={jobSort} onClick={onJobHeader('pickedUp')} />
                    <th className="px-1 py-0.5">Scanned</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedJobs.map((j) => (
                    <tr
                      key={j.bulkJobId}
                      onClick={() => onSelectJob(j.bulkJobId)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onOpenContextMenu(
                          {
                            kind: 'job',
                            runId: row.id,
                            bulkJobId: j.bulkJobId,
                            jobNumber: j.jobNumber,
                          },
                          e.clientX,
                          e.clientY,
                        );
                      }}
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
                      <td className="px-1 py-0.5">
                        <ScanHistoryChips raw={j.scanHistory} />
                      </td>
                    </tr>
                  ))}
                  {sortedJobs.length === 0 && (
                    <tr>
                      <td className="px-1 py-2 text-text-muted italic" colSpan={7}>
                        No jobs match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// Inline scan-history chip strip for the expanded jobs table's Scanned
// cell. Legacy analogue: `parseScanHistory` in linehaulControl.js +
// `ng-repeat` over the parsed array in linehaulView.html. Chip colour
// classes reuse the existing status palette (emerald / amber / red /
// slate) so the strip visually matches the run load bar without a new
// design token. Renders a compact "-" when the SP produced an empty
// history so the column never appears blank.
function ScanHistoryChips({ raw }: { raw: string | null | undefined }) {
  const entries = useMemo(() => parseScanHistory(raw), [raw]);
  if (entries.length === 0) return <span className="text-text-muted">-</span>;
  return (
    <div className="flex flex-wrap gap-0.5" data-testid="scan-history-chips">
      {entries.map((e, i) => {
        const tone = scanChipTone(e.ScanType);
        const cls = tone === 'green'
          ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
          : tone === 'red'
            ? 'bg-red-100 text-red-800 border-red-200'
            : 'bg-slate-100 text-slate-700 border-slate-200';
        const title = `${e.ScanType ?? ''}${e.Courier ? ` - ${e.Courier}` : ''}${
          e.ScanDateTime ? ` (${e.ScanDateTime})` : ''
        }`;
        return (
          <span
            key={`${e.ScanType}-${i}`}
            title={title}
            data-scan-tone={tone}
            className={`inline-block px-1 py-0 rounded border text-[9px] ${cls}`}
          >
            {e.ScanType ?? '?'}
          </span>
        );
      })}
    </div>
  );
}
