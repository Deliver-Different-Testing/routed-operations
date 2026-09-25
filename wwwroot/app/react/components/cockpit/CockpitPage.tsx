import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelGroupHandle } from 'react-resizable-panels';
import { useCockpitState } from './CockpitState';
import { Button } from '../common/Button';
import { FiltersBar } from './FiltersBar';
import { JobsList } from './JobsList';
import { GroupedJobs } from './GroupedJobs';
import { JobDetail } from './JobDetail';
import { RunList } from './RunList';
import { RunBuilder } from './RunBuilder';
import { FleetsPanel } from './FleetsPanel';
import { GoogleMap } from './GoogleMap';
import { MapContextMenu, type MapContextTarget } from './MapContextMenu';
import { ActionToolbar } from './ActionToolbar';
import { BulkMoveDateModal } from './BulkMoveDateModal';
import { OptimizePreviewModal, type OptimizeStop } from './OptimizePreviewModal';
import { BuildConfigModal } from './BuildConfigModal';
import { BuildAlertModal, type BuildBucketPreview, type BuildSkipReport } from './BuildAlertModal';
import { FixGpsModal } from './FixGpsModal';
import { LayoutMenu } from './LayoutMenu';
import { FilterPresetsMenu } from './FilterPresetsMenu';
import { DEFAULT_LAYOUT, deleteLayout, loadLayouts, saveLayouts, upsertLayout, type CockpitLayout } from '../../lib/layouts';
import { deleteFilterPreset, loadFilterPresets, saveFilterPresets, upsertFilterPreset, type FilterPreset } from '../../lib/filterPresets';
import { jobService } from '../../services/jobService';
import { runService, type InsertOrUpdateRunBody } from '../../services/runService';
import { regionService } from '../../services/regionService';
import { speedService } from '../../services/speedService';
import { courierService } from '../../services/courierService';
import { routeService, type SavvyLocation } from '../../services/routeService';
import { vehicleSizeService } from '../../services/vehicleSizeService';
import type { BuildConfig, BulkJob, Courier, JobFilters, Run, RunJob, VehicleSize } from '../../types';
import { useToast } from '../../context/ToastContext';
import { useConfirm, useAlert } from '../../context/ConfirmContext';
import { bucketJobs, buildModeLabel, loadBuildConfig, saveBuildConfig, splitOrderedJobsByConstraints, windowMinutes } from '../../lib/buildConfig';
import { expandMultiboxSiblings } from '../../lib/multibox';
import { VoidRelationshipDialog, type VoidRelationshipContext } from './VoidRelationshipDialog';
import { MergeRunModal } from './MergeRunModal';
import { SendSelectedModal } from './SendSelectedModal';
import { sortJobs, sortRuns } from '../../lib/sortLists';
import { RunActionToolbar } from './RunActionToolbar';
import type { ContextMenuItem } from './RowContextMenu';
import { useHotkeys } from '../../hooks/useHotkeys';
import { useGlobalSearch } from '../../context/GlobalSearchContext';

interface ClientOption { id: number; label: string; }

