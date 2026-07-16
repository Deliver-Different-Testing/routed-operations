import { useCallback, useEffect, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelGroupHandle } from 'react-resizable-panels';
import { useCockpitState } from './CockpitState';
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
import { bucketJobs, buildModeLabel, loadBuildConfig, saveBuildConfig, splitOrderedJobsByConstraints, windowMinutes } from '../../lib/buildConfig';
import { expandMultiboxSiblings } from '../../lib/multibox';
import { VoidRelationshipDialog, type VoidRelationshipContext } from './VoidRelationshipDialog';
import { sortJobs, sortRuns } from '../../lib/sortLists';
import { RunActionToolbar } from './RunActionToolbar';
import type { ContextMenuItem } from './RowContextMenu';
import { useHotkeys } from '../../hooks/useHotkeys';

interface ClientOption { id: number; label: string; }

export function CockpitPage() {
  const [state, dispatch] = useCockpitState();
  const toast = useToast();
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [allCouriers, setAllCouriers] = useState<Courier[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [ourRefs, setOurRefs] = useState<string[]>([]);
  const [optimizePreview, setOptimizePreview] = useState<{ runName: string; stops: OptimizeStop[]; commit: () => Promise<void> } | null>(null);
  const [vehicleSizes, setVehicleSizes] = useState<VehicleSize[]>([]);
  const [buildConfig, setBuildConfig] = useState<BuildConfig>(() => loadBuildConfig());
  const [buildConfigModal, setBuildConfigModal] = useState<{ open: boolean; onConfirm?: () => void }>({ open: false });
  const [mapContext, setMapContext] = useState<MapContextTarget | null>(null);
  const [gpsFixJob, setGpsFixJob] = useState<BulkJob | null>(null);
  const [voidDialog, setVoidDialog] = useState<VoidRelationshipContext | null>(null);
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

  const displayedJobs = (() => {
    // Legacy jobList.tpl: filter:{inBuilder: '!1', Void: '!1'} - jobs already
    // assigned to a run (BulkRunID set) disappear from the Jobs list, so
    // operators see only what's still up for grabs. Void filter is handled
    // server-side in GetBulkJobsAsync.
    let out = state.jobs.filter((j) => j.bulkRunId == null);
    if (state.sizeFilter === 'moreThan100Cubic') {
      out = out.filter((j) => (j.jobCubicM3 ?? 0) > 100);
    }
    if (state.jobSearch.trim()) {
      const needle = state.jobSearch.trim().toLowerCase();
      out = out.filter((j) =>
        (j.jobNumber ?? '').toLowerCase().includes(needle) ||
        (j.clientCode ?? '').toLowerCase().includes(needle) ||
        (j.toSuburb ?? '').toLowerCase().includes(needle) ||
        String(j.toPostCode ?? '').includes(needle) ||
        (j.runName ?? '').toLowerCase().includes(needle));
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

  const handleVoid = async (isVoid: boolean) => {
    if (state.selectedJobIds.length === 0) return;
    const expanded = expandMultiboxSiblings(state.selectedJobIds, state.jobs);
    const hasFamily = expanded.length > state.selectedJobIds.length;
    // Legacy showVoidRelationshipDialog: only prompt when there's a family to
    // choose from. Single-job or already-full-family selections skip the
    // dialog and use a plain confirm.
    if (hasFamily) {
      const jobNumbersById = new Map<number, string>();
      state.jobs.forEach((j) => jobNumbersById.set(j.bulkJobId, j.jobNumber ?? String(j.bulkJobId)));
      setVoidDialog({
        selectedIds: state.selectedJobIds,
        expandedIds: expanded,
        isVoid,
        jobNumbersById,
      });
      return;
    }
    if (!confirm(`${isVoid ? 'Void' : 'Un-void'} ${state.selectedJobIds.length} job(s)?`)) return;
    await executeVoid(state.selectedJobIds, isVoid);
  };

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

  const handleAssignCourier = async (runId: number, courierId: number | null) => {
    const run = state.runs.find((r) => r.id === runId);
    if (!run) return;
    const courier = courierId ? allCouriers.find((c) => c.courierId === courierId) : null;
    try {
      const body = runToBody(run, {
        courier: courier ? { courierId: courier.courierId, courier: courier.displayName } : null,
      });
      const res = await runService.update(runId, body);
      if (res.response.result === 'Success') {
        toast.show(courier ? `Assigned ${courier.displayName}` : 'Courier removed', 'success');
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
  const handleVoidRunBuilderJob = async (job: RunJob, _run: Run) => {
    dispatch({ type: 'REPLACE_MULTISELECT', payload: [job.bulkJobId] });
    await handleVoid(true);
  };
  const handleUnvoidRunBuilderJob = async (job: RunJob, _run: Run) => {
    dispatch({ type: 'REPLACE_MULTISELECT', payload: [job.bulkJobId] });
    await handleVoid(false);
  };

  const handleOptimizeRun = async () => {
    if (!selectedRun || selectedRun.jobs.length < 2) return;
    try {
      const jobsWithCoords = selectedRun.jobs
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
      const nameToOrder = new Map<string, number>();
      if (selectedRun.routingMode === 1 || selectedRun.routingMode === 2) {
        const first = jobsWithCoords[0];
        const startLat = Number(first.pickUpLatitude ?? first.deliveryLatitude);
        const startLng = Number(first.pickUpLongitude ?? first.deliveryLongitude);
        const finishJob = selectedRun.routingMode === 2 && selectedRun.finishAtBulkJobId
          ? jobsWithCoords.find((j) => j.bulkJobId === selectedRun.finishAtBulkJobId)
          : undefined;
        const seq = await routeService.hereSequenceTyped(
          { name: 'start', lat: startLat, lng: startLng },
          jobsWithCoords.map((j) => ({
            name: j.jobNumber ?? String(j.bulkJobId),
            lat: Number(j.deliveryLatitude),
            lng: Number(j.deliveryLongitude),
          })),
          {
            returnToStart: selectedRun.routingMode === 1,
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
        const res = await routeService.optimizeWithName(waypoints);
        res.routes.forEach((r, i) => { if (r.name) nameToOrder.set(r.name, i + 1); });
      }

      const stops: OptimizeStop[] = selectedRun.jobs.map((rj) => ({
        bulkJobId: rj.bulkJobId,
        jobNumber: rj.jobNumber,
        originalOrder: rj.builderIndex,
        newOrder: rj.jobNumber ? nameToOrder.get(rj.jobNumber) ?? 0 : 0,
      })).sort((a, b) => (a.newOrder || 999) - (b.newOrder || 999));

      // Preview modal - operator confirms before persisting.
      setOptimizePreview({
        runName: selectedRun.name ?? '',
        stops,
        commit: async () => {
          const jobs = stops.map((s) => ({
            bulkJobId: s.bulkJobId,
            builderIndex: s.newOrder || null,
            jobNumber: s.jobNumber,
          }));
          const body = runToBody(selectedRun, { jobs });
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

  const handleDispatch = async () => {
    const locked = state.runs.filter((r) => r.status && r.status > 0);
    if (locked.length === 0) return;
    if (!confirm(`Send ${locked.length} locked run(s) to Live?`)) return;
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

    // Simple prompt-based courier picker for now; the legacy also just used a
    // form dialog. Empty answer -> null courier (dispatch orphaned).
    const expanded = expandMultiboxSiblings(state.selectedJobIds, state.jobs);
    const courierList = allCouriers.map((c) => `${c.courierId}: ${c.displayName}`).join('\n');
    const courierInput = window.prompt(
      `Dispatch ${expanded.length} job(s) to Live.\n\nEnter courier ID (blank for unassigned):\n\n${courierList}`,
      ''
    );
    if (courierInput === null) return; // Cancel
    const courierId = courierInput.trim() ? Number(courierInput.trim()) : null;
    if (courierId !== null && Number.isNaN(courierId)) {
      toast.show('Invalid courier id.', 'error');
      return;
    }

    try {
      const runName = `Selected ${new Date().toISOString().slice(0, 10)}`;
      const res = await runService.dispatchJobs(expanded, courierId, runName);
      const failures = res.response.filter((r) => r.result !== 'Success').length;
      if (failures === 0) {
        toast.show(`Dispatched ${res.response.length} job(s) to Live`, 'success');
      } else {
        toast.show(`${failures} of ${res.response.length} dispatches failed`, 'warning');
      }
      dispatch({ type: 'CLEAR_MULTISELECT' });
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

    const warnings: string[] = [];
    if (missingWindow.length) warnings.push(`${missingWindow.length} job(s) missing schedule window`);
    if (missingCubic.length) warnings.push(`${missingCubic.length} job(s) missing cubic data`);
    if (missingPostcode.length) warnings.push(`${missingPostcode.length} job(s) missing postcode`);
    if (warnings.length) toast.show(`Skipped: ${warnings.join('; ')}`, 'warning');

    const buckets = bucketJobs(valid, mode);
    if (buckets.length === 0) {
      toast.show('No buckets formed from selection.', 'warning');
      return;
    }

    const labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const runsToCreate: { name: string; jobs: typeof valid }[] = [];

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
        if (withCoords.length >= 2) {
          try {
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
          } catch (e) {
            // Log to console; toast would be noisy since the build still
            // works (just with less accurate window-fit checks).
            console.warn('HERE sequence failed, falling back to postcode order', e);
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

    // Create each run, then assign its jobs. Sequential so the toast count is
    // accurate even if one create fails mid-way.
    let createdRuns = 0;
    let assignedJobs = 0;
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
          jobs: [],
          despatchDateTime: state.filters.date,
          noReroute: buildConfig.noReroute,
          routingMode: routingModeNumeric,
          finishAtBulkJobId: finishAtInThisRun,
        };
        const created = await runService.insertOrUpdate(body);
        if (created.response.result !== 'Success') continue;
        const runId = Number(created.response.message);
        createdRuns++;

        // Assign in parallel per-run (still sequential across runs).
        const results = await Promise.all(r.jobs.map((j) =>
          runService.assignJob(runId, j.bulkJobId, j.bulkRunId ?? null)));
        assignedJobs += results.filter((x) => x.response.result === 'Success').length;
      } catch (e) {
        toast.show(`Run "${r.name}" build failed: ${(e as Error).message}`, 'error');
      }
    }

    toast.show(`Built ${createdRuns} run(s) with ${assignedJobs} job(s)`, 'success');
    dispatch({ type: 'CLEAR_MULTISELECT' });
    setBuildConfigModal({ open: false });
    await loadJobsAndRuns(state.filters);
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
    if (state.selectedJobIds.length === state.jobs.length) {
      dispatch({ type: 'CLEAR_MULTISELECT' });
    } else {
      dispatch({ type: 'REPLACE_MULTISELECT', payload: state.jobs.map((j) => j.bulkJobId) });
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
    for (const r of targets) {
      await handleLockRun(r.id, lock);
    }
  };

  const handleBulkDispatchSelected = async () => {
    const locked = state.runs.filter((r) => state.selectedRunIds.includes(r.id) && (r.status ?? 0) > 0);
    if (locked.length === 0) return;
    if (!confirm(`Dispatch ${locked.length} locked run(s) from selection?`)) return;
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
    if (!confirm(`Delete ${state.selectedRunIds.length} run(s)? Jobs stay behind unassigned.`)) return;
    for (const id of state.selectedRunIds) {
      await handleDeleteRun(id);
    }
    dispatch({ type: 'CLEAR_RUN_MULTISELECT' });
  };

  // ---- context-menu factories ----------------------------------------------
  const jobContextMenu = (job: BulkJob): ContextMenuItem[] => [
    { label: 'Show on map', onClick: () => dispatch({ type: 'SELECT_JOB', payload: job.bulkJobId }) },
    { label: 'Fix GPS...', onClick: () => setGpsFixJob(job), separatorAfter: true },
    { label: `Void job ${job.jobNumber ?? job.bulkJobId}`, onClick: () => {
      dispatch({ type: 'REPLACE_MULTISELECT', payload: [job.bulkJobId] });
      void handleVoid(true);
    }, danger: true },
    ...(job.bulkRunId ? [{
      label: 'Remove from run',
      onClick: () => handleRemoveJobFromRun(job.bulkJobId),
      danger: true,
    }] : []),
  ];

  const groupContextMenu = (jobIds: number[], label: string): ContextMenuItem[] => [
    { label: `Multi-select ${jobIds.length} job(s)`, onClick: () => dispatch({ type: 'REPLACE_MULTISELECT', payload: jobIds }) },
    { label: 'Move to another date...', onClick: () => {
      dispatch({ type: 'REPLACE_MULTISELECT', payload: jobIds });
      setBulkMoveOpen(true);
    }, separatorAfter: true },
    { label: `Void all in ${label}`, onClick: () => {
      dispatch({ type: 'REPLACE_MULTISELECT', payload: jobIds });
      void handleVoid(true);
    }, danger: true },
  ];

  const runContextMenu = (run: Run): ContextMenuItem[] => {
    const locked = (run.status ?? 0) > 0;
    return [
      { label: 'Select', onClick: () => dispatch({ type: 'SELECT_RUN', payload: run.id }) },
      { label: locked ? 'Unlock' : 'Lock', onClick: () => handleLockRun(run.id, !locked) },
      { label: 'Optimise sequence', onClick: () => {
        dispatch({ type: 'SELECT_RUN', payload: run.id });
        void handleOptimizeRun();
      }, disabled: run.jobs.length < 2 },
      { label: 'Merge into...', onClick: () => handleMergeRun(run), disabled: run.jobs.length === 0, separatorAfter: true },
      { label: 'Delete run', onClick: () => handleDeleteRun(run.id), danger: true },
    ];
  };

  /**
   * Legacy analogue: "Merge selected run to another run" in runListMenu
   * (homeControl.js:2114-2198). Moves every job from `source` into `target`,
   * then deletes the emptied source run. Refuses to merge into a locked run
   * or into itself.
   */
  const handleMergeRun = async (source: Run) => {
    if (source.jobs.length === 0) return;
    const targetName = window.prompt(
      `Merge run "${source.name}" (${source.jobs.length} jobs) into which run?\n\nExisting runs:\n${state.runs.map((r) => r.name).filter((n) => n).join(', ')}`,
      ''
    );
    if (!targetName || !targetName.trim()) return;
    const target = state.runs.find((r) =>
      (r.name ?? '').toLowerCase() === targetName.trim().toLowerCase());
    if (!target) {
      toast.show(`Run "${targetName}" not found`, 'error');
      return;
    }
    if (target.id === source.id) {
      toast.show('Cannot merge a run into itself', 'error');
      return;
    }
    if ((target.status ?? 0) > 0) {
      toast.show(`"${target.name}" is locked. Unlock it before merging.`, 'error');
      return;
    }
    try {
      const jobIds = source.jobs.map((j) => j.bulkJobId);
      await assignJobsToRun(target.id, jobIds);
      await runService.remove(source.id);
      toast.show(`Merged ${jobIds.length} job(s) from "${source.name}" into "${target.name}"`, 'success');
      if (state.selectedRunId === source.id) dispatch({ type: 'SELECT_RUN', payload: target.id });
      await loadJobsAndRuns(state.filters);
    } catch (e) {
      toast.show((e as Error).message, 'error');
    }
  };

  // ---- hotkeys --------------------------------------------------------------
  // Ctrl+D dispatches (locked runs or selected jobs), Ctrl+A selects all
  // visible jobs, Esc clears the current selection, Del removes the focused
  // job from its run. Matches the legacy hotkeys.add() bindings.
  useHotkeys({
    onDispatch: () => {
      if (state.selectedJobIds.length > 0) void handleSendSelected();
      else void handleDispatch();
    },
    onSelectAll: () => dispatch({ type: 'REPLACE_MULTISELECT', payload: displayedJobs.map((j) => j.bulkJobId) }),
    onEscape: () => {
      if (bulkMoveOpen) setBulkMoveOpen(false);
      else if (optimizePreview) setOptimizePreview(null);
      else if (buildConfigModal.open) setBuildConfigModal({ open: false });
      else if (gpsFixJob) setGpsFixJob(null);
      else if (state.selectedJobIds.length > 0) dispatch({ type: 'CLEAR_MULTISELECT' });
      else if (state.selectedRunIds.length > 0) dispatch({ type: 'CLEAR_RUN_MULTISELECT' });
    },
    onDelete: () => {
      if (selectedJob && selectedJob.bulkRunId) {
        void handleRemoveJobFromRun(selectedJob.bulkJobId);
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
  });

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
        <button
          type="button"
          onClick={() => openBuildConfig(false)}
          className="px-2 py-0.5 bg-brand-cyan/40 text-brand-dark rounded font-medium hover:bg-brand-cyan/60"
          title="Change build configuration"
        >
          {buildModeLabel(buildConfig)}
        </button>
        <button
          type="button"
          onClick={() => openBuildConfig(true)}
          disabled={state.selectedJobIds.length === 0}
          className="ml-2 px-3 py-0.5 bg-brand-purple text-white rounded font-medium disabled:opacity-40"
          title={state.selectedJobIds.length === 0
            ? 'Select one or more jobs first'
            : `Build runs from ${state.selectedJobIds.length} selected job(s)`}
        >
          Build Runs
        </button>
        {state.selectedJobIds.length > 0 && (
          <span className="text-text-muted ml-2">
            ({state.selectedJobIds.length} job{state.selectedJobIds.length === 1 ? '' : 's'} selected)
          </span>
        )}
        <div className="flex-1" />
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
                <GroupedJobs
                  jobs={displayedJobs}
                  search={state.groupSearch}
                  onSetSearch={(s) => dispatch({ type: 'SET_GROUP_SEARCH', payload: s })}
                  onSelectGroup={(ids) => dispatch({ type: 'REPLACE_MULTISELECT', payload: ids })}
                  onBulkMoveGroup={(ids) => {
                    dispatch({ type: 'REPLACE_MULTISELECT', payload: ids });
                    setBulkMoveOpen(true);
                  }}
                  onContextMenuItems={(ids, label) => groupContextMenu(ids, label)}
                />
              </Panel>
              <PanelResizeHandle className="h-1" />
              <Panel defaultSize={45} minSize={20}>
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
              </Panel>
              <PanelResizeHandle className="h-1" />
              <Panel defaultSize={30} minSize={15}>
                <JobDetail
                  job={selectedJob}
                  speeds={state.speeds}
                  onUpdateField={handleUpdateJobField}
                  onOpenGpsFix={(j) => setGpsFixJob(j)}
                />
              </Panel>
            </PanelGroup>
          </Panel>

          <PanelResizeHandle className="w-1" />

          <Panel defaultSize={26} minSize={15}>
            <PanelGroup direction="vertical" ref={runVerticalRef}>
              <Panel defaultSize={50} minSize={20}>
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
                  onAssignSelectedJobs={handleAssignSelectedJobs}
                  onDropJobs={handleDropJobs}
                  onContextMenuItems={(run) => runContextMenu(run)}
                  selectedJobCount={state.selectedJobIds.length}
                />
              </Panel>
              <PanelResizeHandle className="h-1" />
              <Panel defaultSize={50} minSize={20}>
                <RunBuilder
                  run={selectedRun}
                  onRemoveJob={handleRemoveJobFromRun}
                  onOptimize={handleOptimizeRun}
                  onToggleStart={handleToggleStart}
                  onToggleEnd={handleToggleEnd}
                  onVoidJob={handleVoidRunBuilderJob}
                  onUnvoidJob={handleUnvoidRunBuilderJob}
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
              onPinClick={(jobId) => dispatch({ type: 'SELECT_JOB', payload: jobId })}
              onPinContextMenu={(t) => setMapContext(t)}
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

      <FixGpsModal
        open={gpsFixJob != null}
        job={gpsFixJob}
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
    courierPercent: run.courierPercentage != null ? `${run.courierPercentage * 100}%` : null,
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
