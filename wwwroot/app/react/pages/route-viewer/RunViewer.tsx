import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

  const [filters, setFilters] = useState<FilterState>({
    runDate: searchParams.get('runDate') ?? initialDate,
    clientIds: [],
    regionIds: [],
    speedIds: [],
    activeRegionsOnly: true,
  });
  const [viewMode, setViewMode] = useState<ViewMode>('Combined');
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

  const onSelectRun = useCallback((id: number, mods: { ctrl: boolean; shift: boolean }) => {
    setSelectedRunIds((prev) => {
      if (mods.ctrl) return prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id];
      return [id];
    });
    setSelectedJobId(null);
    setSelectedJobIds([]);   // clear job multi-select on run change
    setSiblingOverride(null);
  }, []);

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
  }, [searchParams, setSearchParams]);

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
  const runJobs = runJobsQuery.data ?? [];

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
                    runs={runsQuery.data ?? []}
                    selectedIds={selectedRunIds}
                    onSelect={onSelectRun}
                    onContextMenu={onContextMenu}
                    viewMode={viewMode}
                    onViewModeChange={setViewMode}
                    isLoading={runsQuery.isLoading}
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
                          <th className="px-2 py-1">Status</th>
                          <th className="px-2 py-1">Client</th>
                          <th className="px-2 py-1">Job #</th>
                          <th className="px-2 py-1">D Date</th>
                          <th className="px-2 py-1">R Time</th>
                          <th className="px-2 py-1">Address</th>
                          <th className="px-2 py-1">City</th>
                          <th className="px-2 py-1">Agent/NP</th>
                          <th className="px-2 py-1">Courier</th>
                          <th className="px-2 py-1">Speed</th>
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
                  onSend={() => toast.show('Send job link / POD - endpoint scaffold (P14).')}
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

          {/* Slim column: Pre Assigned / Returns / Exceptions */}
          <Panel defaultSize={DEFAULT_LAYOUT.rvHorizontal![2]} minSize={10}>
            <PanelGroup direction="vertical" ref={slimVRef}>
              <Panel defaultSize={DEFAULT_LAYOUT.rvSlimV![0]} minSize={10}>
                <RvRunListLite
                  variant="preAssigned"
                  runs={runsQuery.data ?? []}
                  selectedIds={selectedRunIds}
                  onSelect={onSelectRun}
                  onContextMenu={onContextMenu}
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
                />
              </Panel>
            </PanelGroup>
          </Panel>

          <PanelResizeHandle className="w-1" />

          {/* Right column: Map + Scan Detail */}
          <Panel defaultSize={DEFAULT_LAYOUT.rvHorizontal![3]} minSize={15}>
            <PanelGroup direction="vertical" ref={rightVRef}>
              <Panel defaultSize={DEFAULT_LAYOUT.rvRightV![0]} minSize={20}>
                <RvMapBox
                  runDate={filters.runDate}
                  runJobs={runJobs}
                  selectedJobId={selectedJobId}
                  viewMode={viewMode}
                />
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
