import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelGroupHandle } from 'react-resizable-panels';
import { useAuth } from '../../context/AuthContext';
import { useAutoPoll } from '../../hooks/useAutoPoll';
import { useHotkeys } from '../../hooks/useHotkeys';
import { useRouteViewerRuns } from '../../hooks/queries/useRouteViewerRuns';
import { useRouteViewerLookups } from '../../hooks/queries/useRouteViewerLookups';
import { tenantDateFromSpString, tenantTimeFromSpString, tenantTodayYmd } from '../../lib/tenantDate';
import { RvFilterBar, type FilterState } from '../../components/route-viewer/RvFilterBar';
import { RvRunList } from '../../components/route-viewer/RvRunList';
import { matchesViewMode, type ViewMode } from '../../lib/runViewerViewMode';
import { RvJobDetail } from '../../components/route-viewer/RvJobDetail';
import { RvRunContextMenu } from '../../components/route-viewer/RvRunContextMenu';
import { RvJobContextMenu } from '../../components/route-viewer/RvJobContextMenu';
import { PrintRunSortModeDialog, type PrintRunSortMode } from '../../components/route-viewer/PrintRunSortModeDialog';
import { RvBox } from '../../components/route-viewer/RvBox';
import { RvOverviewBox } from '../../components/route-viewer/RvOverviewBox';
import { RvRunListLite } from '../../components/route-viewer/RvRunListLite';
import { RvMapBox } from '../../components/route-viewer/RvMapBox';
import { RvScanDetailBox } from '../../components/route-viewer/RvScanDetailBox';
import { RvCouriersBox } from '../../components/route-viewer/RvCouriersBox';
import { RvClientIntelBox } from '../../components/route-viewer/RvClientIntelBox';
import { RvUtilityActions } from '../../components/route-viewer/RvUtilityActions';
import { TopUpDialog } from '../../components/route-viewer/TopUpDialog';
import { DEFAULT_LAYOUT, type CockpitLayout } from '../../lib/layouts';
import { routeViewerService } from '../../services/routeViewerService';
import { useToast } from '../../context/ToastContext';

