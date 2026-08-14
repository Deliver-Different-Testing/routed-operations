import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelGroupHandle } from 'react-resizable-panels';
import { useAuth } from '../../context/AuthContext';
import { useAutoPoll } from '../../hooks/useAutoPoll';
import { useRouteViewerRuns } from '../../hooks/queries/useRouteViewerRuns';
import { useRouteViewerLookups } from '../../hooks/queries/useRouteViewerLookups';
import { tenantDateFromSpString, tenantTimeFromSpString, tenantTodayYmd } from '../../lib/tenantDate';
import { RvFilterBar, type FilterState } from '../../components/route-viewer/RvFilterBar';
import { RvRunList, type ViewMode } from '../../components/route-viewer/RvRunList';
import { RvJobDetail } from '../../components/route-viewer/RvJobDetail';
import { RvRunContextMenu } from '../../components/route-viewer/RvRunContextMenu';
import { RvJobContextMenu } from '../../components/route-viewer/RvJobContextMenu';
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
  });
  const [viewMode, setViewMode] = useState<ViewMode>((stored as any).viewMode ?? 'Combined');
  const [selectedRunIds, setSelectedRunIds] = useState<number[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; runId: number } | null>(null);
  const [topUpOpen, setTopUpOpen] = useState(false);
  // Multi-select on the runJobs grid so bulk actions from the job
  // context menu operate on N jobs. Ctrl/Cmd-click toggles; plain
  // click replaces. Selection is scoped to the currently drilled run
  // - switching runs clears it.
  const [selectedJobIds, setSelectedJobIds] = useState<number[]>([]);
  const [jobCtxMenu, setJobCtxMenu] = useState<{ x: number; y: number } | null>(null);
  // Sibling-tab override for LH1..LH4 / LHP legs that don't have a
  // tblBulkJob row. Clicking their tab sets this to the sibling
  // payload (from RVW_stpJobSiblings); JobDetail renders directly
  // from it. Cleared on middle-pane job change / run change.
  const [siblingOverride, setSiblingOverride] = useState<import('../../services/routeViewerService').SiblingJob | null>(null);

  // Imperative refs on each PanelGroup so the Layout menu can snapshot
  // current sizes for Save and reset them on Apply.
  const hRef = useRef<ImperativePanelGroupHandle | null>(null);
  const leftVRef = useRef<ImperativePanelGroupHandle | null>(null);
  const midVRef = useRef<ImperativePanelGroupHandle | null>(null);
  const slimVRef = useRef<ImperativePanelGroupHandle | null>(null);
  const rightVRef = useRef<ImperativePanelGroupHandle | null>(null);

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
  const runJobsQuery = useQuery({
    queryKey: ['rv-run-jobs', singleRunId, filters.runDate, viewMode],
    queryFn: () => routeViewerService.getRunJobs(singleRunId!, filters.runDate, viewMode),
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
      queryKey: ['rv-run-jobs', rid, filters.runDate, viewMode],
      queryFn: () => routeViewerService.getRunJobs(rid, filters.runDate, viewMode),
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
      setSelectedJobId(match.bulkJobId);
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

  const onSelectJob = useCallback((bulkJobId: number, mods: { ctrl: boolean }) => {
    if (mods.ctrl) {
      setSelectedJobIds((prev) => prev.includes(bulkJobId) ? prev.filter((v) => v !== bulkJobId) : [...prev, bulkJobId]);
      setSelectedJobId(bulkJobId);
    } else {
      setSelectedJobIds([bulkJobId]);
      setSelectedJobId(bulkJobId);
    }
    setSiblingOverride(null);   // primary click clears LH-leg override
  }, []);

  const onJobContextMenu = useCallback((e: React.MouseEvent, bulkJobId: number) => {
    e.preventDefault();
    // If right-clicked row isn't already in the selection, replace the
    // selection with just this row (matches legacy UX + master 7.10).
    setSelectedJobIds((prev) => (prev.includes(bulkJobId) ? prev : [bulkJobId]));
    setSelectedJobId(bulkJobId);
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

  // Audit 7.4: client-side courier filter. Runs SP doesn't take a
  // courier param; look up the selected courier's code from the same
  // courier list the FilterBar dropdown reads, then keep only runs
  // whose courierCode matches. Falls back to all runs when the
  // selected courier isn't in the current-day list.
  const courierListForFilter = useQuery({
    queryKey: ['rv-filter-couriers', filters.runDate],
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
    const filtered = rawRunJobs.filter((j: any) => {
      if (!rjShowCancelled && j.jobStatus === 'V') return false;
      if (!rjShowMultibox && j.multiboxParentId != null && j.multiboxParentId !== 0) return false;
      return true;
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
  }, [rawRunJobs, rjShowCancelled, rjShowMultibox, rjSort]);

  // Currently-selected job payload used by the right-column Client
  // Intel box to look up per-mobile intel. Picks the sibling override
  // first (LH legs live only in the sibling payload) then falls back
  // to the primary runJobs cache entry. MUST be declared after
  // `runJobs` above - referencing it earlier hits a TDZ error at
  // render time the moment selectedJobId becomes non-null.
  const selectedJobDetail = siblingOverride?.job
    ?? (selectedJobId != null ? runJobs.find((j) => j.bulkJobId === selectedJobId) : null)
    ?? null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <RvFilterBar
        value={filters}
        onChange={onFiltersChange}
        onRefresh={() => runsQuery.refetch()}
        isRefreshing={runsQuery.isFetching}
        extraActions={
          <RvUtilityActions
            onPrint={(k) => {
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
              const params = new URLSearchParams({
                runDate: filters.runDate,
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
                />
              </Panel>
              <PanelResizeHandle className="h-1" />
              <Panel defaultSize={DEFAULT_LAYOUT.rvLeftV![1]} minSize={20}>
                <RvBox title="Run List">
                  <RvRunList
                    runs={visibleRuns}
                    selectedIds={selectedRunIds}
                    onSelect={onSelectRun}
                    onContextMenu={onContextMenu}
                    viewMode={viewMode}
                    onViewModeChange={setViewMode}
                    isLoading={runsQuery.isLoading}
                    runColorMap={runColorMap}
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
                            `Moved ${res.transferred} job${res.transferred === 1 ? '' : 's'} to run ${toRun?.name ?? toRunId}.`,
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
                        title="Print run"
                        onClick={() => toast.show('Print run - endpoint scaffold (P14).')}
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
                          const active = selectedJobId === j.bulkJobId;
                          const multiSel = selectedJobIds.includes(j.bulkJobId);
                          // Legacy tenantDate / tenantDateTime filter behaviour:
                          //   NZ -> dd/MM/yyyy + HH:mm (24h)
                          //   US -> MM/dd/yyyy + h:mm AM/PM (12h)
                          // SP already emits dd/MM/yyyy + HH:mm:ss so the
                          // helpers just re-shape the string per tenant.
                          const dDate = tenantDateFromSpString(j.bookDate, user.isUsTenant) || '-';
                          const rTime = tenantTimeFromSpString(j.bookTime, user.isUsTenant) || '-';
                          return (
                            <tr
                              key={j.bulkJobId}
                              draggable={singleRunId != null && j.bulkJobId > 0}
                              onDragStart={(e) => {
                                // Audit item 20: batch payload = "drop
                                // this whole selection", so include every
                                // multi-selected id when the dragged row
                                // is part of it; otherwise just this row.
                                const inSel = selectedJobIds.includes(j.bulkJobId);
                                const jobIds = inSel && selectedJobIds.length > 1
                                  ? selectedJobIds.slice()
                                  : [j.bulkJobId];
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
                              onClick={(e) => onSelectJob(j.bulkJobId, { ctrl: e.ctrlKey || e.metaKey })}
                              onContextMenu={(e) => onJobContextMenu(e, j.bulkJobId)}
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
                              <td className="px-2 py-1 truncate max-w-[12rem]" title={j.toAddress ?? undefined}>
                                {j.toAddress ?? '-'}
                              </td>
                              <td className="px-2 py-1 truncate max-w-[8rem]">{j.toCity ?? j.toSuburb ?? '-'}</td>
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
                  bulkJobId={siblingOverride?.bulkJobId ?? selectedJobId}
                  initialJob={
                    siblingOverride?.job ??
                    (selectedJobId != null ? runJobs.find((j) => j.bulkJobId === selectedJobId) ?? null : null)
                  }
                  onPickSibling={(sib) => {
                    // If the sibling has a real tblBulkJob row, keep the
                    // selectedJobId flow so future refetches work. LH
                    // legs (bulkJobId=0) can only render via the
                    // sibling payload override.
                    if (sib.bulkJobId > 0 && sib.job) {
                      setSelectedJobId(sib.bulkJobId);
                      setSiblingOverride(null);
                    } else {
                      setSiblingOverride(sib);
                    }
                  }}
                  onPrint={() => toast.show('Print job report - endpoint scaffold (P14).')}
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
                      onSelect={onSelectRun}
                      onContextMenu={onContextMenu}
                      runColorMap={runColorMap}
                    />
                  </Panel>
                  <PanelResizeHandle className="h-1" />
                  <Panel defaultSize={DEFAULT_LAYOUT.rvSlimV![1]} minSize={10}>
                    <RvRunListLite
                      variant="returns"
                      runs={runsQuery.data ?? []}
                      selectedIds={selectedRunIds}
                      onSelect={onSelectRun}
                      onContextMenu={onContextMenu}
                      runColorMap={runColorMap}
                    />
                  </Panel>
                  <PanelResizeHandle className="h-1" />
                  <Panel defaultSize={DEFAULT_LAYOUT.rvSlimV![2]} minSize={10}>
                    <RvRunListLite
                      variant="exceptions"
                      runs={runsQuery.data ?? []}
                      selectedIds={selectedRunIds}
                      onSelect={onSelectRun}
                      onContextMenu={onContextMenu}
                      runColorMap={runColorMap}
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
                  selectedJobId={selectedJobId}
                  viewMode={viewMode}
                  runColorMap={runColorMap}
                  extraRunJobs={extraRunJobs}
                />
              </Panel>
              <PanelResizeHandle className="h-1" />
              <Panel defaultSize={12} minSize={8}>
                <RvCouriersBox
                  runDate={filters.runDate}
                  onPick={(courierId) => onFiltersChange({ ...filters, courierId })}
                />
              </Panel>
              <PanelResizeHandle className="h-1" />
              <Panel defaultSize={12} minSize={8}>
                <RvClientIntelBox mobile={selectedJobDetail?.deliverToPhone ?? selectedJobDetail?.phone ?? null} />
              </Panel>
              <PanelResizeHandle className="h-1" />
              <Panel defaultSize={DEFAULT_LAYOUT.rvRightV![1]} minSize={15}>
                <RvScanDetailBox selectedJobId={selectedJobId} />
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
          onClose={() => setCtxMenu(null)}
          onDone={() => runsQuery.refetch()}
        />
      )}

      {jobCtxMenu && selectedJobIds.length > 0 && (
        <RvJobContextMenu
          x={jobCtxMenu.x}
          y={jobCtxMenu.y}
          jobs={runJobs.filter((j) => selectedJobIds.includes(j.bulkJobId))}
          runDate={filters.runDate}
          onClose={() => setJobCtxMenu(null)}
          onDone={() => {
            runJobsQuery.refetch();
            runsQuery.refetch();
          }}
        />
      )}

      {topUpOpen && selectedJobId != null && (
        <TopUpDialog
          jobId={selectedJobId}
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
