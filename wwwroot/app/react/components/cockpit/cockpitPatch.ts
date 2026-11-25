import type { BulkJob, Run } from '../../types';

/**
 * #1018 C2: what a successful Route Builder save changed, applied to the
 * cockpit's job and run lists at once so the busy overlay clears when the
 * write commits. The full reload still follows, in the background, and
 * replaces whatever this got wrong (run totals, or a touched run's jobs that
 * sit outside the operator's filters).
 */
export interface CockpitPatch {
  /** Runs as the server now has them (POST /runs, with-jobs, assign-many). */
  upsertRuns?: Run[];
  /** Deleted runs; their jobs go back to unassigned. */
  removeRunIds?: number[];
  renameRun?: { runId: number; name: string };
  /** Voided jobs, gone from the job list and every run. */
  removeJobIds?: number[];
}

const unassigned = (j: BulkJob): BulkJob => ({ ...j, bulkRunId: null, runName: null, runOrder: null });

export function applyCockpitPatch(
  jobs: BulkJob[],
  runs: Run[],
  patch: CockpitPatch,
): { jobs: BulkJob[]; runs: Run[] } {
  let nextJobs = jobs;
  let nextRuns = runs;

  if (patch.removeJobIds?.length) {
    const gone = new Set(patch.removeJobIds);
    nextJobs = nextJobs.filter((j) => !gone.has(j.bulkJobId));
    nextRuns = nextRuns.map((r) => (r.jobs.some((j) => gone.has(j.bulkJobId))
      ? { ...r, jobs: r.jobs.filter((j) => !gone.has(j.bulkJobId)) }
      : r));
  }

  if (patch.removeRunIds?.length) {
    const gone = new Set(patch.removeRunIds);
    nextRuns = nextRuns.filter((r) => !gone.has(r.id));
    nextJobs = nextJobs.map((j) => (j.bulkRunId != null && gone.has(j.bulkRunId) ? unassigned(j) : j));
  }

  if (patch.upsertRuns?.length) {
    const upserted = new Map(patch.upsertRuns.map((r) => [r.id, r]));
    // Job id -> the run that now holds it, and its place on that run.
    const holder = new Map<number, { run: Run; order: number }>();
    for (const r of patch.upsertRuns) {
      r.jobs.forEach((j, i) => holder.set(j.bulkJobId, { run: r, order: j.builderIndex ?? i }));
    }
    const kept = nextRuns.map((r) => {
      const fresh = upserted.get(r.id);
      if (fresh) return fresh;
      return r.jobs.some((j) => holder.has(j.bulkJobId))
        ? { ...r, jobs: r.jobs.filter((j) => !holder.has(j.bulkJobId)) }
        : r;
    });
    const known = new Set(nextRuns.map((r) => r.id));
    nextRuns = [...kept, ...patch.upsertRuns.filter((r) => !known.has(r.id))];
    nextJobs = nextJobs.map((j) => {
      const h = holder.get(j.bulkJobId);
      if (h) return { ...j, bulkRunId: h.run.id, runName: h.run.name, runOrder: h.order };
      return j.bulkRunId != null && upserted.has(j.bulkRunId) ? unassigned(j) : j;
    });
  }

  if (patch.renameRun) {
    const { runId, name } = patch.renameRun;
    nextRuns = nextRuns.map((r) => (r.id === runId ? { ...r, name } : r));
    nextJobs = nextJobs.map((j) => (j.bulkRunId === runId ? { ...j, runName: name } : j));
  }

  return { jobs: nextJobs, runs: nextRuns };
}