// Route Viewer Home / Run Viewer cockpit.
//
// Layout uses react-resizable-panels (same library the Routes cockpit
// uses) so both surfaces share resize + save-layout UX exactly. Nested
// PanelGroup structure:
//
//   PanelGroup horizontal
//   ├── Panel Left (Overview + RunList stacked)
//   ├── PanelResizeHandle
//   ├── Panel Middle (RunJobs + JobDetail stacked)
//   ├── PanelResizeHandle
//   ├── Panel Slim (PreAssigned + Returns + Exceptions stacked)
//   ├── PanelResizeHandle
//   └── Panel Right (Map + ScanDetail stacked)
//
// Sizes are read/written via imperative refs on Save / Apply so the
// Layout dropdown captures the actual current arrangement. Persistence
// piggybacks on the same lib/layouts.ts store the Routes cockpit uses,
// scoped to 'home' so Route Viewer + Route Builder don't collide.
export default function RunViewer() {
  const user = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const initialDate = useMemo(
    () => tenantTodayYmd({ isUsTenant: user.isUsTenant, timeZone: user.timeZone }),
    [user.isUsTenant, user.timeZone],
  );

  // Tier-2 item 9: filter persistence via localStorage scoped to the
  // current tenant + operator so different users don't clobber each
  // other's filter state. runDate is intentionally NOT persisted (each
  // session should default to today unless the URL says otherwise).
  const filterStorageKey = `rv-filters:${user.currentTenantId ?? 0}:${user.email ?? 'anon'}`;
  const loadStoredFilters = (): Partial<FilterState> => {
    try {
      const raw = window.localStorage.getItem(filterStorageKey);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  };
  const stored = loadStoredFilters();

  const [filters, setFilters] = useState<FilterState>({
    runDate: searchParams.get('runDate') ?? initialDate,
    clientIds: stored.clientIds ?? [],
    regionIds: stored.regionIds ?? [],
    speedIds: stored.speedIds ?? [],
    courierId: (stored as any).courierId ?? null,
    activeRegionsOnly: stored.activeRegionsOnly ?? true,
    availableCouriersOnly: (stored as any).availableCouriersOnly ?? false,
  });
  const [viewMode, setViewMode] = useState<ViewMode>((stored as any).viewMode ?? 'Combined');
  const [selectedRunIds, setSelectedRunIds] = useState<number[]>([]);
  // Selection identity for the middle-pane Run Jobs grid uses
  // tucJob.ucjbID (BulkJob.jobId), NOT tblBulkJob.BulkJobID. Synthetic
  // Route runs have no tblBulkJob row so RVW_stpBulkRunJobs emits
  // BulkJobID as NULL and the C# mapper coerces it to 0. Keying
  // selection on bulkJobId therefore makes every row match at once
  // (`selectedJobId === 0` is true for every row) and the JobDetail
  // find() sticks on whichever synthetic row sorts first. jobId is
  // guaranteed unique per row on both real-bulk and synthetic-route
  // branches, so keying on it fixes both symptoms.
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; runId: number } | null>(null);
  const [topUpOpen, setTopUpOpen] = useState(false);
  // Multi-select on the runJobs grid so bulk actions from the job
  // context menu operate on N jobs. Ctrl/Cmd-click toggles; plain
  // click replaces. Selection is scoped to the currently drilled run
  // - switching runs clears it. Same jobId keying as selectedJobId
  // above so synthetic rows can be individually multi-selected.
  const [selectedJobIds, setSelectedJobIds] = useState<number[]>([]);
  const [jobCtxMenu, setJobCtxMenu] = useState<{ x: number; y: number } | null>(null);
  // Arrow-key navigation follows whichever cockpit table the operator
  // last interacted with. Mirrors the legacy homeView.html:438-457
  // `.activeTable` behaviour: Up/Down moves the selection cursor within
  // that table's currently-visible + sorted row set. Default = Run List
  // so a fresh page has arrows drive the primary list right away.
  type FocusedTable = 'runList' | 'runJobs' | 'preAssigned' | 'returns' | 'exceptions';
  const [focusedTable, setFocusedTable] = useState<FocusedTable>('runList');
  // Per-table id order the child tables report back after their own
  // sort / filter passes. Arrow keys index into whichever ref matches
  // the currently focused table so navigation lines up with what the
  // operator sees on screen.
  const runListVisibleRef = useRef<number[]>([]);
  const preAssignedVisibleRef = useRef<number[]>([]);
  const returnsVisibleRef = useRef<number[]>([]);
  const exceptionsVisibleRef = useRef<number[]>([]);
  // Sibling-tab override for LH1..LH4 / LHP legs that don't have a
  // tblBulkJob row. Clicking their tab sets this to the sibling
  // payload (from RVW_stpJobSiblings); JobDetail renders directly
  // from it. Cleared on middle-pane job change / run change.
  const [siblingOverride, setSiblingOverride] = useState<import('../../services/routeViewerService').SiblingJob | null>(null);
  // Courier iframe overlay (legacy jobDetail.tpl:390-393 currentCourier
  // block). When set from an RvCouriersBox row click, RvJobDetail
  // renders a Google Maps embed for the courier INSTEAD of the normal
  // job detail. Cleared whenever the operator picks a job row so the
  // detail flow resumes cleanly.
  const [selectedCourier, setSelectedCourier] = useState<{ code: string; name: string } | null>(null);

  // Imperative refs on each PanelGroup so the Layout menu can snapshot
  // current sizes for Save and reset them on Apply.
  const hRef = useRef<ImperativePanelGroupHandle | null>(null);
  const leftVRef = useRef<ImperativePanelGroupHandle | null>(null);
  const midVRef = useRef<ImperativePanelGroupHandle | null>(null);
  const slimVRef = useRef<ImperativePanelGroupHandle | null>(null);
  const rightVRef = useRef<ImperativePanelGroupHandle | null>(null);
  // Anchor for the Client Intel jump icon in the JobDetail header.
  // Wrapper div around <RvClientIntelBox> gets a plain HTMLDivElement
  // ref so we can scrollIntoView on click, matching legacy
  // homeView.html:128-138 getClientIntel(mobile) behaviour.
  const clientIntelRef = useRef<HTMLDivElement | null>(null);

  const { clientInternal, multipleClients } = useRouteViewerLookups(filters.runDate, false);

  const runsQuery = useRouteViewerRuns({
    runDate: filters.runDate,
    clientInternal,
    multipleClients,
    clientIds: filters.clientIds,
    regionIds: filters.regionIds,
    speedIds: filters.speedIds,
    group: viewMode,
  });

  const singleRunId = selectedRunIds.length === 1 ? selectedRunIds[0] : null;
  // Filter panel state is forwarded to the middle-pane Run Jobs SP so it
  // applies the same region / speed / client narrowing the Run List
  // already does. Legacy runViewer passes these; without them
  // RVW_stpBulkRunJobs returns every row the run touches, causing e.g.
  // Reno-depot LHPs to surface under a Burbank-only region filter. Query
  // key includes the filters so a filter change refetches instead of
  // serving stale un-scoped rows from cache.
  const runJobsQuery = useQuery({
    queryKey: [
      'rv-run-jobs', singleRunId, filters.runDate, viewMode,
      filters.regionIds.join(','), filters.speedIds.join(','), filters.clientIds.join(','),
      filters.courierId ?? 0,
    ],
    queryFn: () => routeViewerService.getRunJobs(singleRunId!, filters.runDate, {
      group: viewMode,
      regionIds: filters.regionIds,
      speedIds: filters.speedIds,
      clientIds: filters.clientIds,
      courierId: filters.courierId,
    }),
    enabled: singleRunId != null,
    staleTime: 5_000,
  });

  // Tier-2 items 8 + 15: when 2+ runs selected, fetch jobs for the
  // extra runs so the map can render every selected run's pins with
  // its own tint colour. Uses useQueries (not useQuery in a loop) so
  // hook count is stable across selection changes.
  const extraRunIds = selectedRunIds.length > 1 ? selectedRunIds.slice(1) : [];
  const extraRunJobsQueries = useQueries({
    queries: extraRunIds.map((rid) => ({
      // Same tenant-scoped key shape as the primary run's query so a
      // filter change also refetches the extra multi-selected runs; and
      // same forwarded filters so all selected runs' pins are narrowed
      // to the current region / speed / client / courier.
      queryKey: [
        'rv-run-jobs', rid, filters.runDate, viewMode,
        filters.regionIds.join(','), filters.speedIds.join(','), filters.clientIds.join(','),
        filters.courierId ?? 0,
      ],
      queryFn: () => routeViewerService.getRunJobs(rid, filters.runDate, {
        group: viewMode,
        regionIds: filters.regionIds,
        speedIds: filters.speedIds,
        clientIds: filters.clientIds,
        courierId: filters.courierId,
      }),
      staleTime: 5_000,
    })),
  });
  const extraRunJobs = extraRunIds
    .map((rid, i) => ({ runId: rid, jobs: (extraRunJobsQueries[i]?.data as any[]) ?? [] }))
    .filter((g) => g.jobs.length > 0);

  useAutoPoll(
    () => {
      runsQuery.refetch();
      queryClient.invalidateQueries({ queryKey: ['rv-overview', filters.runDate] });
      if (singleRunId != null) {
        queryClient.invalidateQueries({ queryKey: ['rv-run-jobs', singleRunId] });
      }
    },
    25,
    true,
  );

  useEffect(() => {
    const jobNumber = searchParams.get('jobNumber');
    if (!jobNumber || runsQuery.isLoading) return;
    routeViewerService.searchByJobNumber(jobNumber).then((match: any) => {
      if (!match) return;
      // selectedJobId is jobId (tucJob.ucjbID), not bulkJobId - see the
      // state-declaration comment for the reason.
      setSelectedJobId(match.jobId ?? null);
      if (match.bulkRunId != null) setSelectedRunIds([match.bulkRunId]);
      const next = new URLSearchParams(searchParams);
      next.delete('jobNumber');
      setSearchParams(next, { replace: true });
    }).catch(() => {});
  }, [searchParams, runsQuery.isLoading, setSearchParams]);

  // Anchor for shift-range selection on the Run List. Set to the id
  // of the last plain-click. Shift+click extends selection from anchor
  // to clicked row (inclusive) using the currently-visible run order.
  const runAnchorRef = useRef<number | null>(null);
  const onSelectRun = useCallback((id: number, mods: { ctrl: boolean; shift: boolean }) => {
    setSelectedRunIds((prev) => {
      if (mods.shift && runAnchorRef.current != null) {
        // Tier-3 item 18: shift-range across the sorted run list. We
        // read the list off runsQuery.data at call time so the range
        // matches whatever the operator currently sees.
        const runs = runsQuery.data ?? [];
        const anchorIdx = runs.findIndex((r) => r.id === runAnchorRef.current);
        const clickedIdx = runs.findIndex((r) => r.id === id);
        if (anchorIdx >= 0 && clickedIdx >= 0) {
          const [lo, hi] = anchorIdx < clickedIdx ? [anchorIdx, clickedIdx] : [clickedIdx, anchorIdx];
          const ids = runs.slice(lo, hi + 1).map((r) => r.id);
          return ids;
        }
        return prev;
      }
      if (mods.ctrl) {
        runAnchorRef.current = id;
        return prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id];
      }
      runAnchorRef.current = id;
      return [id];
    });
    setSelectedJobId(null);
    setSelectedJobIds([]);   // clear job multi-select on run change
    setSiblingOverride(null);
  }, [runsQuery.data]);

  const onSelectJob = useCallback((jobId: number, mods: { ctrl: boolean }) => {
    if (mods.ctrl) {
      setSelectedJobIds((prev) => prev.includes(jobId) ? prev.filter((v) => v !== jobId) : [...prev, jobId]);
      setSelectedJobId(jobId);
    } else {
      setSelectedJobIds([jobId]);
      setSelectedJobId(jobId);
    }
    setSiblingOverride(null);   // primary click clears LH-leg override
    setSelectedCourier(null);   // primary click closes the courier map overlay
    setFocusedTable('runJobs');
  }, []);

  // Per-run-table select wrapper: identical selection semantics but
  // also stamps `focusedTable` so Up/Down arrows navigate the table
  // the operator just clicked on. Legacy `.activeTable` selector was
  // "whichever table last received a mouse-down" - same idea, typed.
  const onSelectRunFromTable = useCallback((table: FocusedTable) => {
    return (id: number, mods: { ctrl: boolean; shift: boolean }) => {
      setFocusedTable(table);
      onSelectRun(id, mods);
    };
  }, [onSelectRun]);

  const onJobContextMenu = useCallback((e: React.MouseEvent, jobId: number) => {
    e.preventDefault();
    // If right-clicked row isn't already in the selection, replace the
    // selection with just this row (matches legacy UX + master 7.10).
    setSelectedJobIds((prev) => (prev.includes(jobId) ? prev : [jobId]));
    setSelectedJobId(jobId);
    setJobCtxMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const onContextMenu = useCallback((e: React.MouseEvent, runId: number) => {
    e.preventDefault();
    setSelectedRunIds((prev) => (prev.includes(runId) ? prev : [runId]));
    setCtxMenu({ x: e.clientX, y: e.clientY, runId });
  }, []);

  const onFiltersChange = useCallback((next: FilterState) => {
    setFilters(next);
    const params = new URLSearchParams(searchParams);
    params.set('runDate', next.runDate);
    setSearchParams(params, { replace: true });
    // Tier-2 item 9: persist filter selections (not runDate).
    try {
      window.localStorage.setItem(filterStorageKey, JSON.stringify({
        clientIds: next.clientIds,
        regionIds: next.regionIds,
        speedIds: next.speedIds,
        courierId: next.courierId,
        activeRegionsOnly: next.activeRegionsOnly,
        availableCouriersOnly: next.availableCouriersOnly,
        viewMode,
      }));
    } catch { /* quota / disabled localStorage - skip */ }
  }, [searchParams, setSearchParams, filterStorageKey, viewMode]);

  // Persist viewMode changes too since it lives in the same storage key.
  useEffect(() => {
    try {
      const cur = JSON.parse(window.localStorage.getItem(filterStorageKey) || '{}');
      window.localStorage.setItem(filterStorageKey, JSON.stringify({ ...cur, viewMode }));
    } catch { /* skip */ }
  }, [viewMode, filterStorageKey]);

  // Snapshot the live layout for the Save-current-layout action. Falls
  // back to DEFAULT_LAYOUT arrays if a ref isn't attached yet (should
  // never happen after first paint but stays defensive).
  const snapshotLayout = useCallback((): Pick<CockpitLayout, 'rvHorizontal' | 'rvLeftV' | 'rvMidV' | 'rvSlimV' | 'rvRightV'> => ({
    rvHorizontal: hRef.current?.getLayout() ?? DEFAULT_LAYOUT.rvHorizontal,
    rvLeftV: leftVRef.current?.getLayout() ?? DEFAULT_LAYOUT.rvLeftV,
    rvMidV: midVRef.current?.getLayout() ?? DEFAULT_LAYOUT.rvMidV,
    rvSlimV: slimVRef.current?.getLayout() ?? DEFAULT_LAYOUT.rvSlimV,
    rvRightV: rightVRef.current?.getLayout() ?? DEFAULT_LAYOUT.rvRightV,
  }), []);

  const applyLayout = (layout: CockpitLayout) => {
    if (layout.rvHorizontal) hRef.current?.setLayout(layout.rvHorizontal);
    if (layout.rvLeftV) leftVRef.current?.setLayout(layout.rvLeftV);
    if (layout.rvMidV) midVRef.current?.setLayout(layout.rvMidV);
    if (layout.rvSlimV) slimVRef.current?.setLayout(layout.rvSlimV);
    if (layout.rvRightV) rightVRef.current?.setLayout(layout.rvRightV);
    toast.show(`Applied layout: ${layout.name}`);
  };

  const singleRun = runsQuery.data?.find((r) => r.id === singleRunId) ?? null;
  const rawRunJobs = runJobsQuery.data ?? [];

  // Print Run flow: printer icon on the Run Jobs toolbar opens a small
  // Sort Mode picker (Run Name / Product / Client - legacy parity with
  // labelsForm.tpl); operator's pick fires POST /runviewer/labels/bulk-jobs
  // with the current filter set + selected sortMode and opens the
  // returned PDF in a new tab. `printRunSubmitting` locks the dialog
  // while the fetch is in flight so a double-click cannot fire two
  // label requests. Fix 2026-09-18 for George's Medical-Prod report
  // that the Print Run + Print Job Report buttons were placeholder
  // scaffolds that did not call any endpoint.
  const [printRunOpen, setPrintRunOpen] = useState(false);
  const [printRunSubmitting, setPrintRunSubmitting] = useState(false);
  const doPrintRun = async (sortMode: PrintRunSortMode) => {
    if (printRunSubmitting) return;
    setPrintRunSubmitting(true);
    try {
      const bulkJobIds = rawRunJobs.map((j) => j.bulkJobId).filter((n) => n > 0);
      const blob = await routeViewerService.printRunLabelsPdf({
        bookDate: filters.runDate,
        sortMode,
        runName: singleRun?.name ?? null,
        bulkJobIds: bulkJobIds.length > 0 ? bulkJobIds.join(',') : null,
        clientIds: filters.clientIds.length > 0 ? filters.clientIds.join(',') : null,
        regionIds: filters.regionIds.length > 0 ? filters.regionIds.join(',') : null,
        speedIds: filters.speedIds.length > 0 ? filters.speedIds.join(',') : null,
      });
      setPrintRunOpen(false);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (e) {
      toast.show(`Print run failed: ${(e as Error).message}`, 'error');
    } finally {
      setPrintRunSubmitting(false);
    }
  };

  // Job Detail print: single-job label PDF (Mode 1). Uses the currently
  // selected tucJob id (selectedJobId), since the backend GET endpoint
  // keys off ucjbID. Bulk-job-only rows (jobId == 0, synthetic Recurring
  // Route rows before materialisation) fall through with a toast rather
  // than firing a call that would 404 on the SP.
  const doPrintJobReport = async () => {
    if (!selectedJobId || selectedJobId <= 0) {
      toast.show('Select a job with a live tucJob row first.', 'error');
      return;
    }
    try {
      const blob = await routeViewerService.printSingleJobLabelPdf(selectedJobId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (e) {
      toast.show(`Print job report failed: ${(e as Error).message}`, 'error');
    }
  };

  // Audit 7.4: client-side courier filter. Runs SP doesn't take a
  // courier param; look up the selected courier's code from the same
  // courier list the FilterBar dropdown reads, then keep only runs
  // whose courierCode matches. Falls back to all runs when the
  // selected courier isn't in the current-day list.
  const courierListForFilter = useQuery({
    // Same tenant-scoped key shape as RvFilterBar so both share cache
    // instead of duplicate-fetching, and both isolate per-tenant.
    queryKey: ['rv-filter-couriers', user.currentTenantId ?? 0, filters.runDate],
    queryFn: () => routeViewerService.getActiveCouriers(filters.runDate),
    enabled: !user.isNetworkPartner && filters.courierId != null && !!filters.runDate,
    staleTime: 30_000,
  });
  const selectedCourierCode = filters.courierId != null
    ? courierListForFilter.data?.find((c) => c.courierId === filters.courierId)?.code ?? null
    : null;
  const visibleRuns = useMemo(() => {
    const all = runsQuery.data ?? [];
    if (!selectedCourierCode) return all;
    return all.filter((r) => r.courierCode === selectedCourierCode);
  }, [runsQuery.data, selectedCourierCode]);

  // Tier-2 item 15: multi-run colour tinting. When operator has 2+
  // selected runs, assign each a distinct hue from an 8-colour palette
  // so Run List rows + map pins line up visually. Palette keeps the
  // brand-cyan default for single-select so the everyday UX is
  // unchanged. Order = selection order for stable colour identity
  // across re-renders.
  const runColorMap = useMemo(() => {
    const map: Record<number, string> = {};
    if (selectedRunIds.length <= 1) return map;
    const palette = ['#0891b2', '#7c3aed', '#f59e0b', '#dc2626', '#059669', '#d946ef', '#0ea5e9', '#65a30d'];
    selectedRunIds.forEach((id, i) => { map[id] = palette[i % palette.length]; });
    return map;
  }, [selectedRunIds]);

  // Tier-2 item 14: Run Jobs grid sort + filter. Cancelled (jobStatus =
  // 'V') and multibox child rows (MultiboxParentID != null) are hidden
  // by default per master spec because they clutter the primary run
  // view. Operators can toggle them on individually. Sort is
  // client-side over the fetched page.
  const [rjSort, setRjSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'runOrder', dir: 'asc' });
  const [rjShowCancelled, setRjShowCancelled] = useState(false);
  const [rjShowMultibox, setRjShowMultibox] = useState(false);
  const toggleRjSort = (key: string) => {
    setRjSort((cur) => (cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };
  const runJobs = useMemo(() => {
    // Route Viewer view-mode filter. Exact port of legacy homeControl.js
    // `showJobInRun` (line 484-501) + the `classifyJobKind` coord-shape
    // fallback (line 191-198). Full recap:
    //
    //   Combined = show every row the SP returned (no client-side filter).
    //   Inbound  = row's jobNumber ends 'LHP'  (pickup-leg children only).
    //   Outbound = row is NOT LHP AND its coord shape is not pickup-only.
    //              A row with pickup coords but no delivery coords is a
    //              recurring-route pickup-only leg (Steve's Neogenomics
    //              pattern) - it belongs on the Inbound view, so drop it
    //              from Outbound. Any row with both coords or delivery
    //              coords keeps.
    //
    // Note on umbrella parents: RVW_stpBulkRunJobs already applies
    // `NOT EXISTS (child)` to drop umbrella parents that have live
    // children, so the frontend never sees them. Orphan leaf jobs
    // without an LHP/DEL suffix (e.g. medical-prod RNO200's P2983 - a
    // stand-alone single-leg job) are NOT umbrella parents; legacy
    // shows them on Combined + Outbound and we do the same.
    const filtered = rawRunJobs.filter((j: any) => {
      if (!rjShowCancelled && j.jobStatus === 'V') return false;
      if (!rjShowMultibox && j.multiboxParentId != null && j.multiboxParentId !== 0) return false;
      // Direction filter lives in lib/runViewerViewMode.ts so the Assign
      // Route + Transfer Route flows apply the same predicate. Without
      // that shared helper, the display list and the assign scope drift
      // apart (Medical-Prod 2026-09-18 report).
      return matchesViewMode(j, viewMode);
    });
    const sorted = filtered.slice().sort((a: any, b: any) => {
      const va = (a as any)[rjSort.key];
      const vb = (b as any)[rjSort.key];
      const nulla = va == null || va === '';
      const nullb = vb == null || vb === '';
      if (nulla && nullb) return 0;
      if (nulla) return 1;
      if (nullb) return -1;
      if (va < vb) return rjSort.dir === 'asc' ? -1 : 1;
      if (va > vb) return rjSort.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [rawRunJobs, rjShowCancelled, rjShowMultibox, rjSort, viewMode]);

  // Currently-selected row + its bulkJobId. selectedJobId is jobId
  // (tucJob.ucjbID) per the state-declaration note; bulkJobId is only
  // meaningful for downstream fetches on real-bulk rows (RvJobDetail
  // refresh, RvScanDetailBox scans, TopUpDialog). Synthetic rows have
  // bulkJobId=0 and those fetches short-circuit or fall back to the
  // in-memory row payload.
  const selectedRow = selectedJobId != null
    ? runJobs.find((j) => j.jobId === selectedJobId) ?? null
    : null;
  const selectedRowBulkJobId = selectedRow?.bulkJobId ?? null;

  // Currently-selected job payload used by the right-column Client
  // Intel box to look up per-mobile intel. Picks the sibling override
  // first (LH legs live only in the sibling payload) then falls back
  // to the primary runJobs cache entry. MUST be declared after
  // `runJobs` above - referencing it earlier hits a TDZ error at
  // render time the moment selectedJobId becomes non-null.
  const selectedJobDetail = siblingOverride?.job ?? selectedRow;

  // Arrow-key nav resolves the visible id list for the focused table
  // and moves single-select to the prev/next row. On first press (no
  // current selection) we jump to the head/tail of the list so the
  // operator can start driving with the keyboard from a fresh page.
  // Declared here (not near the other selection callbacks) because
  // it depends on `runJobs` which is a downstream memo - moving it up
  // would trip the TDZ warning called out above.
  const moveArrow = useCallback((dir: 1 | -1) => {
    const idsFor = (t: FocusedTable): number[] => {
      switch (t) {
        case 'runList':      return runListVisibleRef.current;
        case 'preAssigned':  return preAssignedVisibleRef.current;
        case 'returns':      return returnsVisibleRef.current;
        case 'exceptions':   return exceptionsVisibleRef.current;
        case 'runJobs':      return [];   // handled separately below
      }
    };
    if (focusedTable === 'runJobs') {
      // jobId keys (see selectedJobId note) so arrow-nav lands on the
      // unique row even on synthetic runs where bulkJobId is 0 for all.
      const ids = runJobs.map((j) => j.jobId);
      if (ids.length === 0) return;
      const cur = selectedJobId != null ? ids.indexOf(selectedJobId) : -1;
      const next = cur < 0 ? (dir === 1 ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, cur + dir));
      const nextId = ids[next];
      if (nextId != null && nextId !== selectedJobId) {
        setSelectedJobIds([nextId]);
        setSelectedJobId(nextId);
        setSiblingOverride(null);
      }
      return;
    }
    const ids = idsFor(focusedTable);
    if (ids.length === 0) return;
    const curId = selectedRunIds.length === 1 ? selectedRunIds[0] : null;
    const cur = curId != null ? ids.indexOf(curId) : -1;
    const next = cur < 0 ? (dir === 1 ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, cur + dir));
    const nextId = ids[next];
    if (nextId != null && nextId !== curId) {
      runAnchorRef.current = nextId;
      setSelectedRunIds([nextId]);
      setSelectedJobId(null);
      setSelectedJobIds([]);
      setSiblingOverride(null);
    }
  }, [focusedTable, runJobs, selectedJobId, selectedRunIds]);

  useHotkeys({
    onArrowUp: () => moveArrow(-1),
    onArrowDown: () => moveArrow(1),
  });

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <RvFilterBar
        value={filters}
        onChange={onFiltersChange}
        onRefresh={() => runsQuery.refetch()}
        isRefreshing={runsQuery.isFetching}
        extraActions={
          <RvUtilityActions
            runDate={filters.runDate}
            onPrint={(k, payload) => {
              // Labels are POST /api/runviewer/labels/bulk-jobs (PDF
              // via LabelRequest.SortMode) so branch out of the
              // report-slug flow. Payload carries the operator-picked
              // sort mode from LabelsSortPickerModal.
              if (k === 'labels') {
                const sortMode = (payload as { sortMode?: number } | undefined)?.sortMode ?? 1;
                routeViewerService.printLabelsWithSort({
                  bookDate: filters.runDate,
                  sortMode,
                  clientIds: filters.clientIds.length > 0 ? filters.clientIds.join(',') : null,
                  regionIds: filters.regionIds.length > 0 ? filters.regionIds.join(',') : null,
                  speedIds: filters.speedIds.length > 0 ? filters.speedIds.join(',') : null,
                }).then(() => toast.show('Print queued for labels.'))
                  .catch((e) => toast.show(`Print failed: ${(e as Error).message}`, 'error'));
                return;
              }
              // Map dropdown-item key → report endpoint slug. Woop
              // stays 501 until the Section Z decision lands.
              const slugs: Record<string, string> = {
                runAllocation: 'run-allocation',
                missingScan: 'missing-scan',
                missingRunScan: 'missing-run-scan',
                missingTransitScan: 'missing-transit-scan',
                woop: 'woop-run-number',
              };
              const slug = slugs[k];
              if (!slug) return;
              // Woop picker carries fromDate + toDate; other slugs use
              // the cockpit runDate for both bounds.
              const woopWindow = k === 'woop'
                ? (payload as { fromDate?: string; toDate?: string } | undefined)
                : undefined;
              const params = new URLSearchParams({
                runDate: filters.runDate,
                ...(woopWindow?.fromDate ? { fromDate: woopWindow.fromDate } : {}),
                ...(woopWindow?.toDate ? { toDate: woopWindow.toDate } : {}),
                ...(filters.clientIds.length > 0 ? { clientIds: filters.clientIds.join(',') } : {}),
                ...(filters.regionIds.length > 0 ? { regions: filters.regionIds.join(',') } : {}),
                ...(filters.speedIds.length > 0 ? { speeds: filters.speedIds.join(',') } : {}),
              });
              // Same-origin download: navigate a hidden anchor so
              // Content-Disposition drives Save-As dialog. Falls back
              // to window.open on browsers that block programmatic .click.
              const url = `/api/runviewer/reports/${slug}?${params.toString()}`;
              const a = document.createElement('a');
              a.href = url;
              a.rel = 'noopener';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              toast.show(`Downloading ${k}...`);
            }}
            onTopUp={() => {
              if (selectedJobId == null) { toast.show('Pick a job first to top it up.'); return; }
              if (selectedRowBulkJobId == null || selectedRowBulkJobId <= 0) {
                toast.show('Cannot top up a route-only job (no bulk row).');
                return;
              }
              setTopUpOpen(true);
            }}
            snapshotLayout={snapshotLayout}
            onApplyLayout={applyLayout}
          />
        }
      />

      <div className="flex-1 min-h-0">
        <PanelGroup direction="horizontal" ref={hRef}>
          {/* Left column: Overview + RunList */}
          <Panel defaultSize={DEFAULT_LAYOUT.rvHorizontal![0]} minSize={12}>
            <PanelGroup direction="vertical" ref={leftVRef}>
              <Panel defaultSize={DEFAULT_LAYOUT.rvLeftV![0]} minSize={15}>
                <RvOverviewBox
                  runDate={filters.runDate}
                  onRegionPick={(regionId) => onFiltersChange({ ...filters, regionIds: [regionId] })}
                  clientIds={filters.clientIds}
                  regionIds={filters.regionIds}
                  speedIds={filters.speedIds}
                />
              </Panel>
              <PanelResizeHandle className="h-1" />
              <Panel defaultSize={DEFAULT_LAYOUT.rvLeftV![1]} minSize={20}>
                <RvBox title="Run List">
                  <RvRunList
                    runs={visibleRuns}
                    selectedIds={selectedRunIds}
                    onSelect={onSelectRunFromTable('runList')}
                    onContextMenu={onContextMenu}
                    viewMode={viewMode}
                    onViewModeChange={setViewMode}
                    isLoading={runsQuery.isLoading}
                    runColorMap={runColorMap}
                    onVisibleRunsChange={(ids) => { runListVisibleRef.current = ids; }}
                    onDropCourier={(runId, courierCode) => {
                      const run = visibleRuns.find((r) => r.id === runId);
                      const from = run?.courierCode ?? null;
                      routeViewerService.preAssignRun(runId, courierCode, from)
                        .then(() => {
                          toast.show(`Pre-assigned ${courierCode} to run ${run?.name ?? runId}.`);
                          runsQuery.refetch();
                        })
                        .catch((err) => toast.show(`Assign failed: ${err.message}`));
                    }}
                    onDropRunJobs={(toRunId, fromRunId, jobIds) => {
                      // No-op when the drop lands on the source run;
                      // the transfer-route SP would just churn otherwise.
                      if (toRunId === fromRunId) return;
                      const toRun = visibleRuns.find((r) => r.id === toRunId);
                      routeViewerService.transferRoute({
                        jobIds,
                        toRouteId: toRunId,
                        transferBooking: false,
                        transferZipcodes: false,
                      })
                        .then((res) => {
                          toast.show(
                            `Moved ${res.succeeded} job${res.succeeded === 1 ? '' : 's'} to run ${toRun?.name ?? toRunId}.`,
                          );
                          runsQuery.refetch();
                          if (singleRunId != null) {
                            queryClient.invalidateQueries({ queryKey: ['rv-run-jobs', singleRunId] });
                          }
                        })
                        .catch((err) => toast.show(`Move failed: ${err.message}`));
                    }}
                  />
                </RvBox>
              </Panel>
            </PanelGroup>
          </Panel>

          <PanelResizeHandle className="w-1" />

          {/* Middle column: RunJobs + JobDetail */}
          <Panel defaultSize={DEFAULT_LAYOUT.rvHorizontal![1]} minSize={15}>
            <PanelGroup direction="vertical" ref={midVRef}>
              <Panel defaultSize={DEFAULT_LAYOUT.rvMidV![0]} minSize={15}>
                <RvBox
                  title={singleRun ? `Run - ${singleRun.name ?? singleRun.id}` : 'Run - (select a run)'}
                  actions={
                    <>
                      {/* Tier-2 item 14: cancelled + multibox toggles.
                          Hidden by default (per master spec) so the
                          grid isn't cluttered with V-status jobs or
                          child boxes; operators opt in when needed. */}
                      <label className="flex items-center gap-1 text-[10px] text-text-muted cursor-pointer" title="Show cancelled (V) jobs">
                        <input
                          type="checkbox"
                          checked={rjShowCancelled}
                          onChange={(e) => setRjShowCancelled(e.target.checked)}
                          className="accent-brand-cyan"
                        />
                        Cancelled
                      </label>
                      <label className="flex items-center gap-1 text-[10px] text-text-muted cursor-pointer" title="Show multibox child rows">
                        <input
                          type="checkbox"
                          checked={rjShowMultibox}
                          onChange={(e) => setRjShowMultibox(e.target.checked)}
                          className="accent-brand-cyan"
                        />
                        Multibox
                      </label>
                      <button
                        type="button"
                        title="Print labels for run"
                        onClick={() => {
                          if (singleRunId == null) return;
                          const ids = runJobs.map((j) => j.bulkJobId).filter((n) => n > 0);
                          if (ids.length === 0) { toast.show('No jobs to label.'); return; }
                          routeViewerService.printLabels(ids)
                            .then(() => toast.show(`Print labels queued for ${ids.length} job(s).`))
                            .catch(() => toast.show('Print labels failed - check network.'));
                        }}
                        className="w-6 h-6 flex items-center justify-center rounded hover:bg-black/5 text-text-secondary"
                      >
                        {/* tag icon */}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20.59 13.41 13.41 20.59a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                          <line x1="7" y1="7" x2="7.01" y2="7" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        title="Print run (Sort Mode picker)"
                        onClick={() => {
                          if (singleRunId == null) { toast.show('Select a run first.'); return; }
                          setPrintRunOpen(true);
                        }}
                        className="w-6 h-6 flex items-center justify-center rounded hover:bg-black/5 text-text-secondary"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="6 9 6 2 18 2 18 9" />
                          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                          <rect x="6" y="14" width="12" height="8" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        title="Refresh"
                        onClick={() => runJobsQuery.refetch()}
                        className="w-6 h-6 flex items-center justify-center rounded hover:bg-black/5 text-text-secondary"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="23 4 23 10 17 10" />
                          <polyline points="1 20 1 14 7 14" />
                          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        title="More"
                        className="w-6 h-6 flex items-center justify-center rounded hover:bg-black/5 text-text-secondary"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="12" cy="5" r="1.7" />
                          <circle cx="12" cy="12" r="1.7" />
                          <circle cx="12" cy="19" r="1.7" />
                        </svg>
                      </button>
                    </>
                  }
                >
                  {singleRunId == null && (
                    <div className="p-3 text-xs text-text-muted">Pick a run to see its jobs.</div>
                  )}
                  {singleRunId != null && (
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-surface-white border-b border-border">
                        <tr className="text-left text-text-muted">
                          <SortableTh label="Status" k="jobStatus" cur={rjSort} onClick={toggleRjSort} />
                          <SortableTh label="Client" k="clientCode" cur={rjSort} onClick={toggleRjSort} />
                          <SortableTh label="Job #" k="jobNumber" cur={rjSort} onClick={toggleRjSort} />
                          <SortableTh label="D Date" k="bookDate" cur={rjSort} onClick={toggleRjSort} />
                          <SortableTh label="R Time" k="bookTime" cur={rjSort} onClick={toggleRjSort} />
                          <SortableTh label="Address" k="toAddress" cur={rjSort} onClick={toggleRjSort} />
                          <SortableTh label="City" k="toCity" cur={rjSort} onClick={toggleRjSort} />
                          <SortableTh label="Agent/NP" k="agentName" cur={rjSort} onClick={toggleRjSort} />
                          <SortableTh label="Courier" k="courierName" cur={rjSort} onClick={toggleRjSort} />
                          <SortableTh label="Speed" k="speedName" cur={rjSort} onClick={toggleRjSort} />
                        </tr>
                      </thead>
                      <tbody>
                        {runJobs.map((j) => {
                          // Key selection styling on jobId (tucJob.ucjbID),
                          // not bulkJobId - the latter is 0 for every row
                          // on synthetic Route runs so bulkJobId keying
                          // makes every row appear selected at once.
                          const active = selectedJobId === j.jobId;
                          const multiSel = selectedJobIds.includes(j.jobId);
                          // Legacy tenantDate / tenantDateTime filter behaviour:
                          //   NZ -> dd/MM/yyyy + HH:mm (24h)
                          //   US -> MM/dd/yyyy + h:mm AM/PM (12h)
                          // SP already emits dd/MM/yyyy + HH:mm:ss so the
                          // helpers just re-shape the string per tenant.
                          const dDate = tenantDateFromSpString(j.bookDate, user.isUsTenant) || '-';
                          const rTime = tenantTimeFromSpString(j.bookTime, user.isUsTenant) || '-';
                          // Per-row Address / City resolution, matching
                          // legacy showsPickupSideForRow + runBuilder.tpl:
                          //   Inbound   -> always pickup side.
                          //   Outbound  -> always delivery side.
                          //   Combined  -> per-row: LHP shows pickup,
                          //                everything else shows delivery.
                          // Rolls up to: "LHP row shows pickup" (works
                          // uniformly because Inbound is already LHP-only
                          // and Outbound already excludes LHP).
                          const jnUpper = (j.jobNumber ?? '').trim().toUpperCase();
                          const showPickupSide = jnUpper.endsWith('LHP');
                          const rowAddress = showPickupSide ? (j.fromAddress ?? '-') : (j.toAddress ?? '-');
                          const rowCity = showPickupSide
                            ? (j.fromCity ?? j.fromSuburb ?? '-')
                            : (j.toCity ?? j.toSuburb ?? '-');
                          // Missing-GPS warning per legacy runBuilder.tpl:37,40:
                          // legacy renders a `fa fa-exclamation` next to the
                          // address string when the row's relevant lat is
                          // null. LHP rows check pickup lat (fromLat), other
                          // rows check delivery lat (toLat). Operators use
                          // this to spot jobs that will fail routing before
                          // drilling into the Detail panel. Without it the
                          // grid hides a real dispatch signal.
                          const rowLatMissing = showPickupSide
                            ? (j.pickUpLatitude == null)
                            : (j.toLat == null);
                          return (
                            <tr
                              key={j.jobId}
                              draggable={singleRunId != null && j.bulkJobId > 0}
                              onDragStart={(e) => {
                                // Audit item 20: batch payload = "drop
                                // this whole selection", so include every
                                // multi-selected id when the dragged row
                                // is part of it; otherwise just this row.
                                // selectedJobIds are jobIds (unique) but
                                // the transfer-route payload needs
                                // bulkJobIds; map + drop the zeros so
                                // synthetic rows that can't be
                                // transferred are filtered out.
                                const inSel = selectedJobIds.includes(j.jobId);
                                const jobIds = inSel && selectedJobIds.length > 1
                                  ? selectedJobIds
                                      .map((id) => runJobs.find((row) => row.jobId === id)?.bulkJobId ?? 0)
                                      .filter((bid) => bid > 0)
                                  : (j.bulkJobId > 0 ? [j.bulkJobId] : []);
                                if (jobIds.length === 0) {
                                  e.preventDefault();
                                  return;
                                }
                                e.dataTransfer.setData(
                                  'application/rv-run-jobs',
                                  JSON.stringify({ fromRunId: singleRunId ?? 0, jobIds }),
                                );
                                e.dataTransfer.effectAllowed = 'move';
                                // Legacy homeView.html #draggingItems
                                // floating pill: build a small "N Jobs"
                                // element off-screen and use it as the
                                // drag image so the operator sees what
                                // they're moving instead of a row ghost.
                                try {
                                  const pill = document.createElement('div');
                                  pill.textContent = `${jobIds.length} Job${jobIds.length === 1 ? '' : 's'}`;
                                  pill.style.position = 'absolute';
                                  pill.style.top = '-1000px';
                                  pill.style.left = '-1000px';
                                  pill.style.padding = '4px 8px';
                                  pill.style.background = '#0891b2';
                                  pill.style.color = '#fff';
                                  pill.style.borderRadius = '4px';
                                  pill.style.fontSize = '12px';
                                  pill.style.fontWeight = '600';
                                  document.body.appendChild(pill);
                                  e.dataTransfer.setDragImage(pill, 0, 0);
                                  // Clean the transient element after
                                  // the browser has snapshotted it.
                                  window.setTimeout(() => {
                                    if (pill.parentNode) pill.parentNode.removeChild(pill);
                                  }, 0);
                                } catch { /* setDragImage unsupported - ignore */ }
                              }}
                              onClick={(e) => onSelectJob(j.jobId, { ctrl: e.ctrlKey || e.metaKey })}
                              onContextMenu={(e) => onJobContextMenu(e, j.jobId)}
                              className={`cursor-pointer border-b border-border/50 ${
                                active
                                  ? 'bg-brand-cyan/30'
                                  : multiSel
                                    ? 'bg-brand-cyan/10'
                                    : 'hover:bg-surface-cream/60'
                              }`}
                            >
                              <td className="px-2 py-1">
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${jobStatusClass(j.jobStatus)}`}>
                                  {j.jobStatus ?? '-'}
                                </span>
                              </td>
                              <td className="px-2 py-1">{j.clientCode ?? '-'}</td>
                              <td className="px-2 py-1 font-mono">{j.jobNumber ?? '-'}</td>
                              <td className="px-2 py-1">{dDate}</td>
                              <td className="px-2 py-1">{rTime}</td>
                              <td className="px-2 py-1 truncate max-w-[12rem]" title={rowLatMissing ? `${rowAddress} (GPS missing)` : rowAddress}>
                                {rowAddress}
                                {rowLatMissing && (
                                  <span
                                    className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-orange-100 text-orange-700 text-[10px] font-bold align-middle"
                                    title="GPS missing - job will fail routing"
                                    aria-label="GPS missing"
                                  >
                                    !
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-1 truncate max-w-[8rem]">{rowCity}</td>
                              <td className="px-2 py-1">
                                {j.agentName || '-'}
                                {j.isNpAgent && (
                                  <span className="ml-1 inline-block bg-brand-orange text-white text-[10px] px-1 rounded">NP</span>
                                )}
                              </td>
                              <td className="px-2 py-1">
                                {j.courierName?.trim()
                                  ? (j.courierCode ? `${j.courierName}:${j.courierCode}` : j.courierName)
                                  : '-'}
                              </td>
                              <td className="px-2 py-1">{j.speedName ?? j.speed ?? '-'}</td>
                            </tr>
                          );
                        })}
                        {runJobsQuery.isLoading && (
                          <tr><td colSpan={10} className="px-3 py-4 text-center text-text-muted">Loading...</td></tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </RvBox>
              </Panel>
              <PanelResizeHandle className="h-1" />
              <Panel defaultSize={DEFAULT_LAYOUT.rvMidV![1]} minSize={15}>
                <RvJobDetail
                  bulkJobId={siblingOverride?.bulkJobId ?? selectedRowBulkJobId}
                  selectedCourier={selectedCourier}
                  initialJob={siblingOverride?.job ?? selectedRow}
                  onPickSibling={(sib) => {
                    // If the sibling has a real tblBulkJob row, keep the
                    // selectedJobId flow so future refetches work. LH
                    // legs (bulkJobId=0) can only render via the
                    // sibling payload override. selectedJobId is jobId
                    // (tucJob.ucjbID), so pull sib.jobId to key the
                    // primary-row selection back onto the sibling's row.
                    if (sib.bulkJobId > 0 && sib.job) {
                      setSelectedJobId(sib.jobId ?? null);
                      setSiblingOverride(null);
                    } else {
                      setSiblingOverride(sib);
                    }
                  }}
                  onPrint={doPrintJobReport}
                  onSend={(j) => {
                    // POD email: proxies to legacy /Home/SendPOD via the
                    // same env-gated proxy the labels use. Prompt for the
                    // destination address; default to trackingEmail /
                    // deliverToPhone contact email if the job carries one.
                    const suggested = j.trackingEmail || j.proofOfDeliveryEmail || '';
                    const to = window.prompt('Send POD to email:', suggested);
                    if (!to) return;
                    routeViewerService.sendPodEmail(j.bulkJobId, to.trim())
                      .then(() => toast.show(`POD emailed to ${to}.`))
                      .catch((err) => toast.show(`SendPOD failed: ${err.message}`));
                  }}
                  onTransferRoute={(j) => {
                    if (j.bulkRunId != null) {
                      setSelectedRunIds([j.bulkRunId]);
                      toast.show('Transfer Route: right-click the run in the Run List to open the dialog.');
                    } else {
                      toast.show('Job is not on a run yet - assign to a run first.');
                    }
                  }}
                  onJumpToClientIntel={() => {
                    clientIntelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                  }}
                />
              </Panel>
            </PanelGroup>
          </Panel>

          <PanelResizeHandle className="w-1" />

          {/* Slim column: Pre Assigned / Returns / Exceptions.
              Tier-3 item 16: admin-only. NP operators only see their own
              work in the main Run List; the operational slim column is
              reserved for internal admin who dispatch across all runs. */}
          {!user.isNetworkPartner && (
            <>
              <Panel defaultSize={DEFAULT_LAYOUT.rvHorizontal![2]} minSize={10}>
                <PanelGroup direction="vertical" ref={slimVRef}>
                  <Panel defaultSize={DEFAULT_LAYOUT.rvSlimV![0]} minSize={10}>
                    <RvRunListLite
                      variant="preAssigned"
                      runs={runsQuery.data ?? []}
                      selectedIds={selectedRunIds}
                      onSelect={onSelectRunFromTable('preAssigned')}
                      onContextMenu={onContextMenu}
                      runColorMap={runColorMap}
                      onVisibleRunsChange={(ids) => { preAssignedVisibleRef.current = ids; }}
                    />
                  </Panel>
                  <PanelResizeHandle className="h-1" />
                  <Panel defaultSize={DEFAULT_LAYOUT.rvSlimV![1]} minSize={10}>
                    <RvRunListLite
                      variant="returns"
                      runs={runsQuery.data ?? []}
                      selectedIds={selectedRunIds}
                      onSelect={onSelectRunFromTable('returns')}
                      onContextMenu={onContextMenu}
                      runColorMap={runColorMap}
                      onVisibleRunsChange={(ids) => { returnsVisibleRef.current = ids; }}
                    />
                  </Panel>
                  <PanelResizeHandle className="h-1" />
                  <Panel defaultSize={DEFAULT_LAYOUT.rvSlimV![2]} minSize={10}>
                    <RvRunListLite
                      variant="exceptions"
                      runs={runsQuery.data ?? []}
                      selectedIds={selectedRunIds}
                      onSelect={onSelectRunFromTable('exceptions')}
                      onContextMenu={onContextMenu}
                      runColorMap={runColorMap}
                      onVisibleRunsChange={(ids) => { exceptionsVisibleRef.current = ids; }}
                    />
                  </Panel>
                </PanelGroup>
              </Panel>

              <PanelResizeHandle className="w-1" />
            </>
          )}

          {/* Right column: Map + Scan Detail */}
          <Panel defaultSize={DEFAULT_LAYOUT.rvHorizontal![3]} minSize={15}>
            <PanelGroup direction="vertical" ref={rightVRef}>
              <Panel defaultSize={DEFAULT_LAYOUT.rvRightV![0]} minSize={20}>
                <RvMapBox
                  runDate={filters.runDate}
                  runJobs={runJobs}
                  selectedJobId={selectedRowBulkJobId}
                  viewMode={viewMode}
                  runColorMap={runColorMap}
                  extraRunJobs={extraRunJobs}
                />
              </Panel>
              <PanelResizeHandle className="h-1" />
              <Panel defaultSize={12} minSize={8}>
                <RvCouriersBox
                  runDate={filters.runDate}
                  availableOnly={filters.availableCouriersOnly}
                  onPick={(c) => {
                    // Two effects per legacy: narrow Run List by
                    // courierId AND swap the JobDetail pane for the
                    // Google Maps embed centred on this courier.
                    onFiltersChange({ ...filters, courierId: c.courierId });
                    setSelectedCourier({ code: c.code, name: c.name });
                  }}
                />
              </Panel>
              <PanelResizeHandle className="h-1" />
              <Panel defaultSize={12} minSize={8}>
                <div ref={clientIntelRef} className="h-full">
                  <RvClientIntelBox mobile={selectedJobDetail?.deliverToPhone ?? selectedJobDetail?.phone ?? null} />
                </div>
              </Panel>
              <PanelResizeHandle className="h-1" />
              <Panel defaultSize={DEFAULT_LAYOUT.rvRightV![1]} minSize={15}>
                <RvScanDetailBox selectedJobId={selectedRowBulkJobId} />
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </div>

      {ctxMenu && (
        <RvRunContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          runId={ctxMenu.runId}
          runDate={filters.runDate}
          viewMode={viewMode}
          onClose={() => setCtxMenu(null)}
          onDone={() => runsQuery.refetch()}
        />
      )}

      {printRunOpen && (
        <PrintRunSortModeDialog
          onPick={doPrintRun}
          onCancel={() => setPrintRunOpen(false)}
          submitting={printRunSubmitting}
        />
      )}

      {jobCtxMenu && selectedJobIds.length > 0 && (
        <RvJobContextMenu
          x={jobCtxMenu.x}
          y={jobCtxMenu.y}
          jobs={runJobs.filter((j) => selectedJobIds.includes(j.jobId))}
          runDate={filters.runDate}
          onClose={() => setJobCtxMenu(null)}
          onDone={() => {
            runJobsQuery.refetch();
            runsQuery.refetch();
          }}
        />
      )}

      {topUpOpen && selectedRowBulkJobId != null && selectedRowBulkJobId > 0 && (
        <TopUpDialog
          jobId={selectedRowBulkJobId}
          onClose={() => setTopUpOpen(false)}
          onBooked={() => { setTopUpOpen(false); toast.show('Top up booked.'); }}
        />
      )}
    </div>
  );
}

// Sortable table header for the middle-pane Run Jobs grid. Click
// cycles asc -> desc for that column; clicking a different column
// resets to asc. Renders a small caret indicating current dir.
function SortableTh({
  label, k, cur, onClick,
}: {
  label: string;
  k: string;
  cur: { key: string; dir: 'asc' | 'desc' };
  onClick: (k: string) => void;
}) {
  const active = cur.key === k;
  return (
    <th
      className="px-2 py-1 cursor-pointer select-none hover:text-text-primary"
      onClick={() => onClick(k)}
    >
      {label}
      {active && <span className="ml-1">{cur.dir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
}

// Job-status pill palette. Mirrors legacy udispatch.less `.status.<code>`
// exactly - each per-job status has its own colour and the pill on the
// first column of the Run Jobs table gives operators an at-a-glance
// picture of the run's progress: sky blue = New, green = Delivered,
// blue = Assigned, red = Picked up, purple = Late Delivered, grey =
// Completed / Awaiting / etc. Any status not enumerated here falls
// through to the neutral white pill just like the default legacy CSS.
function jobStatusClass(status: string | null | undefined): string {
  const s = (status ?? '').toUpperCase().trim();
  switch (s) {
    case 'N':   return 'bg-sky-200 text-sky-900';
    case 'D':   return 'bg-green-200 text-green-900';
    case 'A':   return 'bg-blue-200 text-blue-900';
    case 'R':   return 'bg-white text-slate-700 border border-slate-200';
    case 'LP':
    case 'V':   return 'bg-orange-200 text-orange-900';
    case 'P':   return 'bg-red-200 text-red-900';
    case 'LD':  return 'bg-purple-200 text-purple-900';
    case 'C':
    case 'AW':
    case 'UD':
    case 'IT':
    case 'ASC': return 'bg-slate-200 text-slate-800';
    default:    return 'bg-slate-100 text-slate-600';
  }
}
