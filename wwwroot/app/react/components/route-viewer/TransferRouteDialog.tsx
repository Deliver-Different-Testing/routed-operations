import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { routeViewerService } from '../../services/routeViewerService';

// Route Viewer Transfer Route dialog (master Section 13.2 + P6). Two-step
// flow: (1) pick a target route from the tenant's active-route list
// (current run's route excluded) + choose whether to cascade the transfer
// to the recurring booking and to the route's zipcode polygon; (2)
// confirm banner with from -> to counts, plus a per-job preview table
// (legacy transfer-route-dialog.tpl.html lines 219-251) so the operator
// can eyeball the exact jobs / from-addresses / from-route colouring
// before pressing Transfer.
//
// Success rollup surfaces the number of jobs / bookings / zipcodes moved
// (master Section S.5 J7 - legacy only console.logs this, Route Viewer
// toasts it).

/** Minimal per-job shape the confirm-step preview table needs. Callers
 *  that already have BulkJob[] just map into this. */
export interface TransferJobPreview {
  jobId: number;
  jobNumber: string | null;
  fromAddress: string | null;
  /** Current run/route label shown in red. Null = unassigned. */
  currentRouteName: string | null;
}

interface Props {
  runId: number;
  onClose: () => void;
  onSuccess: (summary: string) => void;
  /** Optional pre-supplied job preview rows (job-scoped caller path,
   *  RvJobContextMenu). If omitted and runDate is set the dialog fetches
   *  the run's jobs on mount for the run-scoped caller path. */
  jobs?: TransferJobPreview[];
  /** Run date used to fetch the run's jobs when `jobs` is not supplied
   *  (yyyy-MM-dd). Ignored when `jobs` is provided. */
  runDate?: string;
}

type Step = 'pick' | 'confirm';