export function CockpitPage() {
  const [state, dispatch] = useCockpitState();
  const toast = useToast();
  const confirm = useConfirm();
  const alert = useAlert();
  // P1.4 global cross-jobs search. The Header owns the input; we consume the
  // query below to widen filtering across jobs / runs / groups, and register
  // a jump handler so a header result click selects the target job.
  const globalSearch = useGlobalSearch();
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [allCouriers, setAllCouriers] = useState<Courier[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [ourRefs, setOurRefs] = useState<string[]>([]);
  const [optimizePreview, setOptimizePreview] = useState<{ runName: string; stops: OptimizeStop[]; commit: () => Promise<void> } | null>(null);
  const [vehicleSizes, setVehicleSizes] = useState<VehicleSize[]>([]);
  const [buildConfig, setBuildConfig] = useState<BuildConfig>(() => loadBuildConfig());
  const [buildConfigModal, setBuildConfigModal] = useState<{ open: boolean; onConfirm?: () => void }>({ open: false });
  // Pre-build preview modal (P1.11). Populated by openBuildAlert() before the
  // heavy build path fires; empty when no build is pending.
  const [buildAlert, setBuildAlert] = useState<{
    buckets: BuildBucketPreview[];
    skips: BuildSkipReport;
    totalValid: number;
    execute: () => Promise<void>;
  } | null>(null);
  const [mapContext, setMapContext] = useState<MapContextTarget | null>(null);
  // L2.P3.2 Optional pre-selected leg for the JobDetail address-row
  // right-click shortcut. Header "Fix GPS" button leaves it undefined
  // (modal defaults to 'ToAddress'); the address-row shortcuts pass the
  // matching side so the operator lands in one click.
  const [gpsFixJob, setGpsFixJob] = useState<{ job: BulkJob; leg?: 'ToAddress' | 'FromAddress' } | null>(null);
  const [voidDialog, setVoidDialog] = useState<VoidRelationshipContext | null>(null);
  const [mergeSource, setMergeSource] = useState<Run | null>(null);
  // P2.7 Send-Selected modal state. Populated by handleSendSelected once the
  // pre-flight checks (client filter warning etc.) have passed; the modal
  // takes over from window.prompt for the actual courier pick + confirm.
  const [sendSelectedModal, setSendSelectedModal] = useState<{ expandedJobIds: number[] } | null>(null);
  // Which of the four panes was interacted with most recently. Ctrl+A uses
  // this to pick the right "select all" scope. Legacy called this
  // `activeTable` and updated it on every ng-mouseup binding.
  const [activePane, setActivePane] = useState<'jobs' | 'runs' | 'groups'>('jobs');
  // Legacy routeSetting.autoRoute: when true, Build Runs / Optimise routes are
  // sent to HERE automatically; when false, the operator must pick "Optimise"
  // from the run menu themselves. Purely a UX preference, no server bearing.
  const [autoRoute, setAutoRoute] = useState<boolean>(() => {
    try { return localStorage.getItem('routed-operations.autoRoute') !== '0'; }
    catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem('routed-operations.autoRoute', autoRoute ? '1' : '0'); }
    catch { /* localStorage disabled */ }
  }, [autoRoute]);
  const [layouts, setLayouts] = useState<CockpitLayout[]>(() => loadLayouts());
  const [filterPresets, setFilterPresets] = useState<FilterPreset[]>(() => loadFilterPresets());
  const horizontalRef = useRef<ImperativePanelGroupHandle | null>(null);
  const leftVerticalRef = useRef<ImperativePanelGroupHandle | null>(null);
  const runVerticalRef = useRef<ImperativePanelGroupHandle | null>(null);

  const loadLookups = useCallback(async (date: string) => {
    try {
      const [regions, speeds, fleets, allCour, clientsRes, ourRefsRes, vehSizes] = await Promise.all([
        regionService.getForRunDate(date),
        speedService.getForRunDate(date),
        courierService.getFleets(),
        courierService.getActive(),
        jobService.getClientFilters(),
        jobService.getOurRefs(date),
        vehicleSizeService.getAll(),
      ]);
      dispatch({ type: 'SET_REGIONS', payload: regions });
      dispatch({ type: 'SET_SPEEDS', payload: speeds });
      dispatch({ type: 'SET_FLEETS', payload: fleets.fleets });
      setAllCouriers(allCour.potentialCouriers);
      setClients(clientsRes.response.clients);
      setOurRefs(ourRefsRes.ourRefs);
      setVehicleSizes(vehSizes.response);
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  }, [dispatch, toast]);

  const loadJobsAndRuns = useCallback(async (filters: JobFilters) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });
    try {
      const [jobs, runs] = await Promise.all([
        jobService.getBulkJobs(filters),
        runService.getRuns(filters),
      ]);
      dispatch({ type: 'SET_JOBS', payload: jobs.bulkJobs });
      dispatch({ type: 'SET_RUNS', payload: runs.response });
    } catch (e) {
      const msg = (e as Error).message;
      dispatch({ type: 'SET_ERROR', payload: msg });
      toast.show(msg, 'error');
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [dispatch, toast]);

  useEffect(() => {
    void loadLookups(state.filters.date);
  }, [loadLookups, state.filters.date]);

  useEffect(() => {
    void loadJobsAndRuns(state.filters);
    // Reload when any of the filter dimensions change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.filters.date, state.filters.regionIds.join(','), state.filters.speeds.join(','), state.filters.clientIds.join(','), state.filters.ourRefs.join(',')]);

  // P1.4 global search: register / unregister the "jump to this job id" handler
  // so the Header's result dropdown can hop the cockpit to the matching row.
  useEffect(() => {
    globalSearch.registerOnJump((jobId) => dispatch({ type: 'SELECT_JOB', payload: jobId }));
    return () => { globalSearch.registerOnJump(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Publish result hits to the Header dropdown. Search covers both unassigned
  // jobs (state.jobs) AND jobs sitting on runs (surfaced via state.runs[i].jobs
  // enriched to a hit shape). Capped to 25 rows so the dropdown stays sensible.
  useEffect(() => {
    const q = globalSearch.query.trim().toLowerCase();
    if (!q) { globalSearch.publishResults([]); return; }
    const matches: { bulkJobId: number; jobNumber: string | null; clientCode: string | null;
                     toSuburb: string | null; toPostCode: number | null; runName: string | null }[] = [];
    for (const j of state.jobs) {
      const hay =
        `${j.jobNumber ?? ''} ${j.clientCode ?? ''} ${j.toSuburb ?? ''} ${j.toAddress ?? ''} ${j.ourRef ?? ''} ${j.toPostCode ?? ''} ${j.runName ?? ''}`
          .toLowerCase();
      if (hay.includes(q)) {
        matches.push({
          bulkJobId: j.bulkJobId,
          jobNumber: j.jobNumber,
          clientCode: j.clientCode,
          toSuburb: j.toSuburb,
          toPostCode: j.toPostCode,
          runName: j.runName,
        });
        if (matches.length >= 25) break;
      }
    }
    globalSearch.publishResults(matches);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalSearch.query, state.jobs]);

  const displayedJobs = (() => {
    // Legacy jobList.tpl: filter:{inBuilder: '!1', Void: '!1'} - jobs already
    // assigned to a run (BulkRunID set) disappear from the Jobs list, so
    // operators see only what's still up for grabs. Void filter is handled
    // server-side in GetBulkJobsAsync.
    //
    // Also treat orphaned BulkRunIds (job points at a run id that no longer
    // exists in state.runs, e.g. because a previous delete didn't cascade-
    // null the denorm) as unassigned. Without this, deleted-run jobs vanish
    // entirely - user reported this after doing manual deletes.
    const knownRunIds = new Set(state.runs.map((r) => r.id));
    let out = state.jobs.filter((j) => j.bulkRunId == null || !knownRunIds.has(j.bulkRunId));
    if (state.sizeFilter === 'moreThan100Cubic') {
      out = out.filter((j) => (j.jobCubicM3 ?? 0) > 100);
    }
    // Combined search: the panel-local Jobs filter (state.jobSearch) plus the
    // Header-level global filter (globalSearch.query). Legacy runListCombined
    // treats both as ORs across the same field set; we intersect them (AND) so
    // narrowing globally still lets the operator further-narrow per pane.
    const needles = [state.jobSearch.trim(), globalSearch.query.trim()]
      .filter(Boolean)
      .map((s) => s.toLowerCase());
    if (needles.length > 0) {
      out = out.filter((j) => needles.every((needle) =>
        (j.jobNumber ?? '').toLowerCase().includes(needle) ||
        (j.clientCode ?? '').toLowerCase().includes(needle) ||
        (j.toSuburb ?? '').toLowerCase().includes(needle) ||
        (j.toAddress ?? '').toLowerCase().includes(needle) ||
        (j.ourRef ?? '').toLowerCase().includes(needle) ||
        String(j.toPostCode ?? '').includes(needle) ||
        (j.runName ?? '').toLowerCase().includes(needle)));
    }
    return sortJobs(out, state.jobSort);
  })();

  const displayedRuns = (() => {
    let out = state.runs;
    if (state.runSearch.trim()) {
      const needle = state.runSearch.trim().toLowerCase();
      out = out.filter((r) =>
        (r.name ?? '').toLowerCase().includes(needle) ||
        (r.courierName ?? '').toLowerCase().includes(needle));
    }
    return sortRuns(out, state.runSort);
  })();

  const selectedJob = state.jobs.find((j) => j.bulkJobId === state.selectedJobId) ?? null;
  const selectedRun = state.runs.find((r) => r.id === state.selectedRunId) ?? null;

  // For Del-key path: if selectedJob is null but the id is on a run, expose
  // that run id so the hotkey can call handleRemoveJobFromRun on it. Jobs on
  // runs are filtered out of state.jobs by the Jobs-list rules but they still
  // live under state.runs[i].jobs.
  const selectedJobRunId = state.selectedJobId != null && selectedJob == null
    ? state.runs.find((r) => r.jobs.some((j) => j.bulkJobId === state.selectedJobId))?.id ?? null
    : null;

  // ---- filters --------------------------------------------------------------
  const handleSyncHd = async () => {
    try {
      const res = await jobService.syncHd(state.filters.date);
      const { result, message } = res.response;
      if (result === 'Success') {
        toast.show('EH/HD jobs synced', 'success');
        await loadJobsAndRuns(state.filters);
      } else {
        toast.show(message ?? 'EH/HD sync failed', 'error');
      }
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  };

  // ---- job actions ----------------------------------------------------------
  const handleUpdateJobField = async (jobId: number, field: string, value: string) => {
    try {
      const res = await jobService.updateDetail(jobId, field, value);
      if (res.response === 'Success') {
        toast.show(`Job ${field} updated`, 'success');
        await loadJobsAndRuns(state.filters);
      } else {
        toast.show(`Update failed: ${res.response}`, 'error');
      }
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  };

  // Void or un-void an explicit list of job ids. Callers that read from the
  // multi-select must pass state.selectedJobIds directly - do NOT dispatch a
  // REPLACE_MULTISELECT and then call this without the ids, because the
  // dispatch is async-batched and the closure would read the stale count.
  // Handles multibox expansion + relationship dialog + plain-confirm fallback
  // in one place.
  const voidWithIds = async (ids: number[], isVoid: boolean) => {
    if (ids.length === 0) return;
    const expanded = expandMultiboxSiblings(ids, state.jobs);
    const hasFamily = expanded.length > ids.length;
    // Legacy showVoidRelationshipDialog: only prompt when there's a family to
    // choose from. Single-job or already-full-family selections skip the
    // dialog and use a plain confirm.
    if (hasFamily) {
      const jobNumbersById = new Map<number, string>();
      state.jobs.forEach((j) => jobNumbersById.set(j.bulkJobId, j.jobNumber ?? String(j.bulkJobId)));
      setVoidDialog({
        selectedIds: ids,
        expandedIds: expanded,
        isVoid,
        jobNumbersById,
      });
      return;
    }
    const proceed = await confirm({
      title: isVoid ? 'Void jobs' : 'Un-void jobs',
      message: `${isVoid ? 'Void' : 'Un-void'} ${ids.length} job(s)?`,
      confirmLabel: isVoid ? 'Void' : 'Un-void',
      danger: isVoid,
    });
    if (!proceed) return;
    await executeVoid(ids, isVoid);
  };

  // Toolbar path - reads from the multi-select at call time (safe, not a
  // stale closure because it runs on user click).
  const handleVoid = (isVoid: boolean) => voidWithIds(state.selectedJobIds, isVoid);

  const executeVoid = async (ids: number[], isVoid: boolean) => {
    try {
      await jobService.void(ids, isVoid, state.filters.date);
      toast.show(`${isVoid ? 'Voided' : 'Un-voided'} ${ids.length} job(s)`, 'success');
      dispatch({ type: 'CLEAR_MULTISELECT' });
      setVoidDialog(null);
      await loadJobsAndRuns(state.filters);
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  };

  const handleBulkMoveConfirm = async (newDate: string, runName: string) => {
    try {
      await jobService.bulkMove(state.selectedJobIds, newDate, runName);
      toast.show(`Moved ${state.selectedJobIds.length} job(s) to ${newDate}`, 'success');
      dispatch({ type: 'CLEAR_MULTISELECT' });
      setBulkMoveOpen(false);
      await loadJobsAndRuns(state.filters);
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  };

  // ---- run actions ----------------------------------------------------------
  const handleCreateRun = async (name: string) => {
    try {
      const body: InsertOrUpdateRunBody = {
        id: null,
        name,
        mins: 0,
        kms: 0,
        status: 0,
        revenue: null,
        payout: null,
        courier: null,
        courierPercent: null,
        googleRouteResponse: null,
        jobs: [],
        despatchDateTime: state.filters.date,
      };
      const res = await runService.insertOrUpdate(body);
      if (res.response.result === 'Success') {
        toast.show(`Run "${name}" created`, 'success');
        await loadJobsAndRuns(state.filters);
      } else {
        toast.show(res.response.message ?? 'Create run failed', 'error');
      }
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  };

  const handleRenameRun = async (runId: number, name: string) => {
    const run = state.runs.find((r) => r.id === runId);
    if (!run) return;
    try {
      const body = runToBody(run, { name });
      const res = await runService.update(runId, body);
      if (res.response.result === 'Success') {
        toast.show('Run renamed', 'success');
        await loadJobsAndRuns(state.filters);
      } else {
        toast.show(res.response.message ?? 'Rename failed', 'error');
      }
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  };

  const handleDeleteRun = async (runId: number) => {
    try {
      const res = await runService.remove(runId);
      if (res.response.result === 'Success') {
        toast.show('Run deleted', 'success');
        if (state.selectedRunId === runId) dispatch({ type: 'SELECT_RUN', payload: null });
        await loadJobsAndRuns(state.filters);
      } else {
        toast.show(res.response.message ?? 'Delete failed', 'error');
      }
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  };

  const handleAssignCourier = async (runId: number, courierId: number | null, opts?: { preassign?: boolean }) => {
    const run = state.runs.find((r) => r.id === runId);
    if (!run) return;
    const courier = courierId ? allCouriers.find((c) => c.courierId === courierId) : null;
    try {
      // Preassign path (P1.9): flip Status to 18 in the same round-trip as the
      // courier assign so downstream dispatchers see it flagged. If the run is
      // already at a non-zero status (e.g. locked=1), preserve that - the
      // preassign flag only applies to the "not yet locked" case.
      const preassignStatus = opts?.preassign && (run.status ?? 0) === 0 ? 18 : undefined;
      const body = runToBody(run, {
        courier: courier ? { courierId: courier.courierId, courier: courier.displayName } : null,
        ...(preassignStatus !== undefined ? { status: preassignStatus } : {}),
      });
      const res = await runService.update(runId, body);
      if (res.response.result === 'Success') {
        toast.show(
          courier
            ? opts?.preassign ? `Preassigned ${courier.displayName} (Status 18)` : `Assigned ${courier.displayName}`
            : 'Courier removed',
          'success');
        await loadJobsAndRuns(state.filters);
      } else {
        toast.show(res.response.message ?? 'Assign failed', 'error');
      }
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  };

  const handleLockRun = async (runId: number, locked: boolean) => {
    const run = state.runs.find((r) => r.id === runId);
    if (!run) return;
    try {
      const body = runToBody(run, { status: locked ? 1 : 0 });
      const res = await runService.update(runId, body);
      if (res.response.result === 'Success') {
        toast.show(locked ? 'Run locked' : 'Run unlocked', 'success');
        await loadJobsAndRuns(state.filters);
      } else {
        toast.show(res.response.message ?? 'Lock/unlock failed', 'error');
      }
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  };

  const assignJobsToRun = useCallback(async (runId: number, jobIds: number[]) => {
    try {
      // Expand multibox families so assigning a parent takes its children too.
      const expanded = expandMultiboxSiblings(jobIds, state.jobs);
      const results = await Promise.all(
        expanded.map((jobId) => {
          const currentJob = state.jobs.find((j) => j.bulkJobId === jobId);
          const fromRunId = currentJob?.bulkRunId ?? null;
          return runService.assignJob(runId, jobId, fromRunId);
        })
      );
      const failures = results.filter((r) => r.response.result !== 'Success').length;
      if (failures === 0) {
        toast.show(`Assigned ${expanded.length} job(s)`, 'success');
      } else {
        toast.show(`${failures} of ${expanded.length} assignments failed`, 'warning');
      }
      dispatch({ type: 'CLEAR_MULTISELECT' });
      await loadJobsAndRuns(state.filters);
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  }, [state.jobs, state.filters, dispatch, loadJobsAndRuns, toast]);

  const handleAssignSelectedJobs = (runId: number) => assignJobsToRun(runId, state.selectedJobIds);
  const handleDropJobs = (runId: number, jobIds: number[]) => assignJobsToRun(runId, jobIds);

  const handleRemoveJobFromRun = async (jobId: number) => {
    // L2.P2.2 Legacy HereMap.tpl:155-161 prompts before pulling a job off
    // a LOCKED run (Status > 0) because the run has already been earmarked
    // for a courier; silently removing is a small safety loss. Find the
    // owning run via the job -> run.jobs relationship (bulkRunId on the
    // job DTO can lag behind an in-flight update).
    const owningRun = state.runs.find((r) => r.jobs.some((j) => j.bulkJobId === jobId));
    if (owningRun && owningRun.status != null && owningRun.status > 0) {
      const ok = await confirm({
        title: 'Remove from locked run',
        message: `Are you sure you want to remove this job from the locked run "${owningRun.name}"?`,
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      const res = await runService.removeJob(jobId);
      if (res.response.result === 'Success') {
        toast.show('Job removed from run', 'success');
        await loadJobsAndRuns(state.filters);
      } else {
        toast.show(res.response.message ?? 'Remove failed', 'error');
      }
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  };

  // Toggle start / end markers on a run's job (legacy runBuilderMenu items).
  const handleToggleStart = async (job: RunJob, run: Run) => {
    try {
      const res = await runService.setJobStartEnd(run.id, job.bulkJobId, { isStart: !job.isStart });
      if (res.response.result === 'Success') {
        toast.show(job.isStart ? 'Start point cleared' : 'Start point set', 'success');
        await loadJobsAndRuns(state.filters);
      } else {
        toast.show(res.response.message ?? 'Toggle failed', 'error');
      }
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  const handleToggleEnd = async (job: RunJob, run: Run) => {
    try {
      const res = await runService.setJobStartEnd(run.id, job.bulkJobId, { isEnd: !job.isEnd });
      if (res.response.result === 'Success') {
        toast.show(job.isEnd ? 'End point cleared' : 'End point set', 'success');
        await loadJobsAndRuns(state.filters);
      } else {
        toast.show(res.response.message ?? 'Toggle failed', 'error');
      }
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  // Void a single job from within the Run Builder. Uses the same
  // multibox-expanding path as bulk void.
  const handleVoidRunBuilderJob = async (job: RunJob, _run: Run) =>
    voidWithIds([job.bulkJobId], true);
  const handleUnvoidRunBuilderJob = async (job: RunJob, _run: Run) =>
    voidWithIds([job.bulkJobId], false);

  /**
   * Persist a manually re-ordered run (P1.10, legacy activateRunDrop). The
   * caller passes the current run.jobs snapshot in the operator's desired
   * order; we assign builderIndex = i + 1 and POST via the existing
   * InsertOrUpdate path so the MERGE + HOLDLOCK contract stays.
   */
  const handleReorderRunJobs = async (run: Run, orderedJobs: RunJob[]) => {
    try {
      const jobs = orderedJobs.map((rj, i) => ({
        bulkJobId: rj.bulkJobId,
        builderIndex: i + 1,
        jobNumber: rj.jobNumber,
      }));
      const body = runToBody(run, { jobs });
      const upsert = await runService.insertOrUpdate(body);
      if (upsert.response.result === 'Success') {
        toast.show(`Reordered ${orderedJobs.length} stop(s) on "${run.name}"`, 'success');
        await loadJobsAndRuns(state.filters);
      } else {
        toast.show(upsert.response.message ?? 'Reorder failed', 'error');
      }
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  };

  // Optimise a specific run's stops. When `lockAfter` is true, persist the
  // new order AND flip status to 1 in the same round-trip - this is the
  // "Route and Lock Run" menu item (legacy homeControl.js:2205-2219).
  const handleOptimizeRun = async (opts?: { runId?: number; lockAfter?: boolean }) => {
    const run = opts?.runId != null
      ? state.runs.find((r) => r.id === opts.runId) ?? null
      : selectedRun;
    if (!run || run.jobs.length < 2) return;
    try {
      const jobsWithCoords = run.jobs
        .map((rj) => state.jobs.find((j) => j.bulkJobId === rj.bulkJobId))
        .filter((j): j is NonNullable<typeof j> => j != null && !!j.deliveryLatitude && !!j.deliveryLongitude);
      const waypoints: SavvyLocation[] = jobsWithCoords.map((j) => ({
        name: j.jobNumber ?? String(j.bulkJobId),
        latitude: Number(j.deliveryLatitude),
        longitude: Number(j.deliveryLongitude),
        visitDurationInMinutes: 5,
      }));
      if (waypoints.length < 2) {
        toast.show('Not enough jobs with GPS coords to optimise', 'warning');
        return;
      }

      // Routing mode dispatch. A-B (0) uses RouteSavvy's straight optimiser.
      // A-A (1) and Finish-at-stop (2) need HERE's `end` pin, which RouteSavvy
      // doesn't expose - route through the typed HERE endpoint instead.
      // Also: HERE's findsequence2 caps at ~120 waypoints in practice and
      // hard-errors past 200. Legacy uses RouteSavvy as the fallback above
      // 200 stops (homeControl.js:3737-3809). Same fallback here.
      const nameToOrder = new Map<string, number>();
      const overThreshold = jobsWithCoords.length > 200;
      if (!overThreshold && (run.routingMode === 1 || run.routingMode === 2)) {
        const first = jobsWithCoords[0];
        const startLat = Number(first.pickUpLatitude ?? first.deliveryLatitude);
        const startLng = Number(first.pickUpLongitude ?? first.deliveryLongitude);
        const finishJob = run.routingMode === 2 && run.finishAtBulkJobId
          ? jobsWithCoords.find((j) => j.bulkJobId === run.finishAtBulkJobId)
          : undefined;
        const seq = await routeService.hereSequenceTyped(
          { name: 'start', lat: startLat, lng: startLng },
          jobsWithCoords.map((j) => ({
            name: j.jobNumber ?? String(j.bulkJobId),
            lat: Number(j.deliveryLatitude),
            lng: Number(j.deliveryLongitude),
          })),
          {
            returnToStart: run.routingMode === 1,
            finishAtName: finishJob ? (finishJob.jobNumber ?? String(finishJob.bulkJobId)) : null,
          }
        );
        if (!seq) {
          toast.show('HERE sequencer returned no result', 'error');
          return;
        }
        // Filter out the synthetic "start"/"end" names before numbering.
        let ord = 0;
        seq.orderedNames.forEach((n) => {
          if (n && n !== 'start' && !nameToOrder.has(n)) nameToOrder.set(n, ++ord);
        });
      } else {
        if (overThreshold) {
          toast.show(`${jobsWithCoords.length} stops - using RouteSavvy (HERE limit 200)`, 'info');
        }
        const res = await routeService.optimizeWithName(waypoints);
        res.routes.forEach((r, i) => { if (r.name) nameToOrder.set(r.name, i + 1); });
      }

      const stops: OptimizeStop[] = run.jobs.map((rj) => ({
        bulkJobId: rj.bulkJobId,
        jobNumber: rj.jobNumber,
        originalOrder: rj.builderIndex,
        newOrder: rj.jobNumber ? nameToOrder.get(rj.jobNumber) ?? 0 : 0,
      })).sort((a, b) => (a.newOrder || 999) - (b.newOrder || 999));

      // Route+Lock skips the preview - the operator has already committed to
      // both actions by picking the menu item. Manual "Optimise" still gets
      // the preview so operators can double-check before persisting.
      if (opts?.lockAfter) {
        const jobs = stops.map((s) => ({
          bulkJobId: s.bulkJobId,
          builderIndex: s.newOrder || null,
          jobNumber: s.jobNumber,
        }));
        const body = runToBody(run, { jobs, status: 1 });
        const upsert = await runService.insertOrUpdate(body);
        if (upsert.response.result === 'Success') {
          toast.show(`Routed + locked "${run.name}" (${stops.length} stops)`, 'success');
          await loadJobsAndRuns(state.filters);
        } else {
          toast.show(upsert.response.message ?? 'Route + lock failed', 'error');
        }
        return;
      }

      // Preview modal - operator confirms before persisting.
      setOptimizePreview({
        runName: run.name ?? '',
        stops,
        commit: async () => {
          const jobs = stops.map((s) => ({
            bulkJobId: s.bulkJobId,
            builderIndex: s.newOrder || null,
            jobNumber: s.jobNumber,
          }));
          const body = runToBody(run, { jobs });
          const upsert = await runService.insertOrUpdate(body);
          if (upsert.response.result === 'Success') {
            toast.show(`Applied new order (${stops.length} stops)`, 'success');
            setOptimizePreview(null);
            await loadJobsAndRuns(state.filters);
          } else {
            toast.show(upsert.response.message ?? 'Optimise persist failed', 'error');
          }
        },
      });
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  };

  /**
   * Stage the locked runs as "prebook" (Status=2). Legacy sendToPrebook writes
   * to a separate scheduling table via /Job/InsertPrebook; that endpoint is
   * still TODO in Stage 1, so this variant marks the runs as staged and lets
   * the nightly cron pick them up. Operators can pick "Send to Live" instead
   * to bypass the queue for urgent runs.
   */
  const handlePrebook = async () => {
    const locked = state.runs.filter((r) => (r.status ?? 0) === 1 && !r.isVoidRun);
    if (locked.length === 0) return;
    const proceed = await confirm({
      title: 'Stage as prebook',
      message: `Stage ${locked.length} locked run(s) as prebook? They will not dispatch to Live until the next scheduled push.`,
      confirmLabel: 'Stage',
    });
    if (!proceed) return;
    let ok = 0;
    for (const run of locked) {
      try {
        const body = runToBody(run, { status: 2 });
        const res = await runService.update(run.id, body);
        if (res.response.result === 'Success') ok++;
      } catch { /* individual failure, keep going */ }
    }
    toast.show(`Staged ${ok} of ${locked.length} run(s) as prebook`, ok === locked.length ? 'success' : 'warning');
    await loadJobsAndRuns(state.filters);
  };

  const handleDispatch = async () => {
    const locked = state.runs.filter((r) => r.status && r.status > 0);
    if (locked.length === 0) return;

    // P1.2 unlocked-runs alert (legacy homeControl.js:1797-1801). Warn the
    // operator when there are unlocked runs sitting in the current view; the
    // operator may have forgotten to lock them and dispatch would silently
    // skip those runs. Void runs excluded - they're never dispatchable.
    const unlocked = state.runs.filter((r) =>
      !r.isVoidRun && (r.status ?? 0) === 0 && r.jobs.length > 0);
    if (unlocked.length > 0) {
      const names = unlocked.slice(0, 4).map((r) => r.name ?? `#${r.id}`).join(', ');
      const tail = unlocked.length > 4 ? `, +${unlocked.length - 4} more` : '';
      await alert({
        title: 'Unlocked runs',
        message: `You have ${unlocked.length} unlocked run(s) (${names}${tail}). ` +
                 `Please lock all runs before dispatch, or continue to dispatch only the ${locked.length} locked run(s).`,
      });
      // Fall through to the normal confirm so the operator can still choose
      // to dispatch just the locked ones - matches legacy prompt-then-continue.
    }

    // P1.1 client-filter warning (legacy homeControl.js:1804-1810).
    if (state.filters.clientIds.length > 0) {
      const clientOk = await confirm({
        title: 'Client filter active',
        message: `A client filter is active (${state.filters.clientIds.length} client(s) selected). ` +
                 `Only jobs from those clients are visible - are you sure you want to dispatch?`,
        confirmLabel: 'Continue',
      });
      if (!clientOk) return;
    }
    const sendOk = await confirm({
      title: 'Send to Live',
      message: `Send ${locked.length} locked run(s) to Live?`,
      confirmLabel: 'Send',
    });
    if (!sendOk) return;
    try {
      const body = locked.map((r) => runToBody(r, {}));
      const res = await runService.dispatch(body);
      const failures = res.response.filter((r) => r.result !== 'Success').length;
      if (failures === 0) {
        toast.show(`Dispatched ${res.response.length} job assignment(s)`, 'success');
      } else {
        toast.show(`${failures} of ${res.response.length} assignments failed`, 'warning');
      }
      await loadJobsAndRuns(state.filters);
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  };

  /**
   * Send-selected variant. Dispatches multi-selected jobs directly, skipping
   * the "must be on a locked run first" gate. Prompts for a courier since
   * without a run the operator would have no other place to specify one.
   */
  const handleSendSelected = async () => {
    if (state.selectedJobIds.length === 0) return;

    // P1.1 client-filter warning (same rationale as handleDispatch). Cheap
    // guard before the courier prompt so the operator can bail early if the
    // filter narrows the visible pool more than they meant to.
    if (state.filters.clientIds.length > 0) {
      const clientOk = await confirm({
        title: 'Client filter active',
        message: `A client filter is active (${state.filters.clientIds.length} client(s) selected). ` +
                 `Only jobs from those clients are visible - are you sure you want to dispatch the selection?`,
        confirmLabel: 'Continue',
      });
      if (!clientOk) return;
    }

    // P2.7 Replaced the legacy window.prompt courier picker with SendSelectedModal.
    // Pre-expand multibox siblings here so the modal's job-count reflects the
    // real dispatch size (parent + children). The modal fires doSendSelected
    // with the chosen courier id (or null for unassigned).
    const expanded = expandMultiboxSiblings(state.selectedJobIds, state.jobs);
    setSendSelectedModal({ expandedJobIds: expanded });
  };

  const doSendSelected = async (expandedJobIds: number[], courierId: number | null) => {
    try {
      const runName = `Selected ${new Date().toISOString().slice(0, 10)}`;
      const res = await runService.dispatchJobs(expandedJobIds, courierId, runName);
      const failures = res.response.filter((r) => r.result !== 'Success').length;
      if (failures === 0) {
        toast.show(`Dispatched ${res.response.length} job(s) to Live`, 'success');
      } else {
        toast.show(`${failures} of ${res.response.length} dispatches failed`, 'warning');
      }
      dispatch({ type: 'CLEAR_MULTISELECT' });
      setSendSelectedModal(null);
      await loadJobsAndRuns(state.filters);
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  };

  // ---- Delivery Window / Build Runs -----------------------------------------
  const openBuildConfig = (withBuild: boolean) => {
    if (withBuild) {
      setBuildConfigModal({ open: true, onConfirm: () => { void doBuildRuns(); } });
    } else {
      setBuildConfigModal({ open: true });
    }
  };
  const saveBuildConfigAndClose = (next: BuildConfig) => {
    setBuildConfig(next);
    saveBuildConfig(next);
    setBuildConfigModal({ open: false });
  };

  /**
   * Build runs from the currently multi-selected jobs.
   * - Delivery Window mode: bucket by window start, split by window minutes.
   * - Max Boxes mode: bucket by postcode, split by client MaxJobsPerRun (default 20).
   * - Vehicle Capacity constraint: caps every run by cumulative cubic.
   * Each resulting bucket becomes a new run named like "DW0600A" (DW mode) or
   * "<postcode>A" (Max Boxes), and the source jobs are assigned to it.
   */
  const doBuildRuns = async () => {
    if (state.selectedJobIds.length === 0) return;
    const selected = state.jobs.filter((j) => state.selectedJobIds.includes(j.bulkJobId));
    const vcOn = buildConfig.vehicleCapacityEnabled;
    const mode = buildConfig.buildParameter;

    // Screen out jobs the current mode can't handle so the operator gets a
    // clean report instead of silent drops.
    const missingWindow = mode === 'deliveryWindow'
      ? selected.filter((j) => !j.scheduleWindowStart || !j.scheduleWindowEnd)
      : [];
    const missingCubic = vcOn
      ? selected.filter((j) => !j.jobCubicM3 || j.jobCubicM3 <= 0)
      : [];
    const missingPostcode = mode === 'maxBoxes'
      ? selected.filter((j) => !j.toPostCode)
      : [];

    const valid = selected.filter((j) => {
      if (mode === 'deliveryWindow' && (!j.scheduleWindowStart || !j.scheduleWindowEnd)) return false;
      if (mode === 'maxBoxes' && !j.toPostCode) return false;
      if (vcOn && (!j.jobCubicM3 || j.jobCubicM3 <= 0)) return false;
      return true;
    });

    if (valid.length === 0) {
      toast.show('No valid jobs to build - check schedule windows / cubic dimensions.', 'error');
      return;
    }

    const buckets = bucketJobs(valid, mode);
    if (buckets.length === 0) {
      toast.show('No buckets formed from selection.', 'warning');
      return;
    }

    // P1.11 pre-build preview. Show the bucket table + skip counts and wait
    // for the operator to confirm before firing the heavy HERE + create-run
    // + assign loop below. Skips get elevated into a proper listing (was a
    // toast) so the operator can eyeball the losses before committing.
    const preview: BuildBucketPreview[] = buckets.map((b) => {
      let windowLabel: string | null = null;
      if (mode === 'deliveryWindow' && b.jobs.length > 0) {
        const start = b.jobs[0].scheduleWindowStart;
        // Earliest end across the bucket (per 2026-07-08 amendment).
        const earliestEnd = b.jobs.reduce<string | null>((m, j) => {
          if (!j.scheduleWindowEnd) return m;
          if (!m) return j.scheduleWindowEnd;
          return new Date(j.scheduleWindowEnd) < new Date(m) ? j.scheduleWindowEnd : m;
        }, null);
        if (start && earliestEnd) {
          const fmt = (iso: string) => {
            const d = new Date(iso);
            return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
          };
          windowLabel = `${fmt(start)} - ${fmt(earliestEnd)}`;
        }
      }
      return {
        key: b.key,
        hhmm: b.hhmm,
        jobCount: b.jobs.length,
        windowLabel,
      };
    });
    const skips: BuildSkipReport = {
      missingWindow: missingWindow.length,
      missingCubic: missingCubic.length,
      missingPostcode: missingPostcode.length,
    };

    setBuildAlert({
      buckets: preview,
      skips,
      totalValid: valid.length,
      execute: () => runBuildExecution(buckets, mode, vcOn),
    });
  };

  /**
   * Actual heavy execution split out of doBuildRuns for the P1.11 preview
   * flow. Same code that used to live inline - just moved so the pre-build
   * alert can gate on operator confirm.
   */
  const runBuildExecution = async (
    buckets: ReturnType<typeof bucketJobs>,
    mode: 'maxBoxes' | 'deliveryWindow',
    vcOn: boolean,
  ) => {
    setBuildAlert(null);

    const labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const runsToCreate: { name: string; jobs: BulkJob[] }[] = [];

    for (const bucket of buckets) {
      let orderedJobs = bucket.jobs; // already ToPostCode-sorted for DW mode
      let windowMins: number | null = null;
      let legMinutes: number[] | null = null;

      if (mode === 'deliveryWindow') {
        // Cap against the earliest WindowEnd in the bucket (per 2026-07-08 amendment).
        const earliestEnd = orderedJobs.reduce<string | null>(
          (m, j) => {
            if (!j.scheduleWindowEnd) return m;
            if (!m) return j.scheduleWindowEnd;
            return new Date(j.scheduleWindowEnd) < new Date(m) ? j.scheduleWindowEnd : m;
          },
          null
        );
        windowMins = windowMinutes(orderedJobs[0].scheduleWindowStart, earliestEnd);

        // Call HERE findsequence2 to (a) reorder the bucket into HERE's
        // optimised sequence and (b) get real per-leg travel times so the
        // window-fit check in splitOrderedJobsByConstraints uses real driving
        // minutes, not just per-stop overhead. Falls back to the postcode
        // order + 0 leg minutes if HERE fails or the bucket has no coords.
        const withCoords = orderedJobs.filter(
          (j) => j.deliveryLatitude && j.deliveryLongitude
        );
        // Auto route off: skip HERE and use the postcode-sorted order that
        // arrived from bucketJobs. Legacy routeSetting.autoRoute check.
        if (autoRoute && withCoords.length >= 2) {
          // P2.6 legacy homeControl.js:3737-3809 - HERE's findsequence2 hard-
          // errors above ~200 stops. For those buckets fall back to RouteSavvy
          // (which has no waypoint cap) and interpolate leg minutes from the
          // total. Same fallback the manual per-run "Optimise" path uses
          // (I0.02, handleOptimizeRun overThreshold branch).
          const overThreshold = withCoords.length > 200;
          try {
            if (overThreshold) {
              toast.show(`Bucket has ${withCoords.length} stops - using RouteSavvy (HERE limit 200)`, 'info');
              const waypoints: SavvyLocation[] = withCoords.map((j) => ({
                name: j.jobNumber ?? String(j.bulkJobId),
                latitude: Number(j.deliveryLatitude),
                longitude: Number(j.deliveryLongitude),
                visitDurationInMinutes: 0,
              }));
              const res = await routeService.optimizeWithName(waypoints);
              const nameToOrder = new Map<string, number>();
              res.routes.forEach((r, i) => { if (r.name) nameToOrder.set(r.name, i + 1); });
              // Re-order the whole bucket using the RouteSavvy sequence. Jobs
              // without a returned order (dropped or unnamed) fall to the end
              // in their original order so nothing gets silently lost.
              const reordered = [...orderedJobs].sort((a, b) => {
                const an = a.jobNumber ?? String(a.bulkJobId);
                const bn = b.jobNumber ?? String(b.bulkJobId);
                return (nameToOrder.get(an) ?? Number.MAX_SAFE_INTEGER)
                     - (nameToOrder.get(bn) ?? Number.MAX_SAFE_INTEGER);
              });
              orderedJobs = reordered;
              // RouteSavvy response has no per-leg times; approximate travel
              // via proportional split. Legacy homeControl.js:3791-3793 uses
              // the same trick. Buckets over 200 are rare enough that this
              // window-fit approximation is fine for MVP.
              const totalMinutes = 0; // RouteSavvy response shape in this codebase omits totalTime
              const perStop = orderedJobs.length > 0 ? totalMinutes / orderedJobs.length : 0;
              legMinutes = orderedJobs.map(() => perStop);
            } else {
              const first = withCoords[0];
              // Use the first job's pickup as the start; if pickup missing,
              // use its delivery as a poor-man's proxy.
              const startLat = Number(first.pickUpLatitude ?? first.deliveryLatitude);
              const startLng = Number(first.pickUpLongitude ?? first.deliveryLongitude);
              const destinations = withCoords.map((j) => ({
                name: j.jobNumber ?? String(j.bulkJobId),
                lat: Number(j.deliveryLatitude),
                lng: Number(j.deliveryLongitude),
              }));
              // Route Builder routing mode (Plan §Phase 2 §6):
              //   'aToA'         -> tell HERE to return to origin (end=start)
              //   'finishAtStop' -> pin the nominated job as HERE's `end`
              //   'aToB'         -> HERE default, no extras
              const finishAtJob = buildConfig.routingMode === 'finishAtStop' && buildConfig.finishAtBulkJobId
                ? withCoords.find((j) => j.bulkJobId === buildConfig.finishAtBulkJobId)
                : undefined;
              const seq = await routeService.hereSequenceTyped(
                { name: 'start', lat: startLat, lng: startLng },
                destinations,
                {
                  returnToStart: buildConfig.routingMode === 'aToA',
                  finishAtName: finishAtJob ? (finishAtJob.jobNumber ?? String(finishAtJob.bulkJobId)) : null,
                }
              );
              if (seq && seq.orderedNames.length > 0) {
                // Map HERE's ordered names back to job objects. Drop the start
                // entry (its "name" is the literal 'start'), keep the rest.
                const byName = new Map<string, typeof orderedJobs[number]>();
                orderedJobs.forEach((j) => {
                  const n = j.jobNumber ?? String(j.bulkJobId);
                  byName.set(n, j);
                });
                const reordered: typeof orderedJobs = [];
                const legs: number[] = [];
                seq.orderedNames.forEach((n, i) => {
                  const j = byName.get(n);
                  if (j) {
                    reordered.push(j);
                    legs.push(seq.legMinutes[i] ?? 0);
                  }
                });
                if (reordered.length > 0) {
                  orderedJobs = reordered;
                  legMinutes = legs;
                }
              }
            }
          } catch (e) {
            // Log to console; toast would be noisy since the build still
            // works (just with less accurate window-fit checks).
            console.warn('Route optimisation failed, falling back to postcode order', e);
          }
        }
      }

      // Max Boxes cap: legacy reads client.MaxJobsPerRun from tucClient (with
      // ISNULL(...,20) fallback). Now that BulkJobDto surfaces it, honour the
      // per-client override; fall back to 20 when a client hasn't set one.
      const clientCap = mode === 'maxBoxes'
        ? (orderedJobs[0]?.maxJobsPerRun ?? 20)
        : null;
      // Pickup-cutoff cap (Plan §Phase 2 §6.5). Applied when the operator
      // ticks "Respect pickup cutoff" AND the bucket's schedule has a real
      // pickupCutoffHours. Cutoff converts to minutes-since-run-start by
      // interpreting it as "the pickup must clear within N hours" so we cap
      // the run's total (travel + N*mps) at that many minutes.
      const pickupCutoffMins = buildConfig.respectPickupCutoff
        ? (() => {
            const withCutoff = orderedJobs.find((j) => j.applyPickupCutoff && j.pickupCutoffHours);
            return withCutoff ? withCutoff.pickupCutoffHours! * 60 : null;
          })()
        : null;

      const dividedRuns = splitOrderedJobsByConstraints(orderedJobs, {
        minutesPerStop: buildConfig.minutesPerStop,
        maxBoxesCap: clientCap,
        windowMins,
        legMinutes,
        vehicleCubicCap: vcOn ? buildConfig.vehicleCubicCap : null,
        pickupCutoffMins,
      });

      dividedRuns.forEach((jobs, i) => {
        const suffix = labels[i % labels.length];
        const base = mode === 'deliveryWindow' && bucket.hhmm
          ? `DW${bucket.hhmm}`
          : bucket.key;
        runsToCreate.push({ name: `${base}${suffix}`, jobs });
      });
    }

    if (runsToCreate.length === 0) {
      toast.show('Nothing to build after splitting.', 'warning');
      return;
    }

    // Create each run WITH its jobs + builderIndex populated in the same
    // insertOrUpdate call. Previously this looped assignJob() per-job after
    // creating an empty run, which persisted the BulkRunID link but NEVER
    // stamped PickRunOrder - so the `#` column in Run Builder rendered as
    // all dashes and the map pins stayed the unassigned/red colour until
    // the operator manually re-optimised. Matching the Route+Lock path
    // (handleOptimizeRun above ~630) which already does this correctly.
    let createdRuns = 0;
    let assignedJobs = 0;
    let firstCreatedRunId: number | null = null;
    for (const r of runsToCreate) {
      try {
        // Routing-mode fields (Plan §Phase 2 §6): persisted at run creation so
        // subsequent Optimise / dispatch honours what the operator picked in
        // the build config. Finish-at-stop only applies when the nominated
        // job is actually in THIS run's job list; otherwise leave it null so
        // HERE falls back to A-B on that run.
        const finishAtInThisRun = buildConfig.routingMode === 'finishAtStop'
          && buildConfig.finishAtBulkJobId != null
          && r.jobs.some((j) => j.bulkJobId === buildConfig.finishAtBulkJobId)
          ? buildConfig.finishAtBulkJobId
          : null;
        const routingModeNumeric =
          buildConfig.routingMode === 'aToA' ? 1
            : buildConfig.routingMode === 'finishAtStop' && finishAtInThisRun ? 2
            : 0;

        const body: InsertOrUpdateRunBody = {
          id: null,
          name: r.name,
          mins: Math.round(r.jobs.length * buildConfig.minutesPerStop),
          kms: 0,
          status: 0,
          revenue: null,
          payout: null,
          courier: null,
          courierPercent: null,
          googleRouteResponse: null,
          jobs: r.jobs.map((j, idx) => ({
            bulkJobId: j.bulkJobId,
            builderIndex: idx + 1,
            jobNumber: j.jobNumber,
          })),
          despatchDateTime: state.filters.date,
          noReroute: buildConfig.noReroute,
          routingMode: routingModeNumeric,
          finishAtBulkJobId: finishAtInThisRun,
        };
        const created = await runService.insertOrUpdate(body);
        if (created.response.result !== 'Success') continue;
        const runId = Number(created.response.message);
        createdRuns++;
        assignedJobs += r.jobs.length;
        if (firstCreatedRunId == null) firstCreatedRunId = runId;
      } catch (e) {
        toast.show(`Run "${r.name}" build failed: ${(e as Error).message}`, 'error');
      }
    }

    toast.show(`Built ${createdRuns} run(s) with ${assignedJobs} job(s)`, 'success');
    dispatch({ type: 'CLEAR_MULTISELECT' });
    setBuildConfigModal({ open: false });
    await loadJobsAndRuns(state.filters);
    // Auto-select the first newly-built run so the operator immediately
    // sees its jobs in Run Builder and coloured/sequenced pins on the map,
    // instead of having to manually click the row after Build closes.
    if (firstCreatedRunId != null) {
      dispatch({ type: 'SELECT_RUN', payload: firstCreatedRunId });
    }
  };

  // ---- Layout save/load -----------------------------------------------------
  const handleSaveLayout = (name: string) => {
    const snap: CockpitLayout = {
      name,
      horizontal: horizontalRef.current?.getLayout() ?? DEFAULT_LAYOUT.horizontal,
      leftVertical: leftVerticalRef.current?.getLayout() ?? DEFAULT_LAYOUT.leftVertical,
      runVertical: runVerticalRef.current?.getLayout() ?? DEFAULT_LAYOUT.runVertical,
    };
    const next = upsertLayout(layouts, snap);
    setLayouts(next);
    saveLayouts(next);
    toast.show(`Layout "${name}" saved`, 'success');
  };
  const handleLoadLayout = (layout: CockpitLayout) => {
    horizontalRef.current?.setLayout(layout.horizontal);
    leftVerticalRef.current?.setLayout(layout.leftVertical);
    runVerticalRef.current?.setLayout(layout.runVertical);
    toast.show(`Layout "${layout.name}" applied`, 'info');
  };
  const handleDeleteLayout = (name: string) => {
    const next = deleteLayout(layouts, name);
    setLayouts(next);
    saveLayouts(next);
    toast.show(`Layout "${name}" deleted`, 'info');
  };

  // ---- Filter presets (Plan §Phase 3 §7) -----------------------------------
  const handleSaveFilterPreset = (name: string) => {
    // Deep-clone the filters snapshot so subsequent mutations don't leak.
    const preset: FilterPreset = {
      name,
      filters: JSON.parse(JSON.stringify(state.filters)),
    };
    const next = upsertFilterPreset(filterPresets, preset);
    setFilterPresets(next);
    saveFilterPresets(next);
    toast.show(`Preset "${name}" saved`, 'success');
  };
  const handleLoadFilterPreset = (preset: FilterPreset) => {
    // Keep the date from the current filter - operators almost never want
    // yesterday's date to come back with a preset.
    dispatch({
      type: 'SET_FILTER',
      payload: {
        clientIds: preset.filters.clientIds,
        regionIds: preset.filters.regionIds,
        ourRefs: preset.filters.ourRefs,
        speeds: preset.filters.speeds,
      },
    });
    toast.show(`Preset "${preset.name}" applied`, 'info');
  };
  const handleDeleteFilterPreset = (name: string) => {
    const next = deleteFilterPreset(filterPresets, name);
    setFilterPresets(next);
    saveFilterPresets(next);
    toast.show(`Preset "${name}" deleted`, 'info');
  };

  // ---- multi-select helpers -------------------------------------------------
  const handleToggleAllMultiselect = () => {
    // Operate over the CURRENTLY VISIBLE jobs, not the raw state.jobs. Legacy
    // jobList.tpl's "select all" checkbox is scoped to the ng-repeat, so hidden
    // rows (bulkRunId-attached, void-filtered, size-filtered, search-filtered)
    // are not toggled. React equivalent: `displayedJobs`.
    const visibleIds = displayedJobs.map((j) => j.bulkJobId);
    const allVisibleSelected = visibleIds.length > 0
      && visibleIds.every((id) => state.selectedJobIds.includes(id));
    if (allVisibleSelected) {
      dispatch({ type: 'CLEAR_MULTISELECT' });
    } else {
      dispatch({ type: 'REPLACE_MULTISELECT', payload: visibleIds });
    }
  };

  const handleToggleAllRunMultiselect = () => {
    if (state.selectedRunIds.length === displayedRuns.length) {
      dispatch({ type: 'CLEAR_RUN_MULTISELECT' });
    } else {
      dispatch({ type: 'REPLACE_RUN_MULTISELECT', payload: displayedRuns.map((r) => r.id) });
    }
  };

  const bulkLockSelected = async (lock: boolean) => {
    const targets = state.runs.filter((r) => state.selectedRunIds.includes(r.id) && ((r.status ?? 0) > 0) !== lock);
    if (targets.length === 0) return;
    // Single reload at the end - the per-item handleLockRun would fire one
    // reload per run, N sequential full re-fetches, on a bulk of 20+ runs.
    let ok = 0;
    for (const r of targets) {
      try {
        const body = runToBody(r, { status: lock ? 1 : 0 });
        const res = await runService.update(r.id, body);
        if (res.response.result === 'Success') ok++;
      } catch { /* keep going */ }
    }
    toast.show(`${lock ? 'Locked' : 'Unlocked'} ${ok} of ${targets.length} run(s)`, ok === targets.length ? 'success' : 'warning');
    await loadJobsAndRuns(state.filters);
  };

  const handleBulkDispatchSelected = async () => {
    const locked = state.runs.filter((r) => state.selectedRunIds.includes(r.id) && (r.status ?? 0) > 0);
    if (locked.length === 0) return;
    const proceed = await confirm({
      title: 'Dispatch selection',
      message: `Dispatch ${locked.length} locked run(s) from selection?`,
      confirmLabel: 'Dispatch',
    });
    if (!proceed) return;
    try {
      const body = locked.map((r) => runToBody(r, {}));
      const res = await runService.dispatch(body);
      const failures = res.response.filter((r) => r.result !== 'Success').length;
      if (failures === 0) toast.show(`Dispatched ${res.response.length} assignment(s)`, 'success');
      else toast.show(`${failures} of ${res.response.length} failed`, 'warning');
      dispatch({ type: 'CLEAR_RUN_MULTISELECT' });
      await loadJobsAndRuns(state.filters);
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  };

  const handleBulkDeleteSelected = async () => {
    if (state.selectedRunIds.length === 0) return;
    const proceed = await confirm({
      title: 'Delete runs',
      message: `Delete ${state.selectedRunIds.length} run(s)? Jobs stay behind unassigned.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!proceed) return;
    // Single reload at the end (see bulkLockSelected for rationale).
    let ok = 0;
    const targetIds = [...state.selectedRunIds];
    for (const id of targetIds) {
      try {
        const res = await runService.remove(id);
        if (res.response.result === 'Success') {
          ok++;
          if (state.selectedRunId === id) dispatch({ type: 'SELECT_RUN', payload: null });
        }
      } catch { /* keep going */ }
    }
    toast.show(`Deleted ${ok} of ${targetIds.length} run(s)`, ok === targetIds.length ? 'success' : 'warning');
    dispatch({ type: 'CLEAR_RUN_MULTISELECT' });
    await loadJobsAndRuns(state.filters);
  };

  // ---- context-menu factories ----------------------------------------------
  const jobContextMenu = (job: BulkJob): ContextMenuItem[] => [
    { label: 'Show on map', onClick: () => dispatch({ type: 'SELECT_JOB', payload: job.bulkJobId }) },
    { label: 'Fix GPS...', onClick: () => setGpsFixJob({ job }), separatorAfter: true },
    { label: `Void job ${job.jobNumber ?? job.bulkJobId}`, onClick: () => {
      void voidWithIds([job.bulkJobId], true);
    }, danger: true },
    ...(job.bulkRunId ? [{
      label: 'Remove from run',
      onClick: () => handleRemoveJobFromRun(job.bulkJobId),
      danger: true,
    }] : []),
  ];

  const groupContextMenu = (jobIds: number[], label: string, isTimeGroup: boolean): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      { label: `Multi-select ${jobIds.length} job(s)`, onClick: () => dispatch({ type: 'REPLACE_MULTISELECT', payload: jobIds }) },
    ];
    if (isTimeGroup) {
      // Legacy groupedTimeMenu "Open these times" - highlight the same time
      // bucket in the Jobs list so operators can eyeball what's in the slot.
      items.push({ label: 'Open these times in Jobs list', onClick: () => {
        dispatch({ type: 'REPLACE_MULTISELECT', payload: jobIds });
        dispatch({ type: 'SET_JOB_SEARCH', payload: label });
      }});
      // P2.2 Legacy setTime (homeControl.js:4099-4162): after multi-selecting
      // a time bucket the operator wanted to "collapse" back into postcode
      // groups (so they can then bucket the jobs into runs by geography). If
      // the selected bucket's bookTime range spans > 1 hour it also warns -
      // longer windows almost never split cleanly into a single run and the
      // operator likely meant to pick a narrower slot. Alert first, then
      // switch group mode + multi-select regardless (matches legacy: legacy
      // ONLY alerts, never blocks).
      items.push({ label: 'Multi-select and sort by postcode', onClick: () => {
        const bucketJobs = state.jobs.filter((j) => jobIds.includes(j.bulkJobId));
        const spread = bookTimeSpreadMs(bucketJobs);
        if (spread != null && spread > 60 * 60 * 1000) {
          void alert({
            title: 'Wide time range',
            message: `WARNING: The time range you have picked spans ${Math.round(spread / 60000)} minutes (>1 hour).`,
          });
        }
        dispatch({ type: 'REPLACE_MULTISELECT', payload: jobIds });
        dispatch({ type: 'SET_GROUP_MODE', payload: 'postcode' });
      }});
      items.push({ label: 'Edit Group Date...', onClick: () => {
        dispatch({ type: 'REPLACE_MULTISELECT', payload: jobIds });
        setBulkMoveOpen(true);
      }, separatorAfter: true });
    } else {
      // Postcode-mode: "Create Run From Group" (P1.5, legacy homeControl.js:4337-4342).
      // One click creates a fresh run named after the bucket key (e.g. "3110")
      // and drops every job in the bucket onto it.
      items.push({ label: `Create run from these ${jobIds.length} job(s)`, onClick: () => {
        void createRunFromGroup(label, jobIds);
      } });
      items.push({ label: 'Move to another date...', onClick: () => {
        dispatch({ type: 'REPLACE_MULTISELECT', payload: jobIds });
        setBulkMoveOpen(true);
      }, separatorAfter: true });
    }
    items.push({ label: `Void all in ${label}`, onClick: () => {
      void voidWithIds(jobIds, true);
    }, danger: true });
    return items;
  };

  /**
   * P1.5 helper. Creates a new run named after the group label (postcode)
   * and immediately assigns the group's jobs to it. Uses the existing
   * POST /api/runs + assign path so the flow matches manual create + drag.
   */
  const createRunFromGroup = async (groupLabel: string, jobIds: number[]) => {
    if (jobIds.length === 0) return;
    try {
      const body: InsertOrUpdateRunBody = {
        id: null,
        name: groupLabel,
        mins: 0,
        kms: 0,
        status: 0,
        revenue: null,
        payout: null,
        courier: null,
        courierPercent: null,
        googleRouteResponse: null,
        jobs: [],
        despatchDateTime: state.filters.date,
      };
      const created = await runService.insertOrUpdate(body);
      if (created.response.result !== 'Success') {
        toast.show(created.response.message ?? 'Create run failed', 'error');
        return;
      }
      const runId = Number(created.response.message);
      await assignJobsToRun(runId, jobIds);
      toast.show(`Created run "${groupLabel}" with ${jobIds.length} job(s)`, 'success');
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  };

  const runContextMenu = (run: Run, helpers: { startRename: () => void }): ContextMenuItem[] => {
    const locked = (run.status ?? 0) > 0;
    return [
      { label: 'Select', onClick: () => dispatch({ type: 'SELECT_RUN', payload: run.id }) },
      { label: 'Rename...', onClick: helpers.startRename },
      { label: locked ? 'Unlock' : 'Lock', onClick: () => handleLockRun(run.id, !locked) },
      { label: 'Optimise sequence', onClick: () => {
        dispatch({ type: 'SELECT_RUN', payload: run.id });
        void handleOptimizeRun({ runId: run.id });
      }, disabled: run.jobs.length < 2 },
      // Route and Lock: HERE-sequence + status=1 in one step. Legacy
      // homeControl.js:2205-2219. Disabled once locked (no-op) or below
      // 2 jobs (nothing to sequence).
      { label: 'Route and Lock', onClick: () => {
        dispatch({ type: 'SELECT_RUN', payload: run.id });
        void handleOptimizeRun({ runId: run.id, lockAfter: true });
      }, disabled: run.jobs.length < 2 || locked || run.isVoidRun },
      // Edit Route Date (P1.3, legacy homeControl.js:2034-2113). Multi-selects
      // every job on the run and opens the bulk-move-date modal preloaded with
      // the count. Uses the existing POST /api/jobs/bulk-move endpoint.
      { label: 'Edit Route Date...', onClick: () => {
        const ids = run.jobs.map((j) => j.bulkJobId);
        if (ids.length === 0) return;
        dispatch({ type: 'REPLACE_MULTISELECT', payload: ids });
        setBulkMoveOpen(true);
      }, disabled: run.jobs.length === 0 },
      { label: 'Merge into...', onClick: () => setMergeSource(run), disabled: run.jobs.length === 0, separatorAfter: true },
      { label: 'Delete run', onClick: () => handleDeleteRun(run.id), danger: true },
    ];
  };

  /**
   * Merge source run into target run. Callable from the MergeRunModal picker
   * (chosen by target id) - the picker already filtered out locked / self.
   */
  const doMergeRun = async (source: Run, targetId: number) => {
    const target = state.runs.find((r) => r.id === targetId);
    if (!target) return;
    try {
      const jobIds = source.jobs.map((j) => j.bulkJobId);
      await assignJobsToRun(target.id, jobIds);
      await runService.remove(source.id);
      toast.show(`Merged ${jobIds.length} job(s) from "${source.name}" into "${target.name}"`, 'success');
      if (state.selectedRunId === source.id) dispatch({ type: 'SELECT_RUN', payload: target.id });
      setMergeSource(null);
      await loadJobsAndRuns(state.filters);
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  };

  // ---- hotkeys --------------------------------------------------------------
  // Ctrl+D dispatches (locked runs or selected jobs), Ctrl+A selects all
  // visible jobs, Esc clears the current selection, Del removes the focused
  // job from its run. Matches the legacy hotkeys.add() bindings.

  // P2.3 arrow-key row navigation. Scope depends on the last-focused pane:
  //   jobs   -> move selection within displayedJobs
  //   runs   -> move selection within displayedRuns (updates selectedRunId)
  //   groups -> also acts on displayedJobs (groups is a projection of jobs)
  // Wraps at both ends so continuous presses cycle round.
  const navigateSelection = (delta: -1 | 1) => {
    if (activePane === 'runs') {
      if (displayedRuns.length === 0) return;
      const idx = displayedRuns.findIndex((r) => r.id === state.selectedRunId);
      const nextIdx = idx < 0
        ? (delta === 1 ? 0 : displayedRuns.length - 1)
        : (idx + delta + displayedRuns.length) % displayedRuns.length;
      dispatch({ type: 'SELECT_RUN', payload: displayedRuns[nextIdx].id });
      return;
    }
    // jobs + groups pane share the same underlying displayedJobs list.
    if (displayedJobs.length === 0) return;
    const idx = displayedJobs.findIndex((j) => j.bulkJobId === state.selectedJobId);
    const nextIdx = idx < 0
      ? (delta === 1 ? 0 : displayedJobs.length - 1)
      : (idx + delta + displayedJobs.length) % displayedJobs.length;
    dispatch({ type: 'SELECT_JOB', payload: displayedJobs[nextIdx].bulkJobId });
  };

  useHotkeys({
    onDispatch: () => {
      if (state.selectedJobIds.length > 0) void handleSendSelected();
      else void handleDispatch();
    },
    onSelectAll: () => {
      // Ctrl+A follows the last-focused pane. Jobs and Groups act on jobs,
      // Runs acts on runs. Legacy hotkeys.js dispatched to activeTable.
      if (activePane === 'runs') {
        dispatch({ type: 'REPLACE_RUN_MULTISELECT', payload: displayedRuns.map((r) => r.id) });
      } else {
        dispatch({ type: 'REPLACE_MULTISELECT', payload: displayedJobs.map((j) => j.bulkJobId) });
      }
    },
    onEscape: () => {
      if (bulkMoveOpen) setBulkMoveOpen(false);
      else if (optimizePreview) setOptimizePreview(null);
      else if (buildConfigModal.open) setBuildConfigModal({ open: false });
      else if (gpsFixJob) setGpsFixJob(null);
      else if (sendSelectedModal) setSendSelectedModal(null);
      else if (state.selectedJobIds.length > 0) dispatch({ type: 'CLEAR_MULTISELECT' });
      else if (state.selectedRunIds.length > 0) dispatch({ type: 'CLEAR_RUN_MULTISELECT' });
    },
    onDelete: () => {
      // Two paths for Del: selectedJob is a Jobs-list row that has a bulkRunId
      // (rare - most jobs on runs are filtered out of state.jobs), OR the
      // selected id lives inside a run's jobs array (the common Run Builder
      // case). selectedJobRunId covers the second.
      if (selectedJob && selectedJob.bulkRunId) {
        void handleRemoveJobFromRun(selectedJob.bulkJobId);
      } else if (state.selectedJobId != null && selectedJobRunId != null) {
        void handleRemoveJobFromRun(state.selectedJobId);
      }
    },
    // Legacy: Enter submits whichever modal is open. In practice each modal
    // already binds its own Enter key on primary buttons; this handler covers
    // the case where the focus isn't inside the modal's input (e.g. after
    // the modal opened but before the operator clicked into a field).
    onEnter: () => {
      const modal = document.querySelector<HTMLElement>('[data-modal-open="true"]');
      if (!modal) return;
      const primaryBtn = modal.querySelector<HTMLButtonElement>('button[data-primary="true"]')
        ?? modal.querySelector<HTMLButtonElement>('button.bg-brand-purple, button.bg-brand-cyan, button.bg-error');
      primaryBtn?.click();
    },
    // Arrow keys map through to the shared navigateSelection helper defined
    // just above so both hotkey handlers share one implementation.
    onArrowUp: () => navigateSelection(-1),
    onArrowDown: () => navigateSelection(1),
  });

  // Stable refs for GoogleMap props so its marker useEffect doesn't tear down
  // and rebuild every pin on every parent render.
  const mapMultiSelectedRuns = useMemo(
    () => state.runs.filter((r) => state.selectedRunIds.includes(r.id)),
    [state.runs, state.selectedRunIds],
  );
  const handleMapPinClick = useCallback(
    (jobId: number) => dispatch({ type: 'SELECT_JOB', payload: jobId }),
    [dispatch],
  );
  const handleMapPinContextMenu = useCallback(
    (t: MapContextTarget) => setMapContext(t),
    [],
  );
  // L2.P2.3 Grey-pin one-click adds an unassigned job to the currently
  // selected run. GoogleMap.tsx only fires this when the pin is grey AND a
  // selected run is present AND the run is still editable - so no extra
  // guard needed here beyond routing to the existing assignJobsToRun path.
  const handleAddToRunFromMap = useCallback(
    (jobId: number, runId: number) => { void assignJobsToRun(runId, [jobId]); },
    [assignJobsToRun],
  );

  const runBuilderContextMenu = (job: RunJob, _run: Run): ContextMenuItem[] => [
    { label: `Show job ${job.jobNumber ?? job.bulkJobId}`, onClick: () => dispatch({ type: 'SELECT_JOB', payload: job.bulkJobId }) },
    { label: 'Remove from run', onClick: () => handleRemoveJobFromRun(job.bulkJobId), danger: true },
  ];

  return (
    <div className="h-full flex flex-col">
      <FiltersBar
        filters={state.filters}
        regions={state.regions}
        speeds={state.speeds}
        clients={clients}
        ourRefs={ourRefs}
        onChange={(patch) => dispatch({ type: 'SET_FILTER', payload: patch })}
        onRefresh={() => loadJobsAndRuns(state.filters)}
        onSyncHd={handleSyncHd}
      />

      {/* Build mode indicator + Build Runs button. Mode button opens the
          config modal to tweak settings; Build Runs opens the same modal and
          confirms it triggers the actual build against the selected jobs. */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-cream border-b border-border-light text-xs">
        <span className="text-text-muted">Build mode:</span>
        <Button
          variant="primary"
          size="sm"
          onClick={() => openBuildConfig(false)}
          title="Change build configuration"
        >
          {buildModeLabel(buildConfig)}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => openBuildConfig(true)}
          disabled={state.selectedJobIds.length === 0}
          className="ml-2"
          title={state.selectedJobIds.length === 0
            ? 'Select one or more jobs first'
            : `Build runs from ${state.selectedJobIds.length} selected job(s)`}
        >
          Build Runs
        </Button>
        {state.selectedJobIds.length > 0 && (
          <span className="text-text-muted ml-2">
            ({state.selectedJobIds.length} job{state.selectedJobIds.length === 1 ? '' : 's'} selected)
          </span>
        )}
        <div className="flex-1" />
        {/* Auto route: when off, Build Runs skips HERE optimisation and just
            partitions/sorts by postcode or time. Operators use "Optimise" per
            run instead. Legacy routeSetting.autoRoute (homeControl.js:435). */}
        <label className="inline-flex items-center gap-1 text-[10px] text-text-muted select-none mr-2"
               title="When off, Build Runs skips HERE optimisation - useful for slow HERE responses or offline dev">
          <input
            type="checkbox"
            checked={autoRoute}
            onChange={(e) => setAutoRoute(e.target.checked)}
          />
          Auto route
        </label>
        <FilterPresetsMenu
          presets={filterPresets}
          onSave={handleSaveFilterPreset}
          onLoad={handleLoadFilterPreset}
          onDelete={handleDeleteFilterPreset}
        />
        <LayoutMenu
          layouts={layouts}
          onSave={handleSaveLayout}
          onLoad={handleLoadLayout}
          onDelete={handleDeleteLayout}
        />
      </div>

      <ActionToolbar
        selectedJobCount={state.selectedJobIds.length}
        onVoid={() => handleVoid(true)}
        onUnvoid={() => handleVoid(false)}
        onBulkMoveDate={() => setBulkMoveOpen(true)}
        onSendSelected={handleSendSelected}
        onClearSelection={() => dispatch({ type: 'CLEAR_MULTISELECT' })}
      />

      <div className="flex-1 min-h-0">
        <PanelGroup direction="horizontal" ref={horizontalRef}>
          <Panel defaultSize={28} minSize={15}>
            <PanelGroup direction="vertical" ref={leftVerticalRef}>
              <Panel defaultSize={25} minSize={15}>
                <div className="h-full" onMouseDownCapture={() => setActivePane('groups')}>
                <GroupedJobs
                  jobs={displayedJobs}
                  search={state.groupSearch}
                  mode={state.groupMode}
                  onSetMode={(m) => dispatch({ type: 'SET_GROUP_MODE', payload: m })}
                  onSetSearch={(s) => dispatch({ type: 'SET_GROUP_SEARCH', payload: s })}
                  onSelectGroup={(ids) => dispatch({ type: 'REPLACE_MULTISELECT', payload: ids })}
                  onBulkMoveGroup={(ids) => {
                    dispatch({ type: 'REPLACE_MULTISELECT', payload: ids });
                    setBulkMoveOpen(true);
                  }}
                  onContextMenuItems={(ids, label, isTime) => groupContextMenu(ids, label, isTime)}
                  onDragStart={(ids) => dispatch({ type: 'REPLACE_MULTISELECT', payload: ids })}
                />
                </div>
              </Panel>
              <PanelResizeHandle className="h-1" />
              <Panel defaultSize={45} minSize={20}>
                <div className="h-full" onMouseDownCapture={() => setActivePane('jobs')}>
                <JobsList
                  jobs={displayedJobs}
                  sort={state.jobSort}
                  sizeFilter={state.sizeFilter}
                  search={state.jobSearch}
                  onSetSort={(m) => dispatch({ type: 'SET_JOB_SORT', payload: m })}
                  onSetSizeFilter={(f) => dispatch({ type: 'SET_SIZE_FILTER', payload: f })}
                  onSetSearch={(s) => dispatch({ type: 'SET_JOB_SEARCH', payload: s })}
                  selectedJobId={state.selectedJobId}
                  selectedJobIds={state.selectedJobIds}
                  onSelectJob={(id) => dispatch({ type: 'SELECT_JOB', payload: id })}
                  onToggleMultiselect={(id) => dispatch({ type: 'TOGGLE_JOB_MULTISELECT', payload: id })}
                  onToggleAllMultiselect={handleToggleAllMultiselect}
                  onContextMenuItems={(job) => jobContextMenu(job)}
                />
                </div>
              </Panel>
              <PanelResizeHandle className="h-1" />
              <Panel defaultSize={30} minSize={15}>
                <JobDetail
                  job={selectedJob}
                  speeds={state.speeds}
                  onUpdateField={handleUpdateJobField}
                  onOpenGpsFix={(j, leg) => setGpsFixJob({ job: j, leg })}
                />
              </Panel>
            </PanelGroup>
          </Panel>

          <PanelResizeHandle className="w-1" />

          <Panel defaultSize={26} minSize={15}>
            <PanelGroup direction="vertical" ref={runVerticalRef}>
              <Panel defaultSize={50} minSize={20}>
                <div className="h-full flex flex-col" onMouseDownCapture={() => setActivePane('runs')}>
                <RunActionToolbar
                  selectedRunCount={state.selectedRunIds.length}
                  hasLockedInSelection={state.runs.some((r) => state.selectedRunIds.includes(r.id) && (r.status ?? 0) > 0)}
                  hasUnlockedInSelection={state.runs.some((r) => state.selectedRunIds.includes(r.id) && (r.status ?? 0) === 0)}
                  onLockAll={() => bulkLockSelected(true)}
                  onUnlockAll={() => bulkLockSelected(false)}
                  onDispatchAll={handleBulkDispatchSelected}
                  onDeleteAll={handleBulkDeleteSelected}
                  onClearSelection={() => dispatch({ type: 'CLEAR_RUN_MULTISELECT' })}
                />
                <RunList
                  runs={displayedRuns}
                  allJobs={state.jobs}
                  couriers={allCouriers}
                  selectedRunId={state.selectedRunId}
                  selectedRunIds={state.selectedRunIds}
                  sort={state.runSort}
                  search={state.runSearch}
                  onSetSort={(s) => dispatch({ type: 'SET_RUN_SORT', payload: s })}
                  onSetSearch={(s) => dispatch({ type: 'SET_RUN_SEARCH', payload: s })}
                  onSelectRun={(id) => dispatch({ type: 'SELECT_RUN', payload: id })}
                  onToggleRunMultiselect={(id) => dispatch({ type: 'TOGGLE_RUN_MULTISELECT', payload: id })}
                  onToggleAllRunMultiselect={handleToggleAllRunMultiselect}
                  onCreateRun={handleCreateRun}
                  onRenameRun={handleRenameRun}
                  onDeleteRun={handleDeleteRun}
                  onAssignCourier={handleAssignCourier}
                  onLockRun={handleLockRun}
                  onDispatch={handleDispatch}
                  onPrebook={handlePrebook}
                  onAssignSelectedJobs={handleAssignSelectedJobs}
                  onDropJobs={handleDropJobs}
                  onContextMenuItems={(run, helpers) => runContextMenu(run, helpers)}
                  selectedJobCount={state.selectedJobIds.length}
                />
                </div>
              </Panel>
              <PanelResizeHandle className="h-1" />
              <Panel defaultSize={50} minSize={20}>
                <RunBuilder
                  run={selectedRun}
                  selectedJobId={state.selectedJobId}
                  onSelectJob={(id) => dispatch({ type: 'SELECT_JOB', payload: id })}
                  onRemoveJob={handleRemoveJobFromRun}
                  onOptimize={() => { void handleOptimizeRun(); }}
                  onToggleStart={handleToggleStart}
                  onToggleEnd={handleToggleEnd}
                  onVoidJob={handleVoidRunBuilderJob}
                  onUnvoidJob={handleUnvoidRunBuilderJob}
                  onReorderJobs={(r, jobs) => { void handleReorderRunJobs(r, jobs); }}
                />
              </Panel>
            </PanelGroup>
          </Panel>

          <PanelResizeHandle className="w-1" />

          <Panel defaultSize={14} minSize={10}>
            <FleetsPanel
              fleets={state.fleets}
              search={state.fleetSearch}
              onSetSearch={(s) => dispatch({ type: 'SET_FLEET_SEARCH', payload: s })}
            />
          </Panel>

          <PanelResizeHandle className="w-1" />

          <Panel defaultSize={32} minSize={20}>
            <GoogleMap
              // Pass the full jobs list (not displayedJobs) so the map can show
              // both unassigned pins (grey) AND pins for jobs already on runs
              // (coloured). Legacy also renders both sets - the Jobs list
              // filter only affects the LIST, not the map.
              jobs={state.jobs}
              selectedRun={selectedRun}
              // Wire selectedJobId so the map bounces the matching marker
              // whenever the operator picks a job in the Jobs list, Run
              // Builder, or group list. Matches legacy highlightPin(job).
              selectedJobId={state.selectedJobId}
              // Tint pins from every other run the operator has multi-selected
              // in the Run List (legacy MULTI_RUN_COLOURS palette). Skips the
              // primary selectedRun since that already gets sequenced orange.
              // useMemo keeps the array reference stable so GoogleMap's marker
              // useEffect only re-runs when the actual selection changes.
              multiSelectedRuns={mapMultiSelectedRuns}
              onPinClick={handleMapPinClick}
              onPinContextMenu={handleMapPinContextMenu}
              onAddToRunFromMap={handleAddToRunFromMap}
            />
          </Panel>
        </PanelGroup>
      </div>

      <BulkMoveDateModal
        open={bulkMoveOpen}
        jobCount={state.selectedJobIds.length}
        onClose={() => setBulkMoveOpen(false)}
        onConfirm={handleBulkMoveConfirm}
      />

      {optimizePreview && (
        <OptimizePreviewModal
          open={true}
          runName={optimizePreview.runName}
          stops={optimizePreview.stops}
          onClose={() => setOptimizePreview(null)}
          onConfirm={optimizePreview.commit}
        />
      )}

      <BuildConfigModal
        open={buildConfigModal.open}
        config={buildConfig}
        vehicleSizes={vehicleSizes}
        selectedJobCount={state.selectedJobIds.length}
        selectedJobs={state.jobs.filter((j) => state.selectedJobIds.includes(j.bulkJobId))}
        onClose={() => setBuildConfigModal({ open: false })}
        onSave={saveBuildConfigAndClose}
        onConfirm={buildConfigModal.onConfirm}
      />

      {/* P1.11 pre-build preview. Only rendered when doBuildRuns has an
          active pending build; the alert's confirm fires the execute closure. */}
      {buildAlert && (
        <BuildAlertModal
          open={true}
          buckets={buildAlert.buckets}
          skips={buildAlert.skips}
          totalValid={buildAlert.totalValid}
          onCancel={() => setBuildAlert(null)}
          onConfirm={() => { void buildAlert.execute(); }}
        />
      )}

      <MapContextMenu
        target={mapContext}
        runs={state.runs}
        onClose={() => setMapContext(null)}
        onSelectJob={(id) => dispatch({ type: 'SELECT_JOB', payload: id })}
        onAddToRun={(jobId, runId) => assignJobsToRun(runId, [jobId])}
        onRemoveFromRun={(jobId) => handleRemoveJobFromRun(jobId)}
        onTransferToRun={(jobId, _from, toRunId) => assignJobsToRun(toRunId, [jobId])}
        onSetEnd={async (jobId, runId) => {
          const run = state.runs.find((r) => r.id === runId);
          const job = run?.jobs.find((j) => j.bulkJobId === jobId);
          if (run && job) await handleToggleEnd(job, run);
        }}
      />

      <VoidRelationshipDialog
        context={voidDialog}
        onConfirm={(ids) => executeVoid(ids, voidDialog?.isVoid ?? true)}
        onCancel={() => setVoidDialog(null)}
      />

      <MergeRunModal
        open={mergeSource != null}
        source={mergeSource}
        candidates={state.runs.filter((r) =>
          r.id !== mergeSource?.id
          && (r.status ?? 0) === 0
          && !r.isVoidRun
        )}
        onClose={() => setMergeSource(null)}
        onConfirm={(targetId) => { if (mergeSource) void doMergeRun(mergeSource, targetId); }}
      />

      {/* P2.7 Courier picker for Send-Selected. Replaces the legacy window.prompt
          courier-id picker with a proper filterable <select>. */}
      <SendSelectedModal
        open={sendSelectedModal != null}
        jobCount={sendSelectedModal?.expandedJobIds.length ?? 0}
        couriers={allCouriers}
        onClose={() => setSendSelectedModal(null)}
        onConfirm={(courierId) => {
          if (sendSelectedModal) return doSendSelected(sendSelectedModal.expandedJobIds, courierId);
        }}
      />

      <FixGpsModal
        open={gpsFixJob != null}
        job={gpsFixJob?.job ?? null}
        defaultLeg={gpsFixJob?.leg}
        onClose={() => setGpsFixJob(null)}
        onSave={async (jobId, address, lat, lng, postCode) => {
          try {
            const res = await jobService.updateGps(jobId, address, lat, lng, postCode);
            if (res.response === 'Success') {
              toast.show('GPS updated', 'success');
              await loadJobsAndRuns(state.filters);
            } else {
              toast.show('GPS update failed', 'error');
            }
          } catch (e) {
            toast.show((e as Error).message, 'error');
            throw e;
          }
        }}
      />

      {state.loading && (
        <div className="px-3 py-1 text-xs text-text-muted bg-surface-cream border-t border-border-light">
          Loading...
        </div>
      )}
      {state.error && (
        <div className="px-3 py-1 text-xs text-error bg-error-bg border-t border-error/30">
          {state.error}
        </div>
      )}
    </div>
  );
}

/**
 * P2.2 helper. Compute the span (max minus min) in milliseconds of the given
 * jobs' bookTime values. bookTime arrives as an ISO datetime string; jobs
 * without a bookTime are ignored. Returns null when fewer than 2 jobs have a
 * usable bookTime (nothing to span).
 */
function bookTimeSpreadMs(jobs: BulkJob[]): number | null {
  const stamps: number[] = [];
  for (const j of jobs) {
    if (!j.bookTime) continue;
    const t = new Date(j.bookTime).getTime();
    if (!Number.isNaN(t)) stamps.push(t);
  }
  if (stamps.length < 2) return null;
  return Math.max(...stamps) - Math.min(...stamps);
}

function runToBody(run: Run, overrides: Partial<InsertOrUpdateRunBody>): InsertOrUpdateRunBody {
  return {
    id: run.id,
    name: run.name ?? '',
    mins: run.mins,
    kms: run.kms,
    status: run.status,
    revenue: run.revenue,
    payout: run.payout,
    courier: run.courierId
      ? { courierId: run.courierId, courier: run.courierName }
      : null,
    // Math.round avoids float-precision strings like "70.00000000000001%" that
    // legacy code + downstream SPs would then fail to parse cleanly.
    courierPercent: run.courierPercentage != null ? `${Math.round(run.courierPercentage * 100)}%` : null,
    googleRouteResponse: run.googleRouteResponse,
    jobs: run.jobs,
    // Preserve run-level routing fields on every write so lock/rename/etc.
    // don't accidentally reset them to defaults.
    noReroute: run.noReroute,
    routingMode: run.routingMode,
    finishAtBulkJobId: run.finishAtBulkJobId,
    ...overrides,
  };
}