export function TransferRouteDialog({ runId, onClose, onSuccess, jobs, runDate }: Props) {
  const [step, setStep] = useState<Step>('pick');
  const [routes, setRoutes] = useState<Array<{ routeId: number; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [toRouteId, setToRouteId] = useState<number | ''>('');
  const [transferBooking, setTransferBooking] = useState(false);
  const [transferZipcodes, setTransferZipcodes] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedJobs, setFetchedJobs] = useState<TransferJobPreview[] | null>(null);
  const [jobsLoading, setJobsLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    routeViewerService.getTransferContext(undefined).then((rows) => {
      // Exclude the current run so the operator cannot transfer a run to
      // itself. In legacy this was also filtered by tenant scope inside
      // the SP - the endpoint honours the same rule.
      setRoutes(rows.filter((r) => r.routeId !== runId));
    }).catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [runId]);

  // Run-scoped preview: when the caller (RvRunContextMenu) does not
  // hand us a jobs array, hydrate one from the run's job list so the
  // step-2 table still shows something meaningful.
  useEffect(() => {
    if (jobs || !runDate || runId <= 0) return;
    setJobsLoading(true);
    routeViewerService.getRunJobs(runId, runDate).then((rows) => {
      setFetchedJobs(rows.map((r) => ({
        jobId: r.jobId,
        jobNumber: r.jobNumber,
        fromAddress: r.fromAddress,
        currentRouteName: r.runName,
      })));
    }).catch(() => {
      // Preview is decorative; do not block the transfer flow if the
      // per-job fetch fails - fall back to the banner-only view.
      setFetchedJobs([]);
    }).finally(() => setJobsLoading(false));
  }, [jobs, runDate, runId]);

  const previewJobs: TransferJobPreview[] = useMemo(
    () => jobs ?? fetchedJobs ?? [],
    [jobs, fetchedJobs],
  );

  const toRoute = useMemo(
    () => routes.find((r) => r.routeId === toRouteId) ?? null,
    [routes, toRouteId],
  );

  const doTransfer = async () => {
    if (!toRoute) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await routeViewerService.transferRoute({
        // Job-scoped callers pass a jobs array; forward those ids so the
        // server only touches that subset. Run-scoped callers leave jobs
        // undefined and the server derives the full run set.
        jobIds: jobs ? jobs.map((j) => j.jobId).filter((id) => id > 0) : [],
        toRouteId: toRoute.routeId,
        transferBooking,
        transferZipcodes,
      });
      // Response field names come from the backend TransferRouteResult
      // (RouteTransferDto.cs:55): `succeeded` = jobs moved,
      // `bookingsAffected` = recurring templates re-stamped,
      // `zipCodesMoved` = zips moved with the cascade opt-in.
      const bits: string[] = [`${result.succeeded} jobs`];
      if (transferBooking && result.bookingsAffected > 0) bits.push(`${result.bookingsAffected} bookings`);
      if (transferZipcodes && result.zipCodesMoved > 0) bits.push(`${result.zipCodesMoved} zipcodes`);
      onSuccess(`Transferred ${bits.join(', ')} from run #${runId} to ${toRoute.label}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Transfer route"
      size="lg"
      footer={
        <div className="flex justify-between w-full">
          <div>
            {step === 'confirm' && (
              <Button variant="ghost" onClick={() => setStep('pick')}>← Back</Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="neutral" onClick={onClose}>Cancel</Button>
            {step === 'pick' ? (
              <Button
                variant="primary"
                onClick={() => setStep('confirm')}
                disabled={!toRoute}
              >
                Next
              </Button>
            ) : (
              <Button variant="warning" onClick={doTransfer} disabled={submitting}>
                {submitting ? 'Transferring...' : 'Transfer'}
              </Button>
            )}
          </div>
        </div>
      }
    >
      {step === 'pick' && (
        <>
          <div className="text-sm text-text-primary mb-2">
            Target route
          </div>
          {loading && <div className="text-xs text-text-muted">Loading routes...</div>}
          {!loading && (
            <select
              value={toRouteId}
              onChange={(e) => setToRouteId(e.target.value ? Number(e.target.value) : '')}
              className="w-full border border-border rounded px-2 py-1 text-sm"
            >
              <option value="">-- pick a route --</option>
              {routes.map((r) => (
                <option key={r.routeId} value={r.routeId}>{r.label}</option>
              ))}
            </select>
          )}

          <div className="mt-3 space-y-1 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={transferBooking}
                onChange={(e) => setTransferBooking(e.target.checked)}
                className="accent-brand-cyan"
              />
              <span>
                Also transfer the recurring booking template
                <span className="text-text-muted"> (cascade parent + children)</span>
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={transferZipcodes}
                onChange={(e) => setTransferZipcodes(e.target.checked)}
                className="accent-brand-cyan"
              />
              <span>
                Also transfer the zipcode polygon
                <span className="text-text-muted"> (RouteZipcodes rows)</span>
              </span>
            </label>
          </div>
        </>
      )}

      {step === 'confirm' && toRoute && (
        <div>
          <div className="border border-border rounded p-3 bg-surface-cream mb-2 text-sm">
            <div className="text-text-muted text-xs">From</div>
            <div className="font-medium">Run #{runId}</div>
            <div className="my-1 text-center text-text-muted">↓</div>
            <div className="text-text-muted text-xs">To</div>
            <div className="font-medium">{toRoute.label}</div>
          </div>
          <div className="text-xs text-text-muted mb-2">
            {transferBooking ? '- Recurring booking template will move with the jobs.' : '- Recurring booking stays on the source route.'}
            <br />
            {transferZipcodes ? '- Zipcode polygon moves with the route.' : '- Zipcode polygon stays on the source route.'}
          </div>

          {/* Per-job preview table (legacy dialog lines 219-251). One row
              per selected job; the From Route cell is red and the To
              Route cell is green so the eye picks up the transfer
              direction at a glance. */}
          <div className="border border-border rounded overflow-auto max-h-64">
            <table
              className="w-full text-xs border-collapse"
              data-testid="transfer-preview-table"
            >
              <thead className="bg-surface-cream sticky top-0">
                <tr className="text-left text-text-muted">
                  <th className="px-2 py-1 font-medium">Job #</th>
                  <th className="px-2 py-1 font-medium">From Address</th>
                  <th className="px-2 py-1 font-medium">From Route</th>
                  <th className="px-2 py-1 font-medium">To Route</th>
                </tr>
              </thead>
              <tbody>
                {jobsLoading && !jobs && (
                  <tr>
                    <td colSpan={4} className="px-2 py-2 text-center text-text-muted">
                      Loading jobs...
                    </td>
                  </tr>
                )}
                {!jobsLoading && previewJobs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-2 py-2 text-center text-text-muted">
                      No jobs to display
                    </td>
                  </tr>
                )}
                {previewJobs.map((row) => (
                  <tr key={row.jobId} className="border-t border-border">
                    <td className="px-2 py-1 whitespace-nowrap">
                      {row.jobNumber || `#${row.jobId}`}
                    </td>
                    <td className="px-2 py-1">{row.fromAddress || '-'}</td>
                    <td className="px-2 py-1 text-error whitespace-nowrap">
                      {row.currentRouteName || 'unassigned'}
                    </td>
                    <td className="px-2 py-1 text-success whitespace-nowrap">
                      {toRoute.label}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && <div className="mt-2 text-xs text-error">{error}</div>}
    </Modal>
  );
}
